//! Zeceipt core: Zcash transaction parsing, per-output OCK derivation and
//! output recovery for the Ironwood, Orchard and Sapling pools.
//!
//! This crate never sees spending keys. Issuers supply a Unified Full Viewing
//! Key (or bare outgoing viewing keys); verifiers supply a receipt and the raw
//! transaction. All cryptography comes from the `orchard`, `sapling-crypto`
//! and `zcash_note_encryption` crates; nothing is re-implemented here.

#![forbid(unsafe_code)]

use orchard::keys::{OutgoingViewingKey as OrchardOvk, Scope};
use orchard::note_encryption::{IronwoodDomain, OrchardDomain};
use sapling_crypto::keys::OutgoingViewingKey as SaplingOvk;
use sapling_crypto::note_encryption::{SaplingDomain, Zip212Enforcement};
use zcash_address::unified::{self, Encoding, Receiver};
use zcash_keys::keys::UnifiedFullViewingKey;
use zcash_note_encryption::{
    try_output_recovery_with_ock, try_output_recovery_with_ovk, Domain, EphemeralKeyBytes,
    OutgoingCipherKey,
};
use zcash_primitives::transaction::Transaction;
use zcash_protocol::consensus::{BranchId, MainNetwork, NetworkType, TestNetwork};
use zcash_protocol::memo::{Memo, MemoBytes};
use zeceipt_types::ed25519_dalek::SigningKey;
use zeceipt_types::{Network, Pool, Receipt, TypesError};

pub use zeceipt_types;

#[cfg(feature = "synthetic")]
pub mod synthetic;

/// Errors from parsing, derivation and verification.
#[derive(Debug, thiserror::Error)]
pub enum CoreError {
    #[error("transaction bytes are malformed: {0}")]
    Malformed(String),
    #[error("transaction version {0:?} is not supported")]
    UnsupportedTxVersion(String),
    #[error("txid mismatch: receipt says {expected}, transaction is {actual}")]
    TxidMismatch { expected: String, actual: String },
    #[error("transaction has no {0} bundle")]
    NoBundle(&'static str),
    #[error("output index {index} out of range for {pool} bundle with {len} outputs")]
    OutputIndexOutOfRange {
        pool: &'static str,
        index: u32,
        len: usize,
    },
    #[error("recovery failed: the ock does not open {pool} output {index}")]
    RecoveryFailed { pool: &'static str, index: u32 },
    #[error("viewing key has no {0} component")]
    MissingKey(&'static str),
    #[error("viewing key could not be decoded: {0}")]
    KeyDecode(String),
    #[error("network mismatch between receipt and viewing key")]
    NetworkMismatch,
    #[error(transparent)]
    Types(#[from] TypesError),
}

/// Reference to one shielded output inside a transaction.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OutputRef {
    pub pool: Pool,
    pub index: u32,
}

/// A recovered note plaintext.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Recovered {
    pub pool: Pool,
    pub index: u32,
    /// Recipient address encoded for the network (unified address for
    /// Orchard/Ironwood receivers, `zs`/`ztestsapling` for Sapling).
    pub recipient: String,
    pub value_zat: u64,
    pub memo: MemoView,
}

/// Human-friendly view of a 512-byte memo.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MemoView {
    Empty,
    Text(String),
    /// Arbitrary bytes (hex) — not a UTF-8 text memo.
    Bytes(String),
}

impl MemoView {
    fn from_raw(raw: &[u8; 512]) -> Self {
        match MemoBytes::from_bytes(raw)
            .ok()
            .and_then(|m| Memo::try_from(m).ok())
        {
            Some(Memo::Empty) => MemoView::Empty,
            Some(Memo::Text(t)) => MemoView::Text(String::from(t)),
            Some(Memo::Future(b)) => MemoView::Bytes(hex::encode(b.as_slice())),
            Some(Memo::Arbitrary(b)) => MemoView::Bytes(hex::encode(&b[..])),
            None => MemoView::Bytes(hex::encode(raw)),
        }
    }
}

/// Result of a successful verification.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Verified {
    pub recovered: Recovered,
    /// Display-order txid hex, as confirmed from the parsed transaction.
    pub txid: String,
    /// `Some(pubkey hex)` when the receipt carried a valid issuer signature.
    pub issuer_pubkey: Option<String>,
    /// Whether a challenge was bound and matched.
    pub challenge_checked: bool,
}

