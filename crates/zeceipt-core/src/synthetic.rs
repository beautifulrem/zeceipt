//! Offline test support: splice a freshly encrypted Ironwood output into a real
//! v6 transaction so that issue/verify can be exercised end to end without
//! funds. The result parses and verifies cryptographically at the note level
//! but is **not consensus-valid** (proofs and signatures no longer match).
//!
//! Enabled with the `synthetic` feature; never used by the CLI in production paths.

use orchard::keys::{FullViewingKey, Scope, SpendingKey};
use orchard::note::{
    ExtractedNoteCommitment, NoteVersion, RandomSeed, Rho, TransmittedNoteCiphertext,
};
use orchard::note_encryption::{IronwoodDomain, IronwoodNoteEncryption};
use orchard::value::NoteValue;
use orchard::Note;
use rand::rngs::OsRng;
use rand::RngCore;
use zcash_note_encryption::Domain;

use crate::{parse_transaction, CoreError};

/// Wire size of one Orchard/Ironwood action without its spend-auth signature:
/// cv(32) nf(32) rk(32) cmx(32) epk(32) enc(580) out(80).
const ACTION_LEN: usize = 32 * 5 + 580 + 80;

/// Result of building a synthetic transaction.
pub struct Synthetic {
    /// Raw bytes of the modified v6 transaction.
    pub tx_bytes: Vec<u8>,
    /// Full viewing key that can open action 0 of the Ironwood bundle.
    pub fvk: FullViewingKey,
    /// The external outgoing viewing key (what an issuer would hold).
    pub ovk: [u8; 32],
    /// Recipient address of the spliced note (unified-address receiver bytes).
    pub recipient: orchard::Address,
    pub value_zat: u64,
    pub memo: [u8; 512],
}

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

/// Replace Ironwood action 0 of `template_tx` with an output paying `value_zat`
/// and `memo` to a fresh random key. Returns the new transaction bytes and the keys.
pub fn splice_ironwood_output(
    template_tx: &[u8],
    value_zat: u64,
    memo: [u8; 512],
) -> Result<Synthetic, CoreError> {
    let tx = parse_transaction(template_tx)?;
    let bundle = tx
        .ironwood_bundle()
        .ok_or(CoreError::NoBundle("ironwood"))?;
    let template = bundle.actions().first();

    let fvk = random_fvk();
    let recipient = fvk.address_at(0u32, Scope::External);
    let rho = Rho::from_bytes(&template.nullifier().to_bytes())
        .into_option()
        .ok_or_else(|| CoreError::Malformed("nullifier is not a valid rho".into()))?;
    let mut rseed_bytes = [0u8; 32];
    OsRng.fill_bytes(&mut rseed_bytes);
    let rseed = RandomSeed::from_bytes(rseed_bytes, &rho)
        .into_option()
        .ok_or_else(|| CoreError::Malformed("rseed rejected".into()))?;
    let note = Note::from_parts(
        recipient,
        NoteValue::from_raw(value_zat),
        rho,
        rseed,
        NoteVersion::V3,
    )
    .into_option()
    .ok_or_else(|| CoreError::Malformed("note rejected".into()))?;
    let cv_net = template.cv_net().clone();
    let cmx = ExtractedNoteCommitment::from(note.commitment());
    let encryptor = IronwoodNoteEncryption::new(Some(fvk.to_ovk(Scope::External)), note, memo);
    let enc = TransmittedNoteCiphertext {
        epk_bytes: IronwoodDomain::epk_bytes(encryptor.epk()).0,
        enc_ciphertext: encryptor.encrypt_note_plaintext(),
        out_ciphertext: encryptor.encrypt_outgoing_plaintext(&cv_net, &cmx, &mut OsRng),
    };

    // Locate action 0 on the wire by its (cv, nf, rk) prefix, then overwrite
    // cmx || epk || enc || out in place.
    let mut prefix = Vec::with_capacity(96);
    prefix.extend_from_slice(&template.cv_net().to_bytes());
    prefix.extend_from_slice(&template.nullifier().to_bytes());
    prefix.extend_from_slice(&<[u8; 32]>::from(template.rk()));
    let pos = template_tx
        .windows(prefix.len())
        .position(|w| w == prefix.as_slice())
        .ok_or_else(|| CoreError::Malformed("could not locate action 0 on the wire".into()))?;
    if pos + ACTION_LEN > template_tx.len() {
        return Err(CoreError::Malformed("action 0 truncated".into()));
    }
    let mut out = template_tx.to_vec();
    let mut cursor = pos + 96;
    out[cursor..cursor + 32].copy_from_slice(&cmx.to_bytes());
    cursor += 32;
    out[cursor..cursor + 32].copy_from_slice(&enc.epk_bytes);
    cursor += 32;
    out[cursor..cursor + 580].copy_from_slice(&enc.enc_ciphertext);
    cursor += 580;
    out[cursor..cursor + 80].copy_from_slice(&enc.out_ciphertext);

    let mut ovk = [0u8; 32];
    ovk.copy_from_slice(fvk.to_ovk(Scope::External).as_ref());
    Ok(Synthetic {
        tx_bytes: out,
        fvk,
        ovk,
        recipient,
        value_zat,
        memo,
    })
}
