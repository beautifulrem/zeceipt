//! Source-of-funds dossiers (spec/dossier-v1.md) on real testnet transactions (fixtures/testnet/, PROOF §8): a faucet
//! payment (origin), three payments made from it (path and deposit), and a control challenge answered on chain. The
//! dossier checks offline, the builder reproduces it from the holder's UFVK, and every forgery we could think of fails
//! at the claim it attacks.

use std::collections::HashMap;

use zeceipt_core::dossier::{build, check_dossier, txids_needed, BuildInput, Status, TxData};
use zeceipt_core::zeceipt_types::dossier::{Claim, Dossier};
use zeceipt_core::zeceipt_types::Network;
use zeceipt_core::OutgoingKeys;

const TXIDS: [&str; 4] = [
    "90f6a3354862cf5b2f46e29ad3bfc9db3b9c4618178691df30bff2d7ec562a4b",
    "fcfde625685b43d7ab1769708f5a66d7a8fe88abbfc6e149984f3c0ada687f0b",
    "1c49834b2bdb4c6f7d8782e1aed9006e3df2fcbc278418d19c615ab16bace39d",
    "a2619e3963263dde1c7966e40b05b47eaf50ac6fdf52c27719db9c3698d03df8",
];
const CONTROL: &str = "10e941e7fe2c77a97c05662dc8033f7e9ebfa76c66cb7ae28d662cbcacdf6e43";
const NONCE: &str = "zeceipt-challenge-eadb7e12661d3fe791dcb94683f3c8a8";

fn fx(p: &str) -> String {
    std::fs::read_to_string(format!("{}/../../fixtures/{p}", env!("CARGO_MANIFEST_DIR"))).unwrap()
}

fn tx(txid: &str) -> Vec<u8> {
    hex::decode(fx(&format!("testnet/{txid}.hex")).trim()).unwrap()
}

fn chain(d: &Dossier) -> HashMap<String, TxData> {
    txids_needed(d)
        .into_iter()
        .map(|t| {
            (
                t.clone(),
                TxData {
                    bytes: tx(&t),
                    height: None,
                    mempool: false,
                },
            )
        })
        .collect()
}

fn dossier() -> (Dossier, String) {
    let raw = fx("dossier/testnet-dossier.json");
    (Dossier::parse(&raw).unwrap(), raw)
}

#[test]
fn the_testnet_dossier_verifies_offline() {
    let (d, raw) = dossier();
    let r = check_dossier(&d, &raw, &chain(&d));
    assert!(
        r.all_verified,
        "{:#?}",
        r.claims
            .iter()
            .filter(|c| c.status != Status::Verified)
            .collect::<Vec<_>>()
    );
    let kinds: Vec<&str> = r.claims.iter().map(|c| c.kind).collect();
    assert_eq!(kinds.iter().filter(|k| **k == "origin").count(), 1);
    assert_eq!(kinds.iter().filter(|k| **k == "deposit").count(), 3);
    assert_eq!(kinds.iter().filter(|k| **k == "control").count(), 1);
    let control = r.claims.iter().find(|c| c.kind == "control").unwrap();
    assert_eq!(
        control.value_zat,
        Some(24_743_750),
        "the challenge spent n4, 0.2474375 TAZ"
    );
    let origin = r.claims.iter().find(|c| c.kind == "origin").unwrap();
    let f = origin.funding.as_ref().unwrap();
    assert!(
        f.transparent_inputs.is_empty() && f.from_disclosed.is_empty(),
        "the faucet paid from shielded funds"
    );
    // Every disclosed note opens, with a nullifier; the three deposits pay 0.01, 0.02 and 0.03 TAZ.
    assert!(r
        .notes
        .values()
        .all(|n| n.error.is_none() && n.nullifier.is_some()));
    let mut paid: Vec<u64> = r
        .claims
        .iter()
        .filter(|c| c.kind == "deposit")
        .filter_map(|c| c.value_zat)
        .collect();
    paid.sort();
    assert_eq!(paid, [1_000_000, 2_000_000, 3_000_000]);
    assert_eq!(r.dossier_sha256.len(), 64);
}

#[test]
fn the_builder_reproduces_the_dossier_from_the_holders_ufvk() {
    let keys =
        OutgoingKeys::from_ufvk(Network::Test, fx("testnet/issuer-ufvk.txt").trim()).unwrap();
    let built = build(BuildInput {
        keys: &keys,
        txs: TXIDS.iter().map(|t| tx(t)).collect(),
        control: Some((tx(CONTROL), NONCE.into())),
        subject: None,
        created: None,
    })
    .unwrap();
    let (d, _) = dossier();
    assert_eq!(
        (&built.nk, &built.notes, &built.receipts, &built.claims),
        (&d.nk, &d.notes, &d.receipts, &d.claims)
    );
    // Minimal disclosure: of the challenge transaction, only the reply note.
    let reply = d
        .claims
        .iter()
        .find_map(|c| {
            if let Claim::Control { reply, .. } = c {
                Some(reply)
            } else {
                None
            }
        })
        .unwrap();
    let control_notes = d
        .note_proofs()
        .unwrap()
        .into_values()
        .filter(|p| p.txid_hex() == CONTROL)
        .count();
    assert_eq!(control_notes, 1, "{reply} alone");
}

fn failed(d: &Dossier, raw: &str) -> Vec<(&'static str, String)> {
    check_dossier(d, raw, &chain(d))
        .claims
        .into_iter()
        .filter(|c| c.status != Status::Verified)
        .map(|c| (c.kind, c.summary))
        .collect()
}