/// Outgoing viewing keys an issuer holds. Never contains spending material.
#[derive(Clone)]
pub struct OutgoingKeys {
    pub network: Network,
    orchard_external: Option<OrchardOvk>,
    orchard_internal: Option<OrchardOvk>,
    sapling_external: Option<SaplingOvk>,
    sapling_internal: Option<SaplingOvk>,
}

impl OutgoingKeys {
    /// Derive outgoing viewing keys from an encoded UFVK (`uview1…` / `uviewtest1…`).
    ///
    /// Ironwood reuses the Orchard key hierarchy, so the Orchard external OVK
    /// covers both pools.
    pub fn from_ufvk(network: Network, encoded: &str) -> Result<Self, CoreError> {
        let ufvk = match network {
            Network::Main => UnifiedFullViewingKey::decode(&MainNetwork, encoded),
            Network::Test => UnifiedFullViewingKey::decode(&TestNetwork, encoded),
        }
        .map_err(|e| CoreError::KeyDecode(e.to_string()))?;
        Ok(OutgoingKeys {
            network,
            orchard_external: ufvk.orchard().map(|fvk| fvk.to_ovk(Scope::External)),
            orchard_internal: ufvk.orchard().map(|fvk| fvk.to_ovk(Scope::Internal)),
            sapling_external: ufvk.sapling().map(|dfvk| dfvk.to_ovk(Scope::External)),
            sapling_internal: ufvk.sapling().map(|dfvk| dfvk.to_ovk(Scope::Internal)),
        })
    }

    /// Build from a bare 32-byte Orchard/Ironwood outgoing viewing key.
    pub fn from_orchard_ovk(network: Network, ovk: [u8; 32]) -> Self {
        OutgoingKeys {
            network,
            orchard_external: Some(OrchardOvk::from(ovk)),
            orchard_internal: None,
            sapling_external: None,
            sapling_internal: None,
        }
    }

    fn orchard(&self, internal: bool) -> Option<&OrchardOvk> {
        if internal {
            self.orchard_internal.as_ref()
        } else {
            self.orchard_external.as_ref()
        }
    }

    fn sapling(&self, internal: bool) -> Option<&SaplingOvk> {
        if internal {
            self.sapling_internal.as_ref()
        } else {
            self.sapling_external.as_ref()
        }
    }
}

/// Parse a raw Zcash transaction (v4, v5 or v6).
pub fn parse_transaction(bytes: &[u8]) -> Result<Transaction, CoreError> {
    // The branch id argument only matters for pre-v5 transactions; v5/v6 carry
    // their consensus branch id in the serialized form.
    Transaction::read(bytes, BranchId::Nu6_3).map_err(|e| CoreError::Malformed(e.to_string()))
}

/// Display-order (explorer) hex of the transaction id.
pub fn txid_hex(tx: &Transaction) -> String {
    let mut b: [u8; 32] = *tx.txid().as_ref();
    b.reverse();
    hex::encode(b)
}

/// Enumerate every shielded output in the transaction.
pub fn enumerate_outputs(tx: &Transaction) -> Vec<OutputRef> {
    let mut out = Vec::new();
    if let Some(b) = tx.ironwood_bundle() {
        out.extend((0..b.actions().len()).map(|i| OutputRef {
            pool: Pool::Ironwood,
            index: i as u32,
        }));
    }
    if let Some(b) = tx.orchard_bundle() {
        out.extend((0..b.actions().len()).map(|i| OutputRef {
            pool: Pool::Orchard,
            index: i as u32,
        }));
    }
    if let Some(b) = tx.sapling_bundle() {
        out.extend((0..b.shielded_outputs().len()).map(|i| OutputRef {
            pool: Pool::Sapling,
            index: i as u32,
        }));
    }
    out
}

fn network_type(n: Network) -> NetworkType {
    match n {
        Network::Main => NetworkType::Main,
        Network::Test => NetworkType::Test,
    }
}

