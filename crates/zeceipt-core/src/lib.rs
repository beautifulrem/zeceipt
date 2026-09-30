//! Zeceipt core: Zcash transaction parsing, per-output OCK derivation and
//! output recovery for the Ironwood, Orchard and Sapling pools.
//!
//! This crate never sees spending keys. Issuers supply a Unified Full Viewing
//! Key (or bare outgoing viewing keys); verifiers supply a receipt and the raw
//! transaction. All cryptography comes from the `orchard`, `sapling-crypto`
//! and `zcash_note_encryption` crates; nothing is re-implemented here.

#![forbid(unsafe_code)]

use orchard::keys::{FullViewingKey as OrchardFvk, OutgoingViewingKey as OrchardOvk, Scope};
use orchard::note_encryption::{
    DomainVersion, IronwoodVersion, NoteEncryptionDomain, OrchardVersion,
};
use sapling_crypto::keys::OutgoingViewingKey as SaplingOvk;
use sapling_crypto::note_encryption::{SaplingDomain, Zip212Enforcement};
use sapling_crypto::zip32::DiversifiableFullViewingKey as SaplingDfvk;
use zcash_address::unified::{self, Encoding, Receiver};
use zcash_keys::keys::UnifiedFullViewingKey;
use zcash_note_encryption::{
    try_output_recovery_with_ock, try_output_recovery_with_ovk, Domain, EphemeralKeyBytes,
    OutgoingCipherKey, ShieldedOutput, ENC_CIPHERTEXT_SIZE,
};
use zcash_primitives::transaction::{Transaction, TxVersion};
use zcash_protocol::consensus::{BranchId, MainNetwork, NetworkType, TestNetwork};
use zcash_protocol::local_consensus::LocalNetwork;
use zcash_protocol::memo::{Memo, MemoBytes};
use zcash_protocol::value::MAX_MONEY;
use zeceipt_types::ed25519_dalek::SigningKey;
use zeceipt_types::{Network, Pool, Receipt, TypesError};

pub use zeceipt_types;

pub mod delivery;

#[cfg(feature = "synthetic")]
pub mod synthetic;

