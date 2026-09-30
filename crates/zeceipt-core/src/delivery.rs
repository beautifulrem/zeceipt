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

use orchard::note::{ExtractedNoteCommitment, RandomSeed, Rho};
use orchard::note_encryption::{IronwoodVersion, NoteEncryptionDomain, OrchardVersion};
use orchard::value::NoteValue;
use orchard::{Address, Note};
use zcash_note_encryption::{try_output_recovery_with_pkd_esk, Domain};
use zcash_primitives::transaction::Transaction;
use zeceipt_types::delivery::DeliveryProof;
use zeceipt_types::{Network, Pool};

use crate::{
    encode_orchard_address, family_action, note_value, parse_transaction, txid_hex, CoreError,
    IronwoodPool, MemoView, OrchardPool, Recovered,
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
    CoreError::RecoveryFailed {
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