fn encode_orchard_address(addr: &orchard::Address, network: Network) -> Result<String, CoreError> {
    let ua = unified::Address::try_from_items(vec![Receiver::Orchard(addr.to_raw_address_bytes())])
        .map_err(|e| CoreError::Malformed(format!("unified address: {e}")))?;
    Ok(ua.encode(&network_type(network)))
}

fn encode_sapling_address(addr: &sapling_crypto::PaymentAddress, network: Network) -> String {
    match network {
        Network::Main => zcash_keys::encoding::encode_payment_address_p(&MainNetwork, addr),
        Network::Test => zcash_keys::encoding::encode_payment_address_p(&TestNetwork, addr),
    }
}

macro_rules! orchard_like {
    ($bundle:expr, $domain:ty, $pool:expr, $index:expr) => {{
        let bundle = $bundle.ok_or(CoreError::NoBundle($pool.as_str()))?;
        let actions = bundle.actions();
        let action = actions
            .get($index as usize)
            .ok_or(CoreError::OutputIndexOutOfRange {
                pool: $pool.as_str(),
                index: $index,
                len: actions.len(),
            })?;
        let domain = <$domain>::for_action(action);
        (action, domain)
    }};
}

/// Derive the per-output OCK for an output we sent (requires the sender's OVK).
///
/// Returns `None` if none of the held OVKs opens the output (i.e. it is not ours,
/// or it is a change output and `include_change` is false).
pub fn derive_ock(
    tx: &Transaction,
    output: OutputRef,
    keys: &OutgoingKeys,
    include_change: bool,
) -> Result<Option<([u8; 32], Recovered)>, CoreError> {
    let scopes: &[bool] = if include_change {
        &[false, true]
    } else {
        &[false]
    };
    match output.pool {
        Pool::Ironwood | Pool::Orchard => {
            let (action, ock_for_key, recovered) = if output.pool == Pool::Ironwood {
                let (action, domain) = orchard_like!(
                    tx.ironwood_bundle(),
                    IronwoodDomain,
                    Pool::Ironwood,
                    output.index
                );
                let mut found = None;
                for &internal in scopes {
                    if let Some(ovk) = keys.orchard(internal) {
                        let enc = action.encrypted_note();
                        if let Some((note, addr, memo)) = try_output_recovery_with_ovk(
                            &domain,
                            ovk,
                            action,
                            action.cv_net(),
                            &enc.out_ciphertext,
                        ) {
                            let ock = <IronwoodDomain as Domain>::derive_ock(
                                ovk,
                                action.cv_net(),
                                &action.cmx().to_bytes(),
                                &EphemeralKeyBytes(enc.epk_bytes),
                            );
                            found = Some((ock, note, addr, memo));
                            break;
                        }
                    }
                }
                match found {
                    None => return Ok(None),
                    Some((ock, note, addr, memo)) => {
                        (action, ock, (note.value().inner(), addr, memo))
                    }
                }
            } else {
                let (action, domain) = orchard_like!(
                    tx.orchard_bundle(),
                    OrchardDomain,
                    Pool::Orchard,
                    output.index
                );
                let mut found = None;
                for &internal in scopes {
                    if let Some(ovk) = keys.orchard(internal) {
                        let enc = action.encrypted_note();
                        if let Some((note, addr, memo)) = try_output_recovery_with_ovk(
                            &domain,
                            ovk,
                            action,
                            action.cv_net(),
                            &enc.out_ciphertext,
                        ) {
                            let ock = <OrchardDomain as Domain>::derive_ock(
                                ovk,
                                action.cv_net(),
                                &action.cmx().to_bytes(),
                                &EphemeralKeyBytes(enc.epk_bytes),
                            );
                            found = Some((ock, note, addr, memo));
                            break;
                        }
                    }
                }
                match found {
                    None => return Ok(None),
                    Some((ock, note, addr, memo)) => {
                        (action, ock, (note.value().inner(), addr, memo))
                    }
                }
            };
            let _ = action;
            let (value, addr, memo) = recovered;
            let mut ock_bytes = [0u8; 32];
            ock_bytes.copy_from_slice(ock_for_key.as_ref());
            Ok(Some((
                ock_bytes,
                Recovered {
                    pool: output.pool,
                    index: output.index,
                    recipient: encode_orchard_address(&addr, keys.network)?,
                    value_zat: value,
                    memo: MemoView::from_raw(&memo),
                },
            )))
        }
        Pool::Sapling => {
            let bundle = tx.sapling_bundle().ok_or(CoreError::NoBundle("sapling"))?;
            let outputs = bundle.shielded_outputs();
            let od =
                outputs
                    .get(output.index as usize)
                    .ok_or(CoreError::OutputIndexOutOfRange {
                        pool: "sapling",
                        index: output.index,
                        len: outputs.len(),
                    })?;
            let domain = SaplingDomain::new(Zip212Enforcement::On);
            for &internal in scopes {
                if let Some(ovk) = keys.sapling(internal) {
                    if let Some((note, addr, memo)) =
                        try_output_recovery_with_ovk(&domain, ovk, od, od.cv(), od.out_ciphertext())
                    {
                        let ock = <SaplingDomain as Domain>::derive_ock(
                            ovk,
                            od.cv(),
                            &od.cmu().to_bytes(),
                            od.ephemeral_key(),
                        );
                        let mut ock_bytes = [0u8; 32];
                        ock_bytes.copy_from_slice(ock.as_ref());
                        return Ok(Some((
                            ock_bytes,
                            Recovered {
                                pool: Pool::Sapling,
                                index: output.index,
                                recipient: encode_sapling_address(&addr, keys.network),
                                value_zat: note.value().inner(),
                                memo: MemoView::from_raw(&memo),
                            },
                        )));
                    }
                }
            }
            Ok(None)
        }
    }
}