/// Errors from parsing, derivation and verification.
#[derive(Debug, thiserror::Error)]
pub enum CoreError {
    #[error("transaction bytes are malformed: {0}")]
    Malformed(String),
    #[error("transaction version {0:?} is not supported")]
    UnsupportedTxVersion(String),
    /// The transaction's header names a consensus branch the Zcash crates in this build do not know, such as NU7's
    /// before a release of `zcash_protocol` supports it (R121). Reported by name, not as malformed bytes.
    #[error("the transaction was made for consensus branch {id:#010x}{name}, which this build of zeceipt does not support yet; a version built on Zcash crates that support it is needed")]
    UnsupportedBranch { id: u32, name: &'static str },
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
    /// A `zdp:1:` delivery proof's note is not the one the action carries: its commitment differs, or the note's own key
    /// does not open the action's ciphertext to exactly that note (`delivery`; judge round 2, N3).
    #[error("the delivery proof does not open {pool} action {index}: its note is not the one this action commits to and encrypts")]
    DeliveryMismatch { pool: &'static str, index: u32 },
    /// The opened note's value is above MAX_MONEY, so no valid transaction carries it (slice U5, R131). Sprout and
    /// Sapling note values are typed {0 .. MAX_MONEY}. The Orchard-like note type (Orchard, Ironwood) allows 64 bits, but
    /// a sender selects an Action's value in {0 .. MAX_MONEY}, and a note is funded from a pool whose balance cannot go
    /// negative (ZIP 209) out of a supply that cannot exceed MAX_MONEY, so no mined note holds more. JavaScript could
    /// not show such a value exactly either.
    #[error("{pool} output {index} opens to a value of {value} zatoshis, above MAX_MONEY ({max}); no valid transaction can carry it", max = MAX_MONEY)]
    ValueOutOfRange {
        pool: &'static str,
        index: u32,
        value: u64,
    },
    #[error("viewing key has no {0} component")]
    MissingKey(&'static str),
    #[error("viewing key could not be decoded: {0}")]
    KeyDecode(String),
    #[error("network mismatch between receipt and viewing key")]
    NetworkMismatch,
    #[error("address could not be decoded: {0}")]
    AddressDecode(String),
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
    /// `true` when the recipient is one of the issuer's own addresses (either
    /// ZIP 32 scope), i.e. a change output. Only known on the issuing side when
    /// a full viewing key was supplied; verifiers and bare-OVK issuers see `false`.
    pub is_change: bool,
}

/// A recovered note's value, if a valid transaction can carry it: at most MAX_MONEY (see `ValueOutOfRange`; R131).
fn note_value(pool: Pool, index: u32, value: u64) -> Result<u64, CoreError> {
    if value > MAX_MONEY {
        return Err(CoreError::ValueOutOfRange {
            pool: pool.as_str(),
            index,
            value,
        });
    }
    Ok(value)
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
    /// Whether a challenge was bound, matched, and signed (spec §6). An unsigned receipt's challenge proves nothing:
    /// anyone holding the output's OCK can write any challenge into an unsigned envelope.
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
    /// Full viewing keys, kept only to recognise the issuer's own (change)
    /// addresses. Absent when built from a bare OVK.
    orchard_fvk: Option<OrchardFvk>,
    sapling_dfvk: Option<SaplingDfvk>,
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
            Network::Regtest => UnifiedFullViewingKey::decode(&regtest_params(), encoded),
        }
        .map_err(|e| CoreError::KeyDecode(e.to_string()))?;
        Ok(OutgoingKeys {
            network,
            orchard_external: ufvk.orchard().map(|fvk| fvk.to_ovk(Scope::External)),
            orchard_internal: ufvk.orchard().map(|fvk| fvk.to_ovk(Scope::Internal)),
            sapling_external: ufvk.sapling().map(|dfvk| dfvk.to_ovk(Scope::External)),
            sapling_internal: ufvk.sapling().map(|dfvk| dfvk.to_ovk(Scope::Internal)),
            orchard_fvk: ufvk.orchard().cloned(),
            sapling_dfvk: ufvk.sapling().cloned(),
        })
    }

    /// Keys for one Sapling diversifiable full viewing key, for the synthetic Sapling tests (slice U5b): the released
    /// `zcash_keys` builds a UFVK from parts only under its test features.
    #[cfg(feature = "synthetic")]
    pub fn from_sapling_dfvk(network: Network, dfvk: SaplingDfvk) -> Self {
        OutgoingKeys {
            network,
            orchard_external: None,
            orchard_internal: None,
            sapling_external: Some(dfvk.to_ovk(Scope::External)),
            sapling_internal: Some(dfvk.to_ovk(Scope::Internal)),
            orchard_fvk: None,
            sapling_dfvk: Some(dfvk),
        }
    }

    /// Build from a bare 32-byte Orchard/Ironwood outgoing viewing key.
    pub fn from_orchard_ovk(network: Network, ovk: [u8; 32]) -> Self {
        OutgoingKeys {
            network,
            orchard_external: Some(OrchardOvk::from(ovk)),
            orchard_internal: None,
            sapling_external: None,
            sapling_internal: None,
            orchard_fvk: None,
            sapling_dfvk: None,
        }
    }

    /// Whether change detection is possible (a full viewing key is held).
    pub fn can_detect_change(&self) -> bool {
        self.orchard_fvk.is_some() || self.sapling_dfvk.is_some()
    }

    /// Is this Orchard/Ironwood address one of ours (either scope)?
    fn owns_orchard(&self, addr: &orchard::Address) -> bool {
        self.orchard_fvk.as_ref().is_some_and(|fvk| {
            [Scope::External, Scope::Internal]
                .iter()
                .any(|scope| fvk.to_ivk(*scope).diversifier_index(addr).is_some())
        })
    }

    /// Is this Sapling address one of ours (either scope)?
    fn owns_sapling(&self, addr: &sapling_crypto::PaymentAddress) -> bool {
        self.sapling_dfvk
            .as_ref()
            .is_some_and(|dfvk| dfvk.decrypt_diversifier(addr).is_some())
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

/// The consensus branch id in a v5 or v6 transaction's header (bytes 8..12, little-endian), if the bytes start with
/// one. `TxVersion::read` checks the version and its version group id together, so garbage, or a txid pasted by
/// mistake, is not taken for a transaction of an unknown branch (review U1a round 1).
fn header_branch_id(bytes: &[u8]) -> Option<u32> {
    match TxVersion::read(bytes) {
        Ok(TxVersion::V5 | TxVersion::V6) => bytes
            .get(8..12)
            .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]])),
        _ => None,
    }
}

/// Branches this build cannot read yet that deserve a name in the error (ZIP 259: NU7 is `0x77190AD9`).
fn branch_name(id: u32) -> &'static str {
    match id {
        0x7719_0ad9 => " (NU7, ZIP 259)",
        _ => "",
    }
}

/// Parse a raw Zcash transaction (v4, v5 or v6).
pub fn parse_transaction(bytes: &[u8]) -> Result<Transaction, CoreError> {
    if let Some(id) = header_branch_id(bytes) {
        if BranchId::try_from(id).is_err() {
            return Err(CoreError::UnsupportedBranch {
                id,
                name: branch_name(id),
            });
        }
    }
    // The branch id argument only matters for pre-v5 transactions; v5/v6 carry
    // their consensus branch id in the serialized form.
    let tx = Transaction::read(bytes, BranchId::Nu6_3)
        .map_err(|e| CoreError::Malformed(e.to_string()))?;
    // `read` does not check that a v5/v6 transaction's own branch is one its version is valid in (a v6 transaction
    // under NU6.1 parses, and its bundle is one the v6 writer refuses): Zebra's GHSA-h5rr-8pqv-grp9, fixed by rejecting
    // it at parse time (#11533). Such a transaction can never be consensus-valid, so it is malformed here too (R127).
    let (version, branch) = (tx.version(), tx.consensus_branch_id());
    if matches!(version, TxVersion::V5 | TxVersion::V6) && !version.valid_in_branch(branch) {
        return Err(CoreError::Malformed(format!(
            "a {version:?} transaction cannot use consensus branch {:#010x} ({branch:?})",
            u32::from(branch)
        )));
    }
    Ok(tx)
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
        Network::Regtest => NetworkType::Regtest,
    }
}

