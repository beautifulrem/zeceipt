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
    let r = check_dossier(&d, &raw, &chain(&d), None);
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
    check_dossier(d, raw, &chain(d), None)
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
    let r = check_dossier(&d, &raw, &chain(&d), None);
    let failed: std::collections::BTreeSet<&str> = r
        .claims
        .iter()
        .filter(|c| c.status == Status::Failed)
        .map(|c| c.kind)
        .collect();
    assert_eq!(failed, ["control", "deposit", "path"].into());
    // The origin still opens, but its note is no longer shown to be the holder's: no nullifier matches.
    let origin = r.claims.iter().find(|c| c.kind == "origin").unwrap();
    assert_eq!(origin.status, Status::Unproven, "{origin:?}");
    assert!(!r.nk_proven && !r.controlled);
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
    let r = check_dossier(&d, &raw, &txs, None);
    assert!(!r.all_verified);
    let control = r.claims.iter().find(|c| c.kind == "control").unwrap();
    assert_eq!(
        control.status,
        Status::NotChecked,
        "a transaction the node does not have is not checked, not failed"
    );
    assert!(
        control.summary.contains("not found on the node"),
        "{}",
        control.summary
    );
    // A mempool transaction: control waits.
    let mut txs = chain(&d);
    txs.get_mut(CONTROL).unwrap().mempool = true;
    let r = check_dossier(&d, &raw, &txs, None);
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

#[test]
fn the_fixes_of_the_spec_review_hold() {
    let (d, raw) = dossier();
    // 1. Value inflation: the same note twice in a claim, or under two ids, does not parse.
    let mut v: serde_json::Value = serde_json::from_str(&raw).unwrap();
    for c in v["claims"].as_array_mut().unwrap() {
        if c["type"] == "control" {
            c["spent"] = serde_json::json!(["n4", "n4"]);
        }
    }
    assert!(Dossier::parse(&v.to_string())
        .unwrap_err()
        .to_string()
        .contains("twice"));
    let mut v: serde_json::Value = serde_json::from_str(&raw).unwrap();
    let n4 = v["notes"]["n4"].clone();
    v["notes"]["n4b"] = n4;
    assert!(Dossier::parse(&v.to_string())
        .unwrap_err()
        .to_string()
        .contains("open the same note"));
    // 2. Replay: a reviewer who issued another nonce sees the control claim fail; the right one passes.
    let r = check_dossier(
        &d,
        &raw,
        &chain(&d),
        Some("zeceipt-challenge-ffffffffffffffffffffffffffffffff"),
    );
    let c = r.claims.iter().find(|c| c.kind == "control").unwrap();
    assert_eq!(c.status, Status::Failed);
    assert!(c.summary.contains("not the one you issued"));
    assert!(check_dossier(&d, &raw, &chain(&d), Some(NONCE)).all_verified);
    // 3. An nk that is not a key: said once, and every nullifier claim fails with that reason.
    let mut e = d.clone();
    e.nk = Some("ff".repeat(32));
    let r = check_dossier(&e, &raw, &chain(&e), None);
    assert!(
        r.problems
            .iter()
            .any(|p| p.contains("not a valid Orchard nullifier key")),
        "{:?}",
        r.problems
    );
    assert!(r
        .claims
        .iter()
        .filter(|c| c.kind != "origin")
        .all(|c| c.status == Status::Failed && c.summary.contains("not a valid key")));
    // 4. Ownership: an origin on a note never spent here (n5, change of INV-T-001) opens but is not shown to be the
    //    holder's; the report says nk is proven and control holds for the real dossier.
    let mut e = d.clone();
    e.claims.push(Claim::Origin { note: "n5".into() });
    let r = check_dossier(&e, &raw, &chain(&e), None);
    let o = r.claims.last().unwrap();
    assert_eq!(o.status, Status::Unproven, "{o:?}");
    assert!(o
        .details
        .iter()
        .any(|x| x.contains("Nothing here shows n5 is the holder's")));
    let r = check_dossier(&d, &raw, &chain(&d), None);
    assert!(
        r.nk_proven && !r.controlled,
        "without the reviewer's nonce, control is not counted"
    );
    assert!(check_dossier(&d, &raw, &chain(&d), Some(NONCE)).controlled);
    // An expected nonce and no control claim: not all verified.
    let mut e = d.clone();
    e.claims.retain(|c| !matches!(c, Claim::Control { .. }));
    let r2 = check_dossier(&e, &raw, &chain(&e), Some(NONCE));
    assert!(
        !r2.all_verified
            && r2
                .problems
                .iter()
                .any(|p| p.contains("no control claim answers it"))
    );
    // A transaction filed under another txid is set aside.
    let mut txs = chain(&d);
    let faucet = txs.remove(TXIDS[0]).unwrap();
    txs.insert(TXIDS[1].to_string(), faucet);
    let r3 = check_dossier(&d, &raw, &txs, None);
    assert!(r3.problems.iter().any(|p| p.contains("set aside")) && !r3.all_verified);
    // 5. Amounts are named for their network: TAZ on testnet.
    assert!(
        r.claims.iter().all(|c| !c.summary.contains(" ZEC")),
        "testnet amounts read TAZ"
    );
}