/// Recover one output with a disclosed OCK. This is what a verifier runs.
pub fn recover(
    tx: &Transaction,
    output: OutputRef,
    ock: &[u8; 32],
    network: Network,
) -> Result<Recovered, CoreError> {
    let ock = OutgoingCipherKey(*ock);
    match output.pool {
        Pool::Ironwood => {
            let (action, domain) = orchard_like!(
                tx.ironwood_bundle(),
                IronwoodDomain,
                Pool::Ironwood,
                output.index
            );
            let (note, addr, memo) = try_output_recovery_with_ock(
                &domain,
                &ock,
                action,
                &action.encrypted_note().out_ciphertext,
            )
            .ok_or(CoreError::RecoveryFailed {
                pool: "ironwood",
                index: output.index,
            })?;
            Ok(Recovered {
                pool: Pool::Ironwood,
                index: output.index,
                recipient: encode_orchard_address(&addr, network)?,
                value_zat: note.value().inner(),
                memo: MemoView::from_raw(&memo),
            })
        }
        Pool::Orchard => {
            let (action, domain) = orchard_like!(
                tx.orchard_bundle(),
                OrchardDomain,
                Pool::Orchard,
                output.index
            );
            let (note, addr, memo) = try_output_recovery_with_ock(
                &domain,
                &ock,
                action,
                &action.encrypted_note().out_ciphertext,
            )
            .ok_or(CoreError::RecoveryFailed {
                pool: "orchard",
                index: output.index,
            })?;
            Ok(Recovered {
                pool: Pool::Orchard,
                index: output.index,
                recipient: encode_orchard_address(&addr, network)?,
                value_zat: note.value().inner(),
                memo: MemoView::from_raw(&memo),
            })
        }
        Pool::Sapling => {
            let bundle = tx.sapling_bundle().ok_or(CoreError::NoBundle("sapling"))?;
            let outputs = bundle.shielded_outputs();
            let od =
                outputs
                    .get(output.index as usize)
                    .ok_or(CoreError::OutputIndexOutOfRange {
                        pool: "sapling",
                        index: output.index,
                        len: outputs.len(),
                    })?;
            let domain = SaplingDomain::new(Zip212Enforcement::On);
            let (note, addr, memo) =
                try_output_recovery_with_ock(&domain, &ock, od, od.out_ciphertext()).ok_or(
                    CoreError::RecoveryFailed {
                        pool: "sapling",
                        index: output.index,
                    },
                )?;
            Ok(Recovered {
                pool: Pool::Sapling,
                index: output.index,
                recipient: encode_sapling_address(&addr, network),
                value_zat: note.value().inner(),
                memo: MemoView::from_raw(&memo),
            })
        }
    }
}