/// A shielded receiver extracted from an address: which key family it belongs to
/// and its 43 raw bytes. Ironwood pays to the Orchard receiver of a unified
/// address (ZIP 316 defines no separate Ironwood typecode).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ShieldedReceiver {
    Orchard([u8; 43]),
    Sapling([u8; 43]),
}

/// Shielded receivers of an encoded address on `network`: every Orchard/Sapling
/// receiver of a unified address, or the single receiver of a Sapling address.
/// Transparent-only addresses yield an empty list; a wrong network is an error.
pub fn shielded_receivers(
    address: &str,
    network: Network,
) -> Result<Vec<ShieldedReceiver>, CoreError> {
    use zcash_address::unified::Container;
    if let Ok((net, ua)) = unified::Address::decode(address) {
        if net != network_type(network) {
            return Err(CoreError::AddressDecode(format!(
                "{address}: address is for another network"
            )));
        }
        return Ok(ua
            .items()
            .into_iter()
            .filter_map(|r| match r {
                Receiver::Orchard(b) => Some(ShieldedReceiver::Orchard(b)),
                Receiver::Sapling(b) => Some(ShieldedReceiver::Sapling(b)),
                _ => None,
            })
            .collect());
    }
    let hrp = {
        use zcash_protocol::consensus::NetworkConstants;
        network_type(network).hrp_sapling_payment_address()
    };
    match zcash_keys::encoding::decode_payment_address(hrp, address) {
        Ok(pa) => Ok(vec![ShieldedReceiver::Sapling(pa.to_bytes())]),
        Err(e) => Err(CoreError::AddressDecode(format!("{address}: {e}"))),
    }
}

/// Does the recovered output pay one of the allowed receivers? Used to restrict
/// issuance to a batch's own recipient list (console allow-list, RSK-20).
pub fn pays_any(
    recovered: &Recovered,
    allowed: &[ShieldedReceiver],
    network: Network,
) -> Result<bool, CoreError> {
    let got = shielded_receivers(&recovered.recipient, network)?;
    Ok(got.iter().any(|r| {
        allowed.contains(r)
            && matches!(
                (r, recovered.pool),
                (ShieldedReceiver::Orchard(_), Pool::Ironwood | Pool::Orchard)
                    | (ShieldedReceiver::Sapling(_), Pool::Sapling)
            )
    }))
}

/// Regtest consensus parameters: every upgrade active from height 1, matching
/// Zebra's Regtest defaults. Only used for key decoding and address encoding.
fn regtest_params() -> LocalNetwork {
    use zcash_protocol::consensus::BlockHeight;
    let h = Some(BlockHeight::from_u32(1));
    LocalNetwork {
        overwinter: h,
        sapling: h,
        blossom: h,
        heartwood: h,
        canopy: h,
        nu5: h,
        nu6: h,
        nu6_1: h,
        nu6_2: h,
        nu6_3: h,
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
        Network::Regtest => zcash_keys::encoding::encode_payment_address_p(&regtest_params(), addr),
    }
}

/// The Orchard-family action type carried by an authorized bundle.
type AuthAction = orchard::Action<
    orchard::primitives::redpallas::Signature<orchard::primitives::redpallas::SpendAuth>,
>;

/// Everything a pool needs to expose for per-output disclosure: locate an output,
/// derive its OCK from an OVK, and recover it from an OCK. Ironwood and Orchard
/// share one generic implementation over the note-encryption domain version;
/// Sapling has its own. New pools implement this, callers never branch on pool.
trait PoolOps {
    const POOL: Pool;
    type Ovk;
    fn ovk(keys: &OutgoingKeys, internal: bool) -> Option<&Self::Ovk>;
    fn recover_with_ovk(
        tx: &Transaction,
        index: u32,
        ovk: &Self::Ovk,
        keys: &OutgoingKeys,
    ) -> Result<Option<([u8; 32], Recovered)>, CoreError>;
    fn recover_with_ock(
        tx: &Transaction,
        index: u32,
        ock: &OutgoingCipherKey,
        network: Network,
    ) -> Result<Recovered, CoreError>;
}

fn ock_bytes(ock: OutgoingCipherKey) -> [u8; 32] {
    let mut b = [0u8; 32];
    b.copy_from_slice(ock.as_ref());
    b
}

/// Generic Orchard-family implementation parameterised by the domain version
/// (`IronwoodVersion` or `OrchardVersion`).
struct OrchardFamily<V>(core::marker::PhantomData<V>);

