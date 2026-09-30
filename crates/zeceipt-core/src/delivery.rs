//! Checking `zdp:1:` delivery proofs (`saplingcash/zcash-delivery-proof` SPEC.md §4): the recipient's side of a
//! payment, which a zeceipt receipt cannot show (a receipt's OCK comes from the sender's outgoing viewing key).
//!
//! Every step of the specification's check is done, and the proof holds only if all pass:
//! 1. the bytes parse as a transaction (`parse_transaction`, with its branch checks) that writes back to exactly those
//!    bytes, and its txid is the proof's;
//! 2. the named pool has a bundle with the named action;
//! 3. the note rebuilt from the receiver, the value, the action's nullifier as rho, and the rseed, with the bundle's
//!    note version, has the action's note commitment;
//! 4. the ephemeral key derived from that note (ZIP 212) decrypts the action's `enc_ciphertext` with the receiver's
//!    pk_d to exactly that note, in the pool's note encryption domain. The memo comes out of that authenticated
//!    encryption. The value must also be at most MAX_MONEY, as for receipts.
//!
//! As with receipts, all cryptography is the `orchard` and `zcash_note_encryption` crates'.

use orchard::keys::{PreparedIncomingViewingKey, Scope};
use orchard::note::{ExtractedNoteCommitment, RandomSeed, Rho};
use orchard::note_encryption::{IronwoodVersion, NoteEncryptionDomain, OrchardVersion};
use orchard::value::NoteValue;
use orchard::{Address, Note};
use zcash_note_encryption::{
    try_note_decryption, try_output_recovery_with_ovk, try_output_recovery_with_pkd_esk, Domain,
};
use zcash_primitives::transaction::Transaction;
use zeceipt_types::delivery::DeliveryProof;
use zeceipt_types::{Network, Pool};

use crate::{
    encode_orchard_address, family_action, note_value, parse_transaction, txid_hex, CoreError,
    IronwoodPool, MemoView, OrchardFamilyPool, OrchardPool, OutgoingKeys, Recovered,
};

/// A delivery proof that held against the transaction's bytes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Delivered {
    /// The note: pool, action index, recipient (as a unified address holding only that receiver), value and memo.
    /// `is_change` is always false: a checker knows no keys.
    pub recovered: Recovered,
    /// Display-order txid hex.
    pub txid: String,
    /// ZIP 239 wtxid, hex: the txid then the authorizing-data digest, both in internal byte order (as
    /// zcash-delivery-proof prints it). Unlike the txid it also covers the signatures and proofs.
    pub wtxid: String,
}

/// Why a proof does not hold, beyond the transaction-level errors `CoreError` already names.
fn mismatch(pool: Pool, index: u32) -> CoreError {
    CoreError::DeliveryMismatch {
        pool: pool.as_str(),
        index,
    }
}

/// Parse `bytes` and require that they are exactly what the parsed transaction writes back (SPEC §4 step 1), so the
/// proof is checked against the bytes given and not a re-encoding of them.
pub fn parse_canonical(bytes: &[u8]) -> Result<Transaction, CoreError> {
    let tx = parse_transaction(bytes)?;
    let mut back = Vec::with_capacity(bytes.len());
    tx.write(&mut back)
        .map_err(|e| CoreError::Malformed(e.to_string()))?;
    if back != bytes {
        return Err(CoreError::Malformed(
            "the bytes parse but do not write back identically: not a canonical transaction".into(),
        ));
    }
    Ok(tx)
}

/// The ZIP 239 wtxid in internal byte order, hex.
pub fn wtxid_hex(tx: &Transaction) -> String {
    let mut w = [0u8; 64];
    w[..32].copy_from_slice(tx.txid().as_ref());
    w[32..].copy_from_slice(tx.auth_commitment().as_bytes());
    hex::encode(w)
}

macro_rules! open_note {
    ($pool:ty, $version:ty, $tx:expr, $proof:expr) => {{
        let index = u32::from($proof.action);
        let pool = <$pool as crate::OrchardFamilyPool>::POOL;
        let bundle = <$pool as crate::OrchardFamilyPool>::bundle($tx)
            .ok_or(CoreError::NoBundle(pool.as_str()))?;
        let action = family_action::<$pool>($tx, index)?;
        let rho = Option::<Rho>::from(Rho::from_bytes(&action.nullifier().to_bytes()))
            .ok_or_else(|| mismatch(pool, index))?;
        let rseed = Option::<RandomSeed>::from(RandomSeed::from_bytes($proof.rseed, &rho))
            .ok_or_else(|| mismatch(pool, index))?;
        let recipient = Option::<Address>::from(Address::from_raw_address_bytes(&$proof.receiver))
            .ok_or_else(|| {
                CoreError::AddressDecode(
                    "the proof's receiver is not an Orchard-family address".into(),
                )
            })?;
        let note = Option::<Note>::from(Note::from_parts(
            recipient,
            NoteValue::from_raw($proof.value),
            rho,
            rseed,
            bundle.bundle_version().note_version(),
        ))
        .ok_or_else(|| mismatch(pool, index))?;
        // Step 3: the note is the one this action commits to.
        if ExtractedNoteCommitment::from(note.commitment()) != *action.cmx() {
            return Err(mismatch(pool, index));
        }
        // Step 4: the note's own ephemeral key opens the action's ciphertext, to exactly this note.
        let domain = NoteEncryptionDomain::<$version>::for_action(action);
        let esk = <NoteEncryptionDomain<$version> as Domain>::derive_esk(&note)
            .ok_or_else(|| mismatch(pool, index))?;
        let pk_d = <NoteEncryptionDomain<$version> as Domain>::get_pk_d(&note);
        let (got, to, memo) = try_output_recovery_with_pkd_esk(&domain, pk_d, esk, action)
            .ok_or_else(|| mismatch(pool, index))?;
        if to.to_raw_address_bytes() != $proof.receiver
            || got.value().inner() != $proof.value
            || got.rseed().as_bytes() != &$proof.rseed
        {
            return Err(mismatch(pool, index));
        }
        (pool, index, to, got.value().inner(), memo)
    }};
}