/// Options for issuing receipts.
pub struct IssueOptions<'a> {
    pub label: String,
    pub challenge: Option<&'a [u8]>,
    pub key_id: Option<String>,
    pub include_change: bool,
    pub signer: Option<&'a SigningKey>,
}

/// Issue one receipt per output that the issuer's keys can open.
pub fn issue(
    tx: &Transaction,
    keys: &OutgoingKeys,
    opts: &IssueOptions<'_>,
) -> Result<Vec<(Receipt, Recovered)>, CoreError> {
    let txid = txid_hex(tx);
    let mut txid_bytes = [0u8; 32];
    txid_bytes
        .copy_from_slice(&hex::decode(&txid).map_err(|_| CoreError::Malformed("txid".into()))?);
    let mut out = Vec::new();
    for o in enumerate_outputs(tx) {
        if let Some((ock, recovered)) = derive_ock(tx, o, keys, opts.include_change)? {
            let mut r = Receipt::new(
                keys.network,
                o.pool,
                txid_bytes,
                o.index,
                ock,
                opts.label.clone(),
            );
            if let Some(c) = opts.challenge {
                r = r.with_challenge(c);
            }
            if let Some(k) = &opts.key_id {
                r = r.with_key_id(k.clone());
            }
            if let Some(s) = opts.signer {
                r = r.sign(s)?;
            }
            out.push((r, recovered));
        }
    }
    Ok(out)
}