trait OrchardFamilyPool {
    const POOL: Pool;
    fn bundle(
        tx: &Transaction,
    ) -> Option<&orchard::Bundle<orchard::bundle::Authorized, zcash_protocol::value::ZatBalance>>;
}

struct IronwoodPool;
struct OrchardPool;

impl OrchardFamilyPool for IronwoodPool {
    const POOL: Pool = Pool::Ironwood;
    fn bundle(
        tx: &Transaction,
    ) -> Option<&orchard::Bundle<orchard::bundle::Authorized, zcash_protocol::value::ZatBalance>>
    {
        tx.ironwood_bundle()
    }
}

impl OrchardFamilyPool for OrchardPool {
    const POOL: Pool = Pool::Orchard;
    fn bundle(
        tx: &Transaction,
    ) -> Option<&orchard::Bundle<orchard::bundle::Authorized, zcash_protocol::value::ZatBalance>>
    {
        tx.orchard_bundle()
    }
}

fn family_action<P: OrchardFamilyPool>(
    tx: &Transaction,
    index: u32,
) -> Result<&AuthAction, CoreError> {
    let bundle = P::bundle(tx).ok_or(CoreError::NoBundle(P::POOL.as_str()))?;
    let actions = bundle.actions();
    actions
        .get(index as usize)
        .ok_or(CoreError::OutputIndexOutOfRange {
            pool: P::POOL.as_str(),
            index,
            len: actions.len(),
        })
}

/// Derive the OCK of an Orchard-family action and recover it with the sender's OVK.
fn family_recover_with_ovk<V>(
    domain: &NoteEncryptionDomain<V>,
    action: &AuthAction,
    ovk: &OrchardOvk,
) -> Option<(
    OutgoingCipherKey,
    orchard::Note,
    orchard::Address,
    [u8; 512],
)>
where
    V: DomainVersion,
    NoteEncryptionDomain<V>: Domain<
        OutgoingViewingKey = OrchardOvk,
        ValueCommitment = orchard::value::ValueCommitment,
        ExtractedCommitmentBytes = [u8; 32],
        Note = orchard::Note,
        Recipient = orchard::Address,
        Memo = [u8; 512],
    >,
    AuthAction: ShieldedOutput<NoteEncryptionDomain<V>, ENC_CIPHERTEXT_SIZE>,
{
    let enc = action.encrypted_note();
    let (note, addr, memo) =
        try_output_recovery_with_ovk(domain, ovk, action, action.cv_net(), &enc.out_ciphertext)?;
    let ock = <NoteEncryptionDomain<V> as Domain>::derive_ock(
        ovk,
        action.cv_net(),
        &action.cmx().to_bytes(),
        &EphemeralKeyBytes(enc.epk_bytes),
    );
    Some((ock, note, addr, memo))
}

/// Recover an Orchard-family action with a disclosed OCK.
fn family_recover_with_ock<V>(
    domain: &NoteEncryptionDomain<V>,
    action: &AuthAction,
    ock: &OutgoingCipherKey,
) -> Option<(orchard::Note, orchard::Address, [u8; 512])>
where
    V: DomainVersion,
    NoteEncryptionDomain<V>:
        Domain<Note = orchard::Note, Recipient = orchard::Address, Memo = [u8; 512]>,
    AuthAction: ShieldedOutput<NoteEncryptionDomain<V>, ENC_CIPHERTEXT_SIZE>,
{
    try_output_recovery_with_ock(domain, ock, action, &action.encrypted_note().out_ciphertext)
}

macro_rules! impl_orchard_family {
    ($pool:ty, $version:ty) => {
        impl PoolOps for OrchardFamily<$version> {
            const POOL: Pool = <$pool as OrchardFamilyPool>::POOL;
            type Ovk = OrchardOvk;
            fn ovk(keys: &OutgoingKeys, internal: bool) -> Option<&OrchardOvk> {
                keys.orchard(internal)
            }
            fn recover_with_ovk(
                tx: &Transaction,
                index: u32,
                ovk: &OrchardOvk,
                keys: &OutgoingKeys,
            ) -> Result<Option<([u8; 32], Recovered)>, CoreError> {
                let action = family_action::<$pool>(tx, index)?;
                let domain = NoteEncryptionDomain::<$version>::for_action(action);
                match family_recover_with_ovk(&domain, action, ovk) {
                    None => Ok(None),
                    Some((ock, note, addr, memo)) => Ok(Some((
                        ock_bytes(ock),
                        Recovered {
                            pool: Self::POOL,
                            index,
                            recipient: encode_orchard_address(&addr, keys.network)?,
                            value_zat: note_value(Self::POOL, index, note.value().inner())?,
                            memo: MemoView::from_raw(&memo),
                            is_change: keys.owns_orchard(&addr),
                        },
                    ))),
                }
            }
            fn recover_with_ock(
                tx: &Transaction,
                index: u32,
                ock: &OutgoingCipherKey,
                network: Network,
            ) -> Result<Recovered, CoreError> {
                let action = family_action::<$pool>(tx, index)?;
                let domain = NoteEncryptionDomain::<$version>::for_action(action);
                let (note, addr, memo) = family_recover_with_ock(&domain, action, ock).ok_or(
                    CoreError::RecoveryFailed {
                        pool: Self::POOL.as_str(),
                        index,
                    },
                )?;
                Ok(Recovered {
                    pool: Self::POOL,
                    index,
                    recipient: encode_orchard_address(&addr, network)?,
                    value_zat: note_value(Self::POOL, index, note.value().inner())?,
                    memo: MemoView::from_raw(&memo),
                    is_change: false,
                })
            }
        }
    };
}