/// A second real dossier (PROOF §8): change of the INV-T payments sent to the account's own transparent address
/// (`52af3e0d…`), then shielded back (`c28b6000…`). The shielding transaction's origin names its funder from the spent
/// output itself, in the previous transaction (address and value, which the txid covers), and its note, spent nowhere
/// yet, is honestly unproven as the holder's.
#[test]
fn a_transparent_origin_names_its_funder_from_the_spent_output() {
    let raw = fx("dossier/testnet-dossier-transparent-origin.json");
    let d = Dossier::parse(&raw).unwrap();
    let mut txs = chain(&d);
    for t in zeceipt_core::dossier::prevout_txids(&d, &txs) {
        txs.insert(
            t.clone(),
            TxData {
                bytes: tx(&t),
                height: None,
                mempool: false,
            },
        );
    }
    let r = check_dossier(&d, &raw, &txs, Some(NONCE));
    let shielded = r
        .claims
        .iter()
        .find(|c| {
            c.kind == "origin"
                && c.funding
                    .as_ref()
                    .is_some_and(|f| !f.transparent_inputs.is_empty())
        })
        .expect("the shielding transaction's origin");
    let input = &shielded.funding.as_ref().unwrap().transparent_inputs[0];
    assert_eq!(
        input.address.as_deref(),
        Some("tm9vhDB1ebnsMzVnttVBpHEE5BPpoygSFhu")
    );
    assert_eq!(input.value_zat, Some(5_000_000));
    assert!(input.prevout.starts_with("52af3e0da4b11854"));
    assert_eq!(shielded.status, Status::Unproven, "{shielded:?}");
    // Without the previous transaction (52af3e0d…, which is also where the account's change went), the funder is not
    // named: it is never guessed from the input's own scriptSig.
    let mut without = txs.clone();
    without.remove("52af3e0da4b11854e48b5a0d25ac392ab6145616196ed196c0736e876b34105e");
    let r2 = check_dossier(&d, &raw, &without, Some(NONCE));
    let s = r2
        .claims
        .iter()
        .find(|c| {
            c.funding
                .as_ref()
                .is_some_and(|f| !f.transparent_inputs.is_empty())
        })
        .unwrap();
    assert!(s.funding.as_ref().unwrap().transparent_inputs[0]
        .address
        .is_none());
    assert!(
        s.summary
            .contains("previous transactions were not supplied"),
        "{}",
        s.summary
    );
    let r = check_dossier(&d, &raw, &txs, Some(NONCE));
    // Everything else in it verifies, control included.
    assert!(r.controlled);
    assert_eq!(
        r.claims
            .iter()
            .filter(|c| c.status != Status::Verified)
            .count(),
        1,
        "only the unspent origin"
    );
}