/// Verify a receipt against a raw transaction. Fails closed on every mismatch.
///
/// `expected_challenge` must equal the challenge bound into the receipt (empty
/// when the receipt has none). Signature verification runs when the receipt is
/// signed; unsigned receipts are accepted only if `require_signature` is false.
pub fn verify(
    receipt: &Receipt,
    tx: &Transaction,
    expected_challenge: &[u8],
    require_signature: bool,
) -> Result<Verified, CoreError> {
    let actual = txid_hex(tx);
    if receipt.txid.to_lowercase() != actual {
        return Err(CoreError::TxidMismatch {
            expected: receipt.txid.clone(),
            actual,
        });
    }
    receipt.check_challenge(expected_challenge)?;
    let issuer_pubkey = match (receipt.signature.is_some(), require_signature) {
        (true, _) => Some(hex::encode(receipt.verify_signature()?.to_bytes())),
        (false, true) => return Err(TypesError::Unsigned.into()),
        (false, false) => None,
    };
    let ock = receipt.ock_bytes()?;
    let recovered = recover(
        tx,
        OutputRef {
            pool: receipt.pool,
            index: receipt.output_index,
        },
        &ock,
        receipt.network,
    )?;
    Ok(Verified {
        recovered,
        txid: actual,
        issuer_pubkey,
        challenge_checked: receipt.challenge.is_some(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use orchard::keys::{FullViewingKey, SpendingKey};
    use orchard::note::{
        ExtractedNoteCommitment, NoteVersion, RandomSeed, Rho, TransmittedNoteCiphertext,
    };
    use orchard::note_encryption::IronwoodNoteEncryption;
    use orchard::value::NoteValue;
    use orchard::Action;
    use rand::rngs::OsRng;
    use rand::RngCore;

    const FIXTURE: &str = include_str!(
        "../../../fixtures/0e85513c8ac28fcd6ea5324e08bde3360e5cb78e176f536d6659f14fee87da69.hex"
    );

    fn random_fvk() -> FullViewingKey {
        loop {
            let mut b = [0u8; 32];
            OsRng.fill_bytes(&mut b);
            let sk: Option<SpendingKey> = SpendingKey::from_bytes(b).into();
            if let Some(sk) = sk {
                return FullViewingKey::from(&sk);
            }
        }
    }

    fn fixture_tx() -> Transaction {
        let bytes = hex::decode(FIXTURE.trim()).unwrap();
        parse_transaction(&bytes).unwrap()
    }

    #[test]
    fn parses_mainnet_v6_fixture_and_enumerates_ironwood_actions() {
        let tx = fixture_tx();
        assert_eq!(
            txid_hex(&tx),
            "0e85513c8ac28fcd6ea5324e08bde3360e5cb78e176f536d6659f14fee87da69"
        );
        let outs = enumerate_outputs(&tx);
        assert!(
            outs.iter().any(|o| o.pool == Pool::Ironwood),
            "fixture must contain Ironwood actions: {outs:?}"
        );
    }

    /// Build a synthetic Ironwood action encrypted to a fresh key, reusing the
    /// fixture's nullifier and rk so the action is structurally valid.
    fn synthetic_ironwood_action(
        memo: [u8; 512],
        value: u64,
    ) -> (Action<()>, FullViewingKey, orchard::Address) {
        let tx = fixture_tx();
        let template = tx.ironwood_bundle().unwrap().actions().first().clone();
        let nf_old = *template.nullifier();
        let rk = template.rk().clone();

        let fvk = random_fvk();
        let recipient = fvk.address_at(0u32, Scope::External);
        // rho for an Ironwood/Orchard output equals the spent note's nullifier.
        let rho = Rho::from_bytes(&nf_old.to_bytes()).unwrap();
        let mut rseed_bytes = [0u8; 32];
        OsRng.fill_bytes(&mut rseed_bytes);
        let rseed = RandomSeed::from_bytes(rseed_bytes, &rho).unwrap();
        let note = orchard::Note::from_parts(
            recipient,
            NoteValue::from_raw(value),
            rho,
            rseed,
            NoteVersion::V3,
        )
        .unwrap();
        // Any well-formed value commitment works for note encryption; reuse the template's.
        let cv_net = template.cv_net().clone();
        let cmx = ExtractedNoteCommitment::from(note.commitment());
        let encryptor = IronwoodNoteEncryption::new(Some(fvk.to_ovk(Scope::External)), note, memo);
        let encrypted_note = TransmittedNoteCiphertext {
            epk_bytes: IronwoodDomain::epk_bytes(encryptor.epk()).0,
            enc_ciphertext: encryptor.encrypt_note_plaintext(),
            out_ciphertext: encryptor.encrypt_outgoing_plaintext(&cv_net, &cmx, &mut OsRng),
        };
        let action = Action::from_parts(nf_old, rk, cmx, encrypted_note, cv_net, ()).unwrap();
        (action, fvk, recipient)
    }

    #[test]
    fn ironwood_round_trip_ock_derivation_and_recovery() {
        let mut memo = [0u8; 512];
        memo[..12].copy_from_slice(b"INV-2026-042");
        let (action, fvk, recipient) = synthetic_ironwood_action(memo, 123_456);
        let domain = IronwoodDomain::for_action(&action);
        let ovk = fvk.to_ovk(Scope::External);
        let enc = action.encrypted_note();
        let ock = <IronwoodDomain as Domain>::derive_ock(
            &ovk,
            action.cv_net(),
            &action.cmx().to_bytes(),
            &EphemeralKeyBytes(enc.epk_bytes),
        );
        let (note, addr, got_memo) =
            try_output_recovery_with_ock(&domain, &ock, &action, &enc.out_ciphertext)
                .expect("ock opens the output");
        assert_eq!(note.value().inner(), 123_456);
        assert_eq!(addr, recipient);
        assert_eq!(got_memo, memo);

        // Tampered ock must fail closed.
        let mut bad = [0u8; 32];
        bad.copy_from_slice(ock.as_ref());
        bad[3] ^= 0x01;
        assert!(try_output_recovery_with_ock(
            &domain,
            &OutgoingCipherKey(bad),
            &action,
            &enc.out_ciphertext
        )
        .is_none());

        // A different key's ock must fail closed.
        let other = random_fvk().to_ovk(Scope::External);
        let other_ock = <IronwoodDomain as Domain>::derive_ock(
            &other,
            action.cv_net(),
            &action.cmx().to_bytes(),
            &EphemeralKeyBytes(enc.epk_bytes),
        );
        assert!(
            try_output_recovery_with_ock(&domain, &other_ock, &action, &enc.out_ciphertext)
                .is_none()
        );
    }

    /// Same construction for the (sealed) Orchard pool: V2 notes under `OrchardDomain`.
    #[test]
    fn orchard_round_trip_ock_derivation_and_recovery() {
        use orchard::note_encryption::OrchardNoteEncryption;
        let tx = fixture_tx();
        let template = tx.ironwood_bundle().unwrap().actions().first().clone();
        let nf_old = *template.nullifier();
        let rk = template.rk().clone();
        let fvk = random_fvk();
        let recipient = fvk.address_at(0u32, Scope::External);
        let rho = Rho::from_bytes(&nf_old.to_bytes()).unwrap();
        let mut rseed_bytes = [0u8; 32];
        OsRng.fill_bytes(&mut rseed_bytes);
        let rseed = RandomSeed::from_bytes(rseed_bytes, &rho).unwrap();
        let note = orchard::Note::from_parts(
            recipient,
            NoteValue::from_raw(42),
            rho,
            rseed,
            NoteVersion::V2,
        )
        .unwrap();
        let cv_net = template.cv_net().clone();
        let cmx = ExtractedNoteCommitment::from(note.commitment());
        let mut memo = [0u8; 512];
        memo[..6].copy_from_slice(b"orch42");
        let encryptor = OrchardNoteEncryption::new(Some(fvk.to_ovk(Scope::External)), note, memo);
        let enc = TransmittedNoteCiphertext {
            epk_bytes: OrchardDomain::epk_bytes(encryptor.epk()).0,
            enc_ciphertext: encryptor.encrypt_note_plaintext(),
            out_ciphertext: encryptor.encrypt_outgoing_plaintext(&cv_net, &cmx, &mut OsRng),
        };
        let action = Action::from_parts(nf_old, rk, cmx, enc, cv_net, ()).unwrap();
        let domain = OrchardDomain::for_action(&action);
        let ovk = fvk.to_ovk(Scope::External);
        let e = action.encrypted_note();
        let ock = <OrchardDomain as Domain>::derive_ock(
            &ovk,
            action.cv_net(),
            &action.cmx().to_bytes(),
            &EphemeralKeyBytes(e.epk_bytes),
        );
        let (n, a, m) =
            try_output_recovery_with_ock(&domain, &ock, &action, &e.out_ciphertext).unwrap();
        assert_eq!(n.value().inner(), 42);
        assert_eq!(a, recipient);
        assert_eq!(&m[..6], b"orch42");
        // An Ironwood-domain attempt on a V2 note must fail (lead byte mismatch).
        let iw = IronwoodDomain::for_action(&action);
        assert!(try_output_recovery_with_ock(&iw, &ock, &action, &e.out_ciphertext).is_none());
    }

    #[test]
    fn memo_view_classifies_text_and_empty() {
        let mut m = [0u8; 512];
        m[0] = 0xF6; // ZIP 302 empty memo marker
        assert_eq!(MemoView::from_raw(&m), MemoView::Empty);
        let mut t = [0u8; 512];
        t[..5].copy_from_slice(b"hello");
        assert_eq!(MemoView::from_raw(&t), MemoView::Text("hello".into()));
    }

    #[test]
    fn verify_rejects_txid_mismatch_and_wrong_index() {
        let tx = fixture_tx();
        let mut r = Receipt::new(Network::Main, Pool::Ironwood, [0u8; 32], 0, [7u8; 32], "x");
        assert!(matches!(
            verify(&r, &tx, b"", false),
            Err(CoreError::TxidMismatch { .. })
        ));
        let mut txid = [0u8; 32];
        txid.copy_from_slice(&hex::decode(txid_hex(&tx)).unwrap());
        r.txid = hex::encode(txid);
        r.output_index = 9_999;
        assert!(matches!(
            verify(&r, &tx, b"", false),
            Err(CoreError::OutputIndexOutOfRange { .. })
        ));
        r.output_index = 0;
        // Random ock cannot open a real mainnet output.
        assert!(matches!(
            verify(&r, &tx, b"", false),
            Err(CoreError::RecoveryFailed { .. })
        ));
        // Challenge mismatch is checked before recovery.
        let r2 = r.clone().with_challenge(b"abc");
        assert!(matches!(
            verify(&r2, &tx, b"zzz", false),
            Err(CoreError::Types(TypesError::ChallengeMismatch))
        ));
        // Unsigned receipt rejected when signature required.
        assert!(matches!(
            verify(&r, &tx, b"", true),
            Err(CoreError::Types(TypesError::Unsigned))
        ));
    }
}