#[test]
fn a_wrong_nk_fails_every_claim_that_tests_a_nullifier_and_only_those() {
    let (mut d, raw) = dossier();
    let mut nk = hex::decode(d.nk.as_ref().unwrap()).unwrap();
    nk[3] ^= 1;
    d.nk = Some(hex::encode(nk));
    let f = failed(&d, &raw);
    let kinds: std::collections::BTreeSet<&str> = f.iter().map(|(k, _)| *k).collect();
    assert_eq!(kinds, ["control", "deposit", "path"].into(), "{f:#?}");
    assert_eq!(f.len(), d.claims.len() - 1, "all but the origin");
}

#[test]
fn a_wrong_nonce_a_foreign_note_or_a_missing_transaction_fails() {
    let (d, raw) = dossier();
    // The reviewer's nonce differs from the one in the memo.
    let mut e = d.clone();
    for c in &mut e.claims {
        if let Claim::Control { nonce, .. } = c {
            *nonce = "zeceipt-challenge-00000000000000000000000000000000".into();
        }
    }
    assert!(failed(&e, &raw)
        .iter()
        .any(|(k, s)| *k == "control" && s.contains("does not carry the nonce")));
    // A path to a note of another transaction: n1 is not spent where n6 was created.
    let mut e = d.clone();
    e.claims.push(Claim::Path {
        from: "n1".into(),
        to: "n6".into(),
    });
    assert!(failed(&e, &raw)
        .iter()
        .any(|(k, s)| *k == "path" && s.contains("not among")));
    // A control claim that says the challenge spent a note it did not.
    let mut e = d.clone();
    for c in &mut e.claims {
        if let Claim::Control { spent, .. } = c {
            *spent = vec!["n1".into()];
        }
    }
    assert!(failed(&e, &raw)
        .iter()
        .any(|(k, s)| *k == "control" && s.contains("does not spend n1")));
    // A deposit funded by a note its transaction did not spend.
    let mut e = d.clone();
    for c in &mut e.claims {
        if let Claim::Deposit { funded_by, receipt } = c {
            if receipt == "r1" {
                *funded_by = vec!["n2".into()];
            }
        }
    }
    assert!(failed(&e, &raw)
        .iter()
        .any(|(k, s)| *k == "deposit" && s.contains("not from n2")));
    // A transaction the reviewer could not fetch: its notes do not open.
    let mut txs = chain(&d);
    txs.remove(CONTROL);
    let r = check_dossier(&d, &raw, &txs);
    assert!(!r.all_verified);
    assert!(r.claims.iter().any(|c| c.kind == "control"
        && c.status == Status::Failed
        && c.summary.contains("not supplied")));
    // A mempool transaction: control waits.
    let mut txs = chain(&d);
    txs.get_mut(CONTROL).unwrap().mempool = true;
    let r = check_dossier(&d, &raw, &txs);
    assert_eq!(
        r.claims
            .iter()
            .find(|c| c.kind == "control")
            .unwrap()
            .status,
        Status::NotChecked
    );
}

#[test]
fn another_holders_key_cannot_build_a_dossier_for_these_funds() {
    // The recipient of the INV-T payments sees only what it received; it cannot claim the issuer's faucet funds.
    let stranger = fx("zdp/constructed.json");
    let v: serde_json::Value = serde_json::from_str(&stranger).unwrap();
    let keys = OutgoingKeys::from_ufvk(
        Network::Test,
        v["cases"][0]["keys"]["strangerUfvk"].as_str().unwrap(),
    )
    .unwrap();
    let r = build(BuildInput {
        keys: &keys,
        txs: TXIDS.iter().map(|t| tx(t)).collect(),
        control: None,
        subject: None,
        created: None,
    });
    assert!(r.is_err(), "a key that sees no note builds nothing");
}

#[test]
fn the_scanner_finds_exactly_the_holders_transactions() {
    use zeceipt_core::dossier::{CompactActionData, WalletScanner};
    use zeceipt_core::parse_transaction;
    let keys =
        OutgoingKeys::from_ufvk(Network::Test, fx("testnet/issuer-ufvk.txt").trim()).unwrap();
    let mut s = WalletScanner::new(&keys).unwrap();
    // The five transactions, then the recipient's view is irrelevant: compact actions built from the full ones (the
    // first 52 bytes of each enc_ciphertext, as lightwalletd serves them).
    for (h, t) in TXIDS.iter().chain(std::iter::once(&CONTROL)).enumerate() {
        let tx = parse_transaction(&tx(t)).unwrap();
        let acts: Vec<CompactActionData> = tx
            .ironwood_bundle()
            .unwrap()
            .actions()
            .iter()
            .map(|a| CompactActionData {
                nullifier: a.nullifier().to_bytes(),
                cmx: a.cmx().to_bytes(),
                ephemeral_key: a.encrypted_note().epk_bytes,
                ciphertext: a.encrypted_note().enc_ciphertext[..52].try_into().unwrap(),
            })
            .collect();
        s.scan_tx(h as u64, t, &acts, true);
    }
    let got: Vec<(&str, usize, usize)> = s
        .found()
        .iter()
        .map(|f| (f.txid.as_str(), f.received, f.spent))
        .collect();
    assert_eq!(
        got,
        [
            (TXIDS[0], 1, 0),
            (TXIDS[1], 4, 1),
            (TXIDS[2], 1, 1),
            (TXIDS[3], 2, 1),
            (CONTROL, 2, 1)
        ]
    );
}