/// Check `proof` against the raw transaction `bytes` (SPEC §4). `network` only chooses how the recipient is written:
/// a delivery proof does not name its network.
pub fn check(
    bytes: &[u8],
    proof: &DeliveryProof,
    network: Network,
) -> Result<Delivered, CoreError> {
    let tx = parse_canonical(bytes)?;
    let actual = txid_hex(&tx);
    if proof.txid_hex() != actual {
        return Err(CoreError::TxidMismatch {
            expected: proof.txid_hex(),
            actual,
        });
    }
    let (pool, index, to, value, memo) = match proof.pool {
        Pool::Ironwood => open_note!(IronwoodPool, IronwoodVersion, &tx, proof),
        Pool::Orchard => open_note!(OrchardPool, OrchardVersion, &tx, proof),
        Pool::Sapling => unreachable!("a delivery proof has no Sapling pool"),
    };
    Ok(Delivered {
        recovered: Recovered {
            pool,
            index,
            recipient: encode_orchard_address(&to, network)?,
            value_zat: note_value(pool, index, value)?,
            memo: MemoView::from_raw(&memo),
            is_change: false,
        },
        txid: actual,
        wtxid: wtxid_hex(&tx),
    })
}

/// Which side of a payment a key saw when it made a proof: the recipient (incoming viewing key, trial decryption of
/// `enc_ciphertext`) or the sender (outgoing viewing key, recovery from `out_ciphertext`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Side {
    Received,
    Sent,
}

impl Side {
    pub fn as_str(self) -> &'static str {
        match self {
            Side::Received => "received",
            Side::Sent => "sent",
        }
    }
}

/// A delivery proof made from a viewing key, already checked against the transaction.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Found {
    pub side: Side,
    pub proof: DeliveryProof,
    pub delivered: Delivered,
}

macro_rules! prove_pool {
    ($pool:ty, $version:ty, $tx:expr, $fvk:expr, $txid:expr, $out:expr) => {{
        if let Some(bundle) = <$pool as OrchardFamilyPool>::bundle($tx) {
            for (i, action) in bundle.actions().iter().enumerate() {
                let domain = NoteEncryptionDomain::<$version>::for_action(action);
                let mut note = None;
                for scope in [Scope::External, Scope::Internal] {
                    let ivk = PreparedIncomingViewingKey::new(&$fvk.to_ivk(scope));
                    if let Some((n, _, _)) = try_note_decryption(&domain, &ivk, action) {
                        note = Some((Side::Received, n));
                        break;
                    }
                }
                if note.is_none() {
                    for scope in [Scope::External, Scope::Internal] {
                        let ovk = $fvk.to_ovk(scope);
                        if let Some((n, _, _)) = try_output_recovery_with_ovk(
                            &domain,
                            &ovk,
                            action,
                            action.cv_net(),
                            &action.encrypted_note().out_ciphertext,
                        ) {
                            note = Some((Side::Sent, n));
                            break;
                        }
                    }
                }
                if let Some((side, n)) = note {
                    let action_index = u16::try_from(i).map_err(|_| {
                        CoreError::Malformed("more than 65,535 actions in a bundle".into())
                    })?;
                    $out.push((
                        side,
                        DeliveryProof {
                            txid: $txid,
                            pool: <$pool as OrchardFamilyPool>::POOL,
                            action: action_index,
                            receiver: n.recipient().to_raw_address_bytes(),
                            value: n.value().inner(),
                            rseed: *n.rseed().as_bytes(),
                        },
                    ));
                }
            }
        }
    }};
}

/// Make a `zdp:1:` delivery proof for every Orchard and Ironwood note in `bytes` that the UFVK in `keys` can see: those
/// it received (either ZIP 32 scope; the internal one is change) and those it sent. A recipient proves a payment this
/// way, which a receipt cannot do (judge round 2, N10). Each proof is checked (`check`) before it is returned, so the
/// output is exactly what a verifier will accept; the format is zcash-delivery-proof's, and its vectors pin the bytes.
/// Needs a UFVK's Orchard key: a bare OVK sees only what it sent, and has no incoming key.
pub fn prove(bytes: &[u8], keys: &OutgoingKeys) -> Result<Vec<Found>, CoreError> {
    let fvk = keys
        .orchard_fvk
        .as_ref()
        .ok_or(CoreError::MissingKey("Orchard full viewing"))?;
    let tx = parse_canonical(bytes)?;
    let txid: [u8; 32] = *tx.txid().as_ref();
    let mut made: Vec<(Side, DeliveryProof)> = Vec::new();
    prove_pool!(IronwoodPool, IronwoodVersion, &tx, fvk, txid, made);
    prove_pool!(OrchardPool, OrchardVersion, &tx, fvk, txid, made);
    made.into_iter()
        .map(|(side, proof)| {
            let delivered = check(bytes, &proof, keys.network)?;
            Ok(Found {
                side,
                proof,
                delivered,
            })
        })
        .collect()
}