/// The browser's scan path: serialized `CompactBlock` messages (as a gRPC-web `GetBlockRange` stream carries them) give
/// the same transactions as the per-transaction scan above.
#[test]
fn compact_blocks_as_protobuf_bytes_scan_the_same() {
    use zeceipt_core::dossier::WalletScanner;
    use zeceipt_core::parse_transaction;
    fn varint(mut v: u64, out: &mut Vec<u8>) {
        while v >= 0x80 {
            out.push((v as u8) | 0x80);
            v >>= 7;
        }
        out.push(v as u8);
    }
    fn field(n: u64, bytes: &[u8], out: &mut Vec<u8>) {
        varint(n << 3 | 2, out);
        varint(bytes.len() as u64, out);
        out.extend(bytes);
    }
    let keys =
        OutgoingKeys::from_ufvk(Network::Test, fx("testnet/issuer-ufvk.txt").trim()).unwrap();
    let mut s = WalletScanner::new(&keys).unwrap();
    for (h, t) in TXIDS.iter().chain(std::iter::once(&CONTROL)).enumerate() {
        let tx = parse_transaction(&tx(t)).unwrap();
        let mut ctx = Vec::new();
        let mut id = hex::decode(t).unwrap();
        id.reverse();
        field(2, &id, &mut ctx);
        for a in tx.ironwood_bundle().unwrap().actions() {
            let mut act = Vec::new();
            field(1, &a.nullifier().to_bytes(), &mut act);
            field(2, &a.cmx().to_bytes(), &mut act);
            field(3, &a.encrypted_note().epk_bytes, &mut act);
            field(4, &a.encrypted_note().enc_ciphertext[..52], &mut act);
            field(9, &act, &mut ctx);
        }
        let mut block = Vec::new();
        varint(2 << 3, &mut block); // height, a varint
        varint(4_419_987 + h as u64, &mut block);
        field(3, &[0xaa; 32], &mut block); // a hash, skipped
        field(7, &ctx, &mut block);
        assert_eq!(s.scan_compact_block(&block).unwrap(), 4_419_987 + h as u64);
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
    assert!(
        s.scan_compact_block(&[0x0f]).is_err(),
        "not a protobuf message"
    );
}

const TRANSPARENT_TXIDS: [&str; 6] = [
    "90f6a3354862cf5b2f46e29ad3bfc9db3b9c4618178691df30bff2d7ec562a4b",
    "fcfde625685b43d7ab1769708f5a66d7a8fe88abbfc6e149984f3c0ada687f0b",
    "1c49834b2bdb4c6f7d8782e1aed9006e3df2fcbc278418d19c615ab16bace39d",
    "a2619e3963263dde1c7966e40b05b47eaf50ac6fdf52c27719db9c3698d03df8",
    "52af3e0da4b11854e48b5a0d25ac392ab6145616196ed196c0736e876b34105e",
    "c28b60004cd8d9fc08ab75ff44aa3062a4d79bdfc29653db8765991b5ae5cefe",
];

fn build_transparent(order: &[usize]) -> Dossier {
    let keys =
        OutgoingKeys::from_ufvk(Network::Test, fx("testnet/issuer-ufvk.txt").trim()).unwrap();
    build(BuildInput {
        keys: &keys,
        txs: order.iter().map(|&i| tx(TRANSPARENT_TXIDS[i])).collect(),
        control: Some((tx(CONTROL), NONCE.into())),
        subject: None,
        created: None,
    })
    .unwrap()
}

#[test]
fn a_payment_to_a_transparent_address_is_claimed_and_its_return_is_linked() {
    // The holder listed their transactions in any order: the builder puts each after the ones whose notes it spends.
    // Note ids follow the order given, so compare what the claims say: the same kinds, and the same outcomes.
    let outcome = |d: &Dossier| {
        let mut txs = chain(d);
        for t in zeceipt_core::dossier::prevout_txids(d, &txs) {
            txs.insert(
                t.clone(),
                TxData {
                    bytes: tx(&t),
                    height: None,
                    mempool: false,
                },
            );
        }
        let mut v: Vec<(&'static str, Status)> = check_dossier(d, "", &txs, Some(NONCE))
            .claims
            .into_iter()
            .map(|c| (c.kind, c.status))
            .collect();
        v.sort_by_key(|(k, s)| (*k, *s as u8));
        v
    };
    let shuffled = build_transparent(&[5, 3, 0, 4, 2, 1]);
    let built = build_transparent(&[0, 1, 2, 3, 4, 5]);
    assert_eq!(outcome(&shuffled), outcome(&built));
    assert_eq!(shuffled.notes.len(), built.notes.len());
    let raw = fx("dossier/testnet-dossier-transparent-origin.json");
    let d = Dossier::parse(&raw).unwrap();
    assert_eq!(
        (&built.nk, &built.notes, &built.receipts, &built.claims),
        (&d.nk, &d.notes, &d.receipts, &d.claims)
    );
    // The deshielding transaction's output to tm9vh… is a transparent payment claim, funded by the holder's note.
    let (k, _) = d
        .claims
        .iter()
        .enumerate()
        .find(|(_, c)| matches!(c, Claim::TransparentPayment { .. }))
        .expect("a transparent payment claim");
    let mut txs = chain(&d);
    for t in zeceipt_core::dossier::prevout_txids(&d, &txs) {
        txs.insert(
            t.clone(),
            TxData {
                bytes: tx(&t),
                height: None,
                mempool: false,
            },
        );
    }
    let r = check_dossier(&d, &raw, &txs, Some(NONCE));
    let p = &r.claims[k];
    assert_eq!(p.status, Status::Verified, "{p:?}");
    assert_eq!(
        p.paid_to.as_deref(),
        Some("tm9vhDB1ebnsMzVnttVBpHEE5BPpoygSFhu")
    );
    assert_eq!(p.value_zat, Some(5_000_000));
    // The shielding transaction's origin names that claim: the funds left the shielded pool and came back.
    let origin = r
        .claims
        .iter()
        .find(|c| {
            c.funding
                .as_ref()
                .is_some_and(|f| !f.transparent_inputs.is_empty())
        })
        .unwrap();
    assert_eq!(
        origin.funding.as_ref().unwrap().transparent_inputs[0].paid_in_claim,
        Some(k)
    );
    assert!(
        origin
            .summary
            .contains("which the holder paid there from disclosed notes (transparent payment 52af3e0d…105e:0)"),
        "{}",
        origin.summary
    );
    // A payment claimed from a note its transaction did not spend, or to an output it does not have, fails.
    let mut v: serde_json::Value = serde_json::from_str(&raw).unwrap();
    v["claims"][k]["funded_by"] = serde_json::json!(["n1"]);
    let bad = Dossier::parse(&v.to_string()).unwrap();
    let c = &check_dossier(&bad, &v.to_string(), &txs, Some(NONCE)).claims[k];
    assert_eq!(c.status, Status::Failed);
    assert!(c.summary.contains("but not from n1"), "{}", c.summary);
    v["claims"][k]["funded_by"] = d.claims[k].notes().iter().map(|s| s.to_string()).collect();
    v["claims"][k]["output"] = 7.into();
    let bad = Dossier::parse(&v.to_string()).unwrap();
    let c = &check_dossier(&bad, &v.to_string(), &txs, Some(NONCE)).claims[k];
    assert_eq!(
        (c.status, c.summary.contains("no transparent output 7")),
        (Status::Failed, true),
        "{}",
        c.summary
    );
    // One with no funding note says nothing about the holder, so it does not parse.
    v["claims"][k]["funded_by"] = serde_json::json!([]);
    assert!(Dossier::parse(&v.to_string()).is_err());
}

#[test]
fn a_control_mined_before_the_nonce_was_issued_fails() {
    use zeceipt_core::dossier::{check_dossier_with, CheckOptions};
    let (d, raw) = dossier();
    let mut txs = chain(&d);
    // The real heights: a report on transactions without them is only `consistent_offline`.
    for (t, h) in [
        (TXIDS[0], 4_419_987),
        (TXIDS[1], 4_420_000),
        (TXIDS[2], 4_420_003),
        (TXIDS[3], 4_420_005),
        (CONTROL, 4_421_345),
    ] {
        txs.get_mut(t).unwrap().height = Some(h);
    }
    let at = |h| {
        check_dossier_with(
            &d,
            &raw,
            &txs,
            &CheckOptions {
                expect_nonce: Some(NONCE.into()),
                issued_at_height: Some(h),
                ..Default::default()
            },
        )
    };
    let early = at(4_421_346);
    let c = early.claims.iter().find(|c| c.kind == "control").unwrap();
    assert_eq!(c.status, Status::Failed, "{c:?}");
    assert!(c
        .summary
        .contains("before you issued the nonce at height 4421346"));
    assert_eq!((early.controlled, early.assurance), (false, "not_verified"));
    // Control holds; the faucet's origin names no source (an undisclosed shielded sender), so the funds are only
    // partly explained (spec §5.6).
    let ok = at(4_421_300);
    assert_eq!(
        (ok.controlled, ok.assurance, ok.unexplained_origins.clone()),
        (true, "verified_partly_explained", vec!["n1".to_string()])
    );
    let r = check_dossier(&d, &raw, &txs, None);
    assert_eq!((r.all_verified, r.controlled), (true, false));
    // The same from files, without heights: consistent with them, not checked against the chain.
    let r = check_dossier(&d, &raw, &chain(&d), Some(NONCE));
    assert_eq!(
        (r.all_verified, r.anchored, r.assurance),
        (true, false, "consistent_offline")
    );
}

/// PROOF §9: an exchange-like chain on testnet. An exchange's transparent hot wallet withdrew to a customer's shielded
/// address, the customer deposited to their transparent deposit address, and answered the exchange's nonce.
#[test]
fn an_exchange_deposit_review_verifies_with_control_and_names_both_transparent_ends() {
    use zeceipt_core::dossier::{check_dossier_with, prevout_txids, CheckOptions};
    const NONCE2: &str = "zeceipt-challenge-322b9971bc1ccd4eb70336167cc509e1";
    let keys =
        OutgoingKeys::from_ufvk(Network::Test, fx("testnet/holder2-ufvk.txt").trim()).unwrap();
    let built = build(BuildInput {
        keys: &keys,
        // Listed newest first: the builder orders them.
        txs: [
            "a51d12711cd68729699ee93ea3e466bfb0222c7f3a02c2f64bd3b66ed60985cf",
            "5146f38c0a782f0d76858e575c46c3b0908865987416095e4180a2c6273436e6",
        ]
        .iter()
        .map(|t| tx(t))
        .collect(),
        control: Some((
            tx("14a9551d4b85b05ce48dc6e83784bdb8bad0a68b6ec2a5e2298b2f77bb79cce6"),
            NONCE2.into(),
        )),
        subject: None,
        created: None,
    })
    .unwrap();
    let raw = fx("dossier/testnet-dossier-exchange.json");
    let d = Dossier::parse(&raw).unwrap();
    assert_eq!(
        (&built.nk, &built.notes, &built.claims),
        (&d.nk, &d.notes, &d.claims)
    );
    let heights = [
        (
            "5146f38c0a782f0d76858e575c46c3b0908865987416095e4180a2c6273436e6",
            4_422_279,
        ),
        (
            "a51d12711cd68729699ee93ea3e466bfb0222c7f3a02c2f64bd3b66ed60985cf",
            4_422_295,
        ),
        (
            "14a9551d4b85b05ce48dc6e83784bdb8bad0a68b6ec2a5e2298b2f77bb79cce6",
            4_422_305,
        ),
        (
            "773da0147a8d0ba05f4bfe1e0a08a89dbfefda11b792172f7ebd71aeb56b4b0d",
            4_422_275,
        ),
    ];
    let mut txs = chain(&d);
    for t in prevout_txids(&d, &txs) {
        txs.insert(
            t.clone(),
            TxData {
                bytes: tx(&t),
                height: None,
                mempool: false,
            },
        );
    }
    for (t, h) in heights {
        txs.get_mut(t).unwrap().height = Some(h);
    }
    let opts = |h0| CheckOptions {
        expect_nonce: Some(NONCE2.into()),
        issued_at_height: Some(h0),
        ..Default::default()
    };
    let r = check_dossier_with(&d, &raw, &txs, &opts(4_422_294));
    assert_eq!(r.assurance, "verified_with_control", "{r:#?}");
    let origin = &r.claims[0];
    assert_eq!(
        origin.funding.as_ref().unwrap().transparent_inputs[0]
            .address
            .as_deref(),
        Some("tmPVtCrdwZt2HM1h85ncLj48tttDUxdcsqv")
    );
    let paid = r
        .claims
        .iter()
        .find(|c| c.kind == "transparent_payment")
        .unwrap();
    assert_eq!(
        (paid.paid_to.as_deref(), paid.value_zat),
        (Some("tmXdyCse34c3qhaP7Rr6zDkF3NvuiRfKPAR"), Some(5_000_000))
    );
    // A nonce said to be issued after the challenge was mined: not an answer to it.
    let late = check_dossier_with(&d, &raw, &txs, &opts(4_422_306));
    assert_eq!((late.controlled, late.assurance), (false, "not_verified"));
}

#[test]
fn a_challenge_answer_is_only_ever_the_control() {
    let keys =
        OutgoingKeys::from_ufvk(Network::Test, fx("testnet/issuer-ufvk.txt").trim()).unwrap();
    let with = |txs: Vec<&str>, control: bool| {
        build(BuildInput {
            keys: &keys,
            txs: txs.into_iter().map(tx).collect(),
            control: control.then(|| (tx(CONTROL), NONCE.to_string())),
            subject: None,
            created: None,
        })
    };
    // A scan lists the challenge among the holder's transactions: given as the control too, it is the control only.
    let mut listed: Vec<&str> = TXIDS.to_vec();
    listed.push(CONTROL);
    let (d, _) = dossier();
    let built = with(listed.clone(), true).unwrap();
    assert_eq!((&built.notes, &built.claims), (&d.notes, &d.claims));
    // Listed but not given as the control: explaining it as a path would disclose its change, so it is refused.
    let e = with(listed, false).unwrap_err().to_string();
    assert!(
        e.contains("answers a challenge") && e.contains("10e941e7"),
        "{e}"
    );
}