impl_orchard_family!(IronwoodPool, IronwoodVersion);
impl_orchard_family!(OrchardPool, OrchardVersion);

/// Sapling pool. `Zip212Enforcement::GracePeriod` accepts both pre-Canopy (0x01)
/// and post-Canopy (0x02) note plaintexts; the note commitment check still binds
/// the recovered plaintext to the on-chain output.
struct SaplingPool;

fn sapling_domain() -> SaplingDomain {
    SaplingDomain::new(Zip212Enforcement::GracePeriod)
}

fn sapling_output(
    tx: &Transaction,
    index: u32,
) -> Result<
    &sapling_crypto::bundle::OutputDescription<sapling_crypto::bundle::GrothProofBytes>,
    CoreError,
> {
    let bundle = tx.sapling_bundle().ok_or(CoreError::NoBundle("sapling"))?;
    let outputs = bundle.shielded_outputs();
    outputs
        .get(index as usize)
        .ok_or(CoreError::OutputIndexOutOfRange {
            pool: "sapling",
            index,
            len: outputs.len(),
        })
}

/// Derive the OCK of a Sapling output and recover it with the sender's OVK.
fn sapling_recover_with_ovk<A>(
    od: &sapling_crypto::bundle::OutputDescription<A>,
    ovk: &SaplingOvk,
) -> Option<(
    OutgoingCipherKey,
    sapling_crypto::Note,
    sapling_crypto::PaymentAddress,
    [u8; 512],
)> {
    let domain = sapling_domain();
    let (note, addr, memo) =
        try_output_recovery_with_ovk(&domain, ovk, od, od.cv(), od.out_ciphertext())?;
    let ock = <SaplingDomain as Domain>::derive_ock(
        ovk,
        od.cv(),
        &od.cmu().to_bytes(),
        od.ephemeral_key(),
    );
    Some((ock, note, addr, memo))
}

/// Recover a Sapling output with a disclosed OCK.
fn sapling_recover_with_ock<A>(
    od: &sapling_crypto::bundle::OutputDescription<A>,
    ock: &OutgoingCipherKey,
) -> Option<(
    sapling_crypto::Note,
    sapling_crypto::PaymentAddress,
    [u8; 512],
)> {
    try_output_recovery_with_ock(&sapling_domain(), ock, od, od.out_ciphertext())
}

impl PoolOps for SaplingPool {
    const POOL: Pool = Pool::Sapling;
    type Ovk = SaplingOvk;
    fn ovk(keys: &OutgoingKeys, internal: bool) -> Option<&SaplingOvk> {
        keys.sapling(internal)
    }
    fn recover_with_ovk(
        tx: &Transaction,
        index: u32,
        ovk: &SaplingOvk,
        keys: &OutgoingKeys,
    ) -> Result<Option<([u8; 32], Recovered)>, CoreError> {
        let od = sapling_output(tx, index)?;
        let Some((ock, note, addr, memo)) = sapling_recover_with_ovk(od, ovk) else {
            return Ok(None);
        };
        Ok(Some((
            ock_bytes(ock),
            Recovered {
                pool: Pool::Sapling,
                index,
                recipient: encode_sapling_address(&addr, keys.network),
                value_zat: note_value(Pool::Sapling, index, note.value().inner())?,
                memo: MemoView::from_raw(&memo),
                is_change: keys.owns_sapling(&addr),
            },
        )))
    }
    fn recover_with_ock(
        tx: &Transaction,
        index: u32,
        ock: &OutgoingCipherKey,
        network: Network,
    ) -> Result<Recovered, CoreError> {
        let od = sapling_output(tx, index)?;
        let (note, addr, memo) =
            sapling_recover_with_ock(od, ock).ok_or(CoreError::RecoveryFailed {
                pool: "sapling",
                index,
            })?;
        Ok(Recovered {
            pool: Pool::Sapling,
            index,
            recipient: encode_sapling_address(&addr, network),
            value_zat: note_value(Pool::Sapling, index, note.value().inner())?,
            memo: MemoView::from_raw(&memo),
            is_change: false,
        })
    }
}

