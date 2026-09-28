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
    let url = receipt.to_url("https://receipts.example").unwrap();
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
    // Audit pack: lower-bound total from verified receipts.
    let pack =
        zeceipt_core::zeceipt_types::AuditPack::new("demo", vec![parsed.clone()], 250_000_000);
    let back = zeceipt_core::zeceipt_types::AuditPack::from_json(&pack.to_json().unwrap()).unwrap();
    let total: u64 = back
        .receipts
        .iter()
        .map(|r| {
            verify(r, &tx, b"auditor-nonce-7", true)
                .unwrap()
                .recovered
                .value_zat
        })
        .sum();
    assert_eq!(total, 250_000_000);

    // The original template transaction must reject the receipt (txid differs).
    let orig = parse_transaction(&template).unwrap();
    assert!(matches!(
        verify(&parsed, &orig, b"auditor-nonce-7", true),
        Err(CoreError::TxidMismatch { .. })
    ));
}

fn base64url(b: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(b)
}

/// No valid transaction carries a note worth more than MAX_MONEY (R131). A spliced output one zatoshi above it is refused when
/// issuing and when verifying, by name, while one exactly at it issues and verifies (slice U5, R131).
#[test]
fn a_note_value_above_max_money_is_refused() {
    use zcash_protocol::value::MAX_MONEY;
    let template = hex::decode(TEMPLATE.trim()).unwrap();
    for (value, allowed) in [(MAX_MONEY, true), (MAX_MONEY + 1, false), (u64::MAX, false)] {
        let syn = splice_ironwood_output(&template, value, [0u8; 512]).unwrap();
        let tx = parse_transaction(&syn.tx_bytes).unwrap();
        let keys = OutgoingKeys::from_orchard_ovk(Network::Main, syn.ovk);
        let opts = IssueOptions {
            label: String::new(),
            challenge: None,
            key_id: None,
            include_change: false,
            signer: None,
        };
        let mut txid = [0u8; 32];
        txid.copy_from_slice(&hex::decode(zeceipt_core::txid_hex(&tx)).unwrap());
        let receipt = Receipt::new(Network::Main, Pool::Ironwood, txid, 0, syn.ock, "");
        match (
            issue(&tx, &keys, &opts),
            verify(&receipt, &tx, b"", false),
            allowed,
        ) {
            (Ok(issued), Ok(v), true) => {
                assert_eq!(issued[0].1.value_zat, value);
                assert_eq!(v.recovered.value_zat, value);
            }
            (Err(CoreError::ValueOutOfRange { value: got, .. }), Err(e), false) => {
                assert_eq!(got, value);
                assert!(
                    matches!(e, CoreError::ValueOutOfRange { .. })
                        && e.to_string().contains("above MAX_MONEY"),
                    "{e}"
                );
            }
            (i, v, _) => panic!(
                "value {value}: issue {:?}, verify {:?}",
                i.map(|x| x.len()),
                v.map(|x| x.recovered.value_zat)
            ),
        }
    }
}
