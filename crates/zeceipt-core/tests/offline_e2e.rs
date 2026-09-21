//! End-to-end issue -> verify on a synthetic Ironwood output spliced into a
//! real mainnet v6 transaction. Requires `--features synthetic`.
#![cfg(feature = "synthetic")]

use zeceipt_core::synthetic::splice_ironwood_output;
use zeceipt_core::zeceipt_types::ed25519_dalek::SigningKey;
use zeceipt_core::zeceipt_types::{Network, Pool, Receipt, TypesError};
use zeceipt_core::{
    issue, parse_transaction, verify, CoreError, IssueOptions, MemoView, OutgoingKeys,
};

const TEMPLATE: &str = include_str!(
    "../../../fixtures/0e85513c8ac28fcd6ea5324e08bde3360e5cb78e176f536d6659f14fee87da69.hex"
);

#[test]
fn issue_then_verify_then_tamper() {
    let template = hex::decode(TEMPLATE.trim()).unwrap();
    let mut memo = [0u8; 512];
    memo[..17].copy_from_slice(b"INV-2026-0142 pay");
    let syn = splice_ironwood_output(&template, 250_000_000, memo).unwrap();

    let tx = parse_transaction(&syn.tx_bytes).unwrap();
    let keys = OutgoingKeys::from_orchard_ovk(Network::Main, syn.ovk);
    let signer = SigningKey::generate(&mut rand::rngs::OsRng);
    let opts = IssueOptions {
        label: "INV-2026-0142 | 3,797.00 USD @ 1518.81".into(),
        challenge: Some(b"auditor-nonce-7"),
        key_id: Some("2026-09".into()),
        include_change: false,
        signer: Some(&signer),
    };
    let issued = issue(&tx, &keys, &opts).unwrap();
    assert_eq!(issued.len(), 1, "exactly the spliced output is ours");
    let (receipt, recovered) = &issued[0];
    assert_eq!(receipt.pool, Pool::Ironwood);
    assert_eq!(receipt.output_index, 0);
    assert_eq!(recovered.value_zat, 250_000_000);
    assert_eq!(recovered.memo, MemoView::Text("INV-2026-0142 pay".into()));

    // Round trip through JSON and URL like a real recipient would.
    let url = receipt.to_url("https://zeceipt.xyz").unwrap();
    let parsed = Receipt::parse(&url).unwrap();
    let v = verify(&parsed, &tx, b"auditor-nonce-7", true).unwrap();
    assert_eq!(v.recovered.value_zat, 250_000_000);
    assert_eq!(v.recovered.recipient, recovered.recipient);
    assert!(v.recovered.recipient.starts_with("u1"));
    assert_eq!(
        v.issuer_pubkey.as_deref(),
        Some(hex::encode(signer.verifying_key().to_bytes()).as_str())
    );
    assert!(v.challenge_checked);

    // Wrong challenge.
    assert!(matches!(
        verify(&parsed, &tx, b"other", true),
        Err(CoreError::Types(TypesError::ChallengeMismatch))
    ));
    // Tampered ock: signature check fails first.
    let mut t = parsed.clone();
    let mut ock = t.ock_bytes().unwrap();
    ock[5] ^= 0x80;
    t.ock = base64url(&ock);
    assert!(matches!(
        verify(&t, &tx, b"auditor-nonce-7", true),
        Err(CoreError::Types(TypesError::SignatureInvalid))
    ));
    // Same tamper, signature not required: recovery must still fail closed.
    let mut u = t.clone();
    u.signature = None;
    u.issuer_pubkey = None;
    assert!(matches!(
        verify(&u, &tx, b"auditor-nonce-7", false),
        Err(CoreError::RecoveryFailed { .. })
    ));
    // Wrong output index against a real (foreign) output.
    let mut w = parsed.clone();
    w.output_index = 1;
    w.signature = None;
    w.issuer_pubkey = None;
    assert!(matches!(
        verify(&w, &tx, b"auditor-nonce-7", false),
        Err(CoreError::RecoveryFailed { .. })
    ));
    // The original template transaction must reject the receipt (txid differs).
    let orig = parse_transaction(&template).unwrap();
    assert!(matches!(
        verify(&parsed, &orig, b"auditor-nonce-7", true),
        Err(CoreError::TxidMismatch { .. })
    ));
}

fn base64url(b: &[u8]) -> String {
    use std::fmt::Write;
    // minimal base64url without padding, to avoid a dev-dependency
    const T: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut s = String::new();
    for chunk in b.chunks(3) {
        let n = chunk.len();
        let v = (chunk[0] as u32) << 16
            | (*chunk.get(1).unwrap_or(&0) as u32) << 8
            | *chunk.get(2).unwrap_or(&0) as u32;
        s.write_char(T[(v >> 18) as usize & 63] as char).unwrap();
        s.write_char(T[(v >> 12) as usize & 63] as char).unwrap();
        if n > 1 {
            s.write_char(T[(v >> 6) as usize & 63] as char).unwrap();
        }
        if n > 2 {
            s.write_char(T[v as usize & 63] as char).unwrap();
        }
    }
    s
}