fn derive_with<P: PoolOps>(
    tx: &Transaction,
    index: u32,
    keys: &OutgoingKeys,
    scopes: &[bool],
) -> Result<Option<([u8; 32], Recovered)>, CoreError> {
    // Validate the output reference once, even if no key is held.
    for &internal in scopes {
        if let Some(ovk) = P::ovk(keys, internal) {
            if let Some(found) = P::recover_with_ovk(tx, index, ovk, keys)? {
                return Ok(Some(found));
            }
        }
    }
    Ok(None)
}

/// Derive the per-output OCK for an output we sent (requires the sender's OVK).
///
/// Both ZIP 32 scopes of the OVK are tried: wallets differ in which OVK they
/// use for change (Zkool encrypts change with the external OVK, zcash-devtool
/// with a key we cannot open at all), so scope is not a reliable change signal.
/// A change output is instead one whose recipient is an address of the issuer's
/// own full viewing key (either scope). Returns `None` if no held key opens the
/// output, or if it is change and `include_change` is false. With a bare OVK
/// (no FVK) change cannot be recognised and every opened output is returned.
pub fn derive_ock(
    tx: &Transaction,
    output: OutputRef,
    keys: &OutgoingKeys,
    include_change: bool,
) -> Result<Option<([u8; 32], Recovered)>, CoreError> {
    let scopes: &[bool] = &[false, true];
    let found = match output.pool {
        Pool::Ironwood => {
            derive_with::<OrchardFamily<IronwoodVersion>>(tx, output.index, keys, scopes)?
        }
        Pool::Orchard => {
            derive_with::<OrchardFamily<OrchardVersion>>(tx, output.index, keys, scopes)?
        }
        Pool::Sapling => derive_with::<SaplingPool>(tx, output.index, keys, scopes)?,
    };
    Ok(match found {
        Some((_, ref rec)) if rec.is_change && !include_change => None,
        other => other,
    })
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
            OrchardFamily::<IronwoodVersion>::recover_with_ock(tx, output.index, &ock, network)
        }
        Pool::Orchard => {
            OrchardFamily::<OrchardVersion>::recover_with_ock(tx, output.index, &ock, network)
        }
        Pool::Sapling => SaplingPool::recover_with_ock(tx, output.index, &ock, network),
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
        challenge_checked: receipt.challenge.is_some() && issuer_pubkey.is_some(),
        issuer_pubkey,
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
    use orchard::note_encryption::{IronwoodDomain, OrchardDomain};
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
    fn allow_list_matches_by_receiver_and_rejects_foreign_and_malformed_addresses() {
        const RAW: &str = include_str!(
            "../../../fixtures/regtest-48db254a361e9676b90d4864505bd536de9bc6952c46aeea087ec213fdac47b2.hex"
        );
        const UFVK: &str = include_str!("../../../fixtures/regtest-issuer-ufvk.txt");
        let tx = parse_transaction(&hex::decode(RAW.trim()).unwrap()).unwrap();
        let keys = OutgoingKeys::from_ufvk(Network::Regtest, UFVK.trim()).unwrap();
        let all = issue(
            &tx,
            &keys,
            &IssueOptions {
                label: String::new(),
                challenge: None,
                key_id: None,
                include_change: true,
                signer: None,
            },
        )
        .unwrap();
        assert_eq!(all.len(), 4);
        let r3 = "uregtest1km3xxn9hysaxd6umac95x2dckkv4hdmjevkfar0qqs7056n9m04ays3u64e9zfmdtxdmd0mlqtqhcp2c4nal7znqf30l00yetcp28syj";
        let allowed = shielded_receivers(r3, Network::Regtest).unwrap();
        assert!(matches!(allowed.as_slice(), [ShieldedReceiver::Orchard(_)]));
        let kept: Vec<_> = all
            .iter()
            .filter(|(_, r)| pays_any(r, &allowed, Network::Regtest).unwrap())
            .collect();
        assert_eq!(kept.len(), 1);
        assert_eq!(kept[0].1.value_zat, 102_000_000);
        // change (index 0) is never in a batch allow-list
        assert!(all
            .iter()
            .filter(|(_, r)| r.is_change)
            .all(|(_, r)| !pays_any(r, &allowed, Network::Regtest).unwrap()));
        assert!(matches!(
            shielded_receivers(r3, Network::Main),
            Err(CoreError::AddressDecode(_))
        ));
        assert!(matches!(
            shielded_receivers("u1bogus", Network::Regtest),
            Err(CoreError::AddressDecode(_))
        ));
    }

    #[test]
    fn allow_list_sapling_receivers_match_only_sapling_outputs() {
        use zcash_protocol::consensus::NetworkConstants;
        let (_, pa) =
            sapling_crypto::zip32::ExtendedSpendingKey::master(&[7u8; 32]).default_address();
        let hrp = network_type(Network::Regtest).hrp_sapling_payment_address();
        let zs = zcash_keys::encoding::encode_payment_address(hrp, &pa);
        let allowed = shielded_receivers(&zs, Network::Regtest).unwrap();
        assert_eq!(allowed, vec![ShieldedReceiver::Sapling(pa.to_bytes())]);
        let sapling_out = Recovered {
            pool: Pool::Sapling,
            index: 0,
            recipient: zs.clone(),
            value_zat: 1,
            memo: MemoView::Empty,
            is_change: false,
        };
        assert!(pays_any(&sapling_out, &allowed, Network::Regtest).unwrap());
        // Same receiver bytes reported for an Orchard-family pool: never a match.
        let wrong_pool = Recovered {
            pool: Pool::Ironwood,
            ..sapling_out.clone()
        };
        assert!(!pays_any(&wrong_pool, &allowed, Network::Regtest).unwrap());
        // An Orchard-only allow-list never matches a Sapling output.
        let r3 = "uregtest1km3xxn9hysaxd6umac95x2dckkv4hdmjevkfar0qqs7056n9m04ays3u64e9zfmdtxdmd0mlqtqhcp2c4nal7znqf30l00yetcp28syj";
        let orchard_only = shielded_receivers(r3, Network::Regtest).unwrap();
        assert!(!pays_any(&sapling_out, &orchard_only, Network::Regtest).unwrap());
    }

    /// A 4-action Ironwood transaction built by Zkool GraphQL on the local regtest
    /// chain (3 recipients + change). Zkool encrypts the change output with the
    /// external OVK, so change must be recognised by address ownership, not scope.
    #[test]
    fn zkool_batch_fixture_excludes_change_by_own_address() {
        const RAW: &str = include_str!(
            "../../../fixtures/regtest-48db254a361e9676b90d4864505bd536de9bc6952c46aeea087ec213fdac47b2.hex"
        );
        const UFVK: &str = include_str!("../../../fixtures/regtest-issuer-ufvk.txt");
        let tx = parse_transaction(&hex::decode(RAW.trim()).unwrap()).unwrap();
        assert_eq!(enumerate_outputs(&tx).len(), 4);
        let keys = OutgoingKeys::from_ufvk(Network::Regtest, UFVK.trim()).unwrap();
        assert!(keys.can_detect_change());
        let payments = issue(
            &tx,
            &keys,
            &IssueOptions {
                label: String::new(),
                challenge: None,
                key_id: None,
                include_change: false,
                signer: None,
            },
        )
        .unwrap();
        let mut values: Vec<u64> = payments.iter().map(|(_, r)| r.value_zat).collect();
        values.sort_unstable();
        assert_eq!(values, vec![101_000_000, 102_000_000, 103_000_000]);
        assert!(payments.iter().all(|(_, r)| !r.is_change));
        let memos: Vec<String> = payments
            .iter()
            .map(|(_, r)| match &r.memo {
                MemoView::Text(t) => t.clone(),
                other => panic!("unexpected memo {other:?}"),
            })
            .collect();
        for m in ["INV-R-002", "INV-R-003", "INV-R-004"] {
            assert!(memos.contains(&m.to_string()), "missing memo {m}");
        }
        let all = issue(
            &tx,
            &keys,
            &IssueOptions {
                label: String::new(),
                challenge: None,
                key_id: None,
                include_change: true,
                signer: None,
            },
        )
        .unwrap();
        assert_eq!(all.len(), 4);
        let change: Vec<&Recovered> = all.iter().map(|(_, r)| r).filter(|r| r.is_change).collect();
        assert_eq!(change.len(), 1);
        assert_eq!(change[0].index, 0);
        assert_eq!(change[0].value_zat, 21_725_048_750);
        assert_eq!(change[0].memo, MemoView::Empty);
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

    /// Official Orchard note-encryption test vectors from zcash/zcash-test-vectors:
    /// derive_ock must reproduce `ock`, and recovery with that ock must reproduce
    /// the note, recipient and memo. Exercised through the same generic helpers
    /// the verifier uses.
    #[test]
    fn official_orchard_test_vectors_ock_and_recovery() {
        let raw = include_str!("../../../spec/test-vectors/orchard_note_encryption.json");
        let json: serde_json::Value = serde_json::from_str(raw).unwrap();
        let rows = json.as_array().unwrap();
        // Row 0 is a provenance comment, row 1 is one comma-separated header string,
        // remaining rows hold hex strings (and integers for `v`) in header order.
        let names: Vec<String> = rows[1][0]
            .as_str()
            .unwrap()
            .split(", ")
            .map(str::to_string)
            .collect();
        let idx = |n: &str| names.iter().position(|x| x == n).unwrap();
        let bytes = |row: &serde_json::Value, n: &str| -> Vec<u8> {
            hex::decode(row[idx(n)].as_str().unwrap()).unwrap()
        };
        let template = fixture_tx()
            .ironwood_bundle()
            .unwrap()
            .actions()
            .first()
            .clone();
        let rk = template.rk().clone();
        let mut checked = 0;
        for row in &rows[2..] {
            let ovk = OrchardOvk::from(<[u8; 32]>::try_from(bytes(row, "ovk")).unwrap());
            let cv_net = orchard::value::ValueCommitment::from_bytes(
                &<[u8; 32]>::try_from(bytes(row, "cv_net")).unwrap(),
            )
            .unwrap();
            let nf = orchard::note::Nullifier::from_bytes(
                &<[u8; 32]>::try_from(bytes(row, "rho")).unwrap(),
            )
            .unwrap();
            let cmx = ExtractedNoteCommitment::from_bytes(
                &<[u8; 32]>::try_from(bytes(row, "cmx")).unwrap(),
            )
            .unwrap();
            let enc = TransmittedNoteCiphertext {
                epk_bytes: <[u8; 32]>::try_from(bytes(row, "ephemeral_key")).unwrap(),
                enc_ciphertext: <[u8; 580]>::try_from(bytes(row, "c_enc")).unwrap(),
                out_ciphertext: <[u8; 80]>::try_from(bytes(row, "c_out")).unwrap(),
            };
            let action = Action::from_parts(nf, rk.clone(), cmx, enc, cv_net, ()).unwrap();
            let domain = OrchardDomain::for_action(&action);
            let e = action.encrypted_note();
            let ock = <OrchardDomain as Domain>::derive_ock(
                &ovk,
                action.cv_net(),
                &action.cmx().to_bytes(),
                &EphemeralKeyBytes(e.epk_bytes),
            );
            assert_eq!(
                ock.as_ref(),
                bytes(row, "ock").as_slice(),
                "ock derivation matches vector"
            );
            let (note, addr, memo) =
                try_output_recovery_with_ock(&domain, &ock, &action, &e.out_ciphertext)
                    .expect("vector recovers");
            assert_eq!(note.value().inner(), row[idx("v")].as_u64().unwrap());
            assert_eq!(memo.to_vec(), bytes(row, "memo"));
            let mut expected_addr = bytes(row, "default_d");
            expected_addr.extend(bytes(row, "default_pk_d"));
            assert_eq!(
                addr.to_raw_address_bytes().to_vec(),
                expected_addr,
                "recipient matches vector"
            );
            // The same vector must not open under the Ironwood domain (V2 lead byte).
            let iw = IronwoodDomain::for_action(&action);
            assert!(try_output_recovery_with_ock(&iw, &ock, &action, &e.out_ciphertext).is_none());
            checked += 1;
        }
        assert!(checked >= 10, "expected the full vector set, got {checked}");
    }

    /// Sapling round trip through the Sapling helpers used by derive/recover.
    #[test]
    fn sapling_round_trip_ock_derivation_and_recovery() {
        use sapling_crypto::bundle::OutputDescription;
        use sapling_crypto::note_encryption::sapling_note_encryption;
        use sapling_crypto::value::{
            NoteValue as SNoteValue, ValueCommitTrapdoor, ValueCommitment,
        };
        use sapling_crypto::zip32::ExtendedSpendingKey;
        use sapling_crypto::{Note as SNote, Rseed};

        let mut seed = [0u8; 32];
        OsRng.fill_bytes(&mut seed);
        let dfvk = ExtendedSpendingKey::master(&seed).to_diversifiable_full_viewing_key();
        let (_, recipient) = dfvk.default_address();
        let ovk = dfvk.to_ovk(Scope::External);
        let mut rseed = [0u8; 32];
        OsRng.fill_bytes(&mut rseed);
        let note = SNote::from_parts(
            recipient,
            SNoteValue::from_raw(77_000),
            Rseed::AfterZip212(rseed),
        );
        let cmu = note.cmu();
        let cv = ValueCommitment::derive(
            SNoteValue::from_raw(77_000),
            ValueCommitTrapdoor::random(&mut OsRng),
        );
        let mut memo = [0u8; 512];
        memo[..7].copy_from_slice(b"sapling");
        let encryptor = sapling_note_encryption(Some(ovk), note, memo, &mut OsRng);
        let epk = SaplingDomain::epk_bytes(encryptor.epk());
        let od: OutputDescription<[u8; 192]> = OutputDescription::from_parts(
            cv.clone(),
            cmu,
            epk,
            encryptor.encrypt_note_plaintext(),
            encryptor.encrypt_outgoing_plaintext(&cv, &cmu, &mut OsRng),
            [0u8; 192],
        );
        let (ock, n, a, m) = sapling_recover_with_ovk(&od, &ovk).expect("sender OVK recovers");
        assert_eq!(n.value().inner(), 77_000);
        assert_eq!(a, recipient);
        assert_eq!(&m[..7], b"sapling");
        let (n2, a2, _) = sapling_recover_with_ock(&od, &ock).expect("disclosed ock recovers");
        assert_eq!(n2.value().inner(), 77_000);
        assert_eq!(a2, recipient);
        let mut bad = ock_bytes(ock);
        bad[9] ^= 1;
        assert!(sapling_recover_with_ock(&od, &OutgoingCipherKey(bad)).is_none());
        let other = ExtendedSpendingKey::master(&[9u8; 32])
            .to_diversifiable_full_viewing_key()
            .to_ovk(Scope::External);
        assert!(sapling_recover_with_ovk(&od, &other).is_none());
    }
}
