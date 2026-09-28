//! No mutated transaction, receipt, audit pack or well-known file makes the core panic (slice U3). Zebra's
//! GHSA-h5rr-8pqv-grp9 was found by fuzzing (OSS-Fuzz): a parsed transaction that a later step could not handle aborted
//! the node (R127). Here every committed transaction is mutated with a seeded generator (bit flips, byte overwrites,
//! truncation, deletions, insertions, a swapped branch id) and each result goes through every step a receipt takes:
//! parse, txid, output listing, issuing with the fixtures' keys (each issued receipt must verify), and verifying a
//! receipt made for that transaction's own txid with a real OCK. The second test mutates what a verifier receives from
//! outside: a signed receipt (JSON and link forms), an audit pack and a well-known file, through parsing, the
//! signature, the challenge, the OCK, verification and the issuer binding. Errors are expected; a panic fails. In the
//! browser a panic traps the WASM, so the page would lose its verifier. Unset, the counts are 40 per transaction
//! fixture and 1,000 per receipt input (about 20 s in a debug build); set, `ZECEIPT_MUTATIONS` is the count per
//! transaction fixture and ten times it per receipt input, and `0` skips both tests. The deep run the slice records is
//! `ZECEIPT_MUTATIONS=5000 cargo test --release -p zeceipt-core --test mutation -- --nocapture`.
//! The success paths reached are Ironwood's: the fixtures' keys open Ironwood outputs only, so Orchard and Sapling
//! recovery run up to their authenticated decryption, which no mutation gets past.

use std::panic::{catch_unwind, AssertUnwindSafe};

use zeceipt_core::zeceipt_types::{Network, Receipt};
use zeceipt_core::{
    enumerate_outputs, issue, parse_transaction, txid_hex, verify, IssueOptions, OutgoingKeys,
};

const FIXTURES: &[(&str, &str)] = &[
    ("synthetic-ironwood", include_str!("../../../fixtures/synthetic-ironwood.hex")),
    ("regtest-48be62e2", include_str!("../../../fixtures/regtest-48be62e21bdc98080da9aa396844c8bd7f86496ca0cb1759ea91d1a19e0fa92d.hex")),
    ("regtest-48db254a", include_str!("../../../fixtures/regtest-48db254a361e9676b90d4864505bd536de9bc6952c46aeea087ec213fdac47b2.hex")),
    ("regtest-58794a9b", include_str!("../../../fixtures/regtest-58794a9b32a9c051a7e9e44f319c114aabd6bfe2c334a85f0ca7321810c8a011.hex")),
    ("mainnet-0e85513c", include_str!("../../../fixtures/0e85513c8ac28fcd6ea5324e08bde3360e5cb78e176f536d6659f14fee87da69.hex")),
    ("mainnet-97ea837b", include_str!("../../../fixtures/97ea837b7bed3b10717432a1119f96d464bc9ba711444fd54481d65c24ea84ef.hex")),
    ("mainnet-391fa065", include_str!("../../../fixtures/391fa06520cd9be87e4187a74cd82907b60b1ca13326e0c18d7a73657fea7931.hex")),
    ("mainnet-368ff5b2", include_str!("../../../fixtures/368ff5b2a985d39594fd69281bfad0531a7f495d4cb23f443e73d5e1ca93d047.hex")),
    ("mainnet-5f1c6bfa", include_str!("../../../fixtures/5f1c6bfa4e97c9aa5e918b6912dc70cb7a46aee01d91599bdb8e657306650e0a.hex")),
    ("mainnet-5a60fe6a", include_str!("../../../fixtures/5a60fe6a8188e5216dab8ae8c9a0969debf4ef458be7d5385ae21c51bc9763e6.hex")),
    (
        "synthetic-above-max-money",
        include_str!("../../../fixtures/synthetic-above-max-money.hex"),
    ),
];
const UFVK: &str = include_str!("../../../fixtures/regtest-issuer-ufvk.txt");
const OVK: &str = include_str!("../../../fixtures/synthetic-ovk.hex");
const RECEIPT: &str = include_str!("../../../fixtures/regtest-20kb-receipt.json");

/// xorshift64*: seeded and dependency-free, so a failure names the iteration that reproduces it.
struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545_f491_4f6c_dd1d)
    }
    fn below(&mut self, n: usize) -> usize {
        (self.next() % n.max(1) as u64) as usize
    }
}

fn mutate(rng: &mut Rng, mut b: Vec<u8>) -> Vec<u8> {
    for _ in 0..1 + rng.below(4) {
        let len = b.len();
        match rng.below(7) {
            0 if len > 0 => {
                let i = rng.below(len);
                b[i] ^= 1 << rng.below(8);
            }
            1 if len > 0 => {
                let i = rng.below(len);
                b[i] = rng.next() as u8;
            }
            2 => b.truncate(rng.below(len + 1)),
            3 if len > 0 => {
                let i = rng.below(len);
                let n = (1 + rng.below(64)).min(len - i);
                b.drain(i..i + n);
            }
            4 => {
                let i = rng.below(len + 1);
                let extra: Vec<u8> = (0..1 + rng.below(64)).map(|_| rng.next() as u8).collect();
                b.splice(i..i, extra);
            }
            5 if len >= 12 => {
                // Another upgrade's branch id, or an arbitrary one, where v5/v6 keep theirs.
                const IDS: [u32; 7] = [
                    0x76b8_09bb,
                    0x2bb4_0e60,
                    0xe9ff_75a6,
                    0xc2d6_d0b4,
                    0xc8e7_1055,
                    0x4dec_4df0,
                    0x37a5_165b,
                ];
                let id = if rng.below(2) == 0 {
                    IDS[rng.below(IDS.len())]
                } else {
                    rng.next() as u32
                };
                b[8..12].copy_from_slice(&id.to_le_bytes());
            }
            _ if len > 0 => {
                // A length-like byte (a compact size) pushed to its extremes.
                let i = rng.below(len);
                b[i] = [0x00, 0xfc, 0xfd, 0xfe, 0xff][rng.below(5)];
            }
            _ => {}
        }
    }
    b
}

/// Every step a receipt takes, on one input. Errors are fine; a panic fails, and so does a receipt `issue` made for
/// this transaction that `verify` then refuses (review U3 round 1).
fn exercise(bytes: &[u8], keys: &[OutgoingKeys], ock: [u8; 32]) -> Result<usize, String> {
    let Ok(tx) = parse_transaction(bytes) else {
        return Ok(0);
    };
    let txid = txid_hex(&tx);
    let outputs = enumerate_outputs(&tx);
    let mut issued = 0;
    for k in keys {
        for include_change in [false, true] {
            let opts = IssueOptions {
                label: String::new(),
                challenge: None,
                key_id: None,
                include_change,
                signer: None,
            };
            for (r, _) in issue(&tx, k, &opts).unwrap_or_default() {
                verify(&r, &tx, b"", false).map_err(|e| {
                    format!(
                        "an issued receipt for output {} does not verify: {e}",
                        r.output_index
                    )
                })?;
                issued += 1;
            }
        }
    }
    let mut txid_bytes = [0u8; 32];
    txid_bytes.copy_from_slice(&hex::decode(&txid).unwrap());
    for o in outputs.iter().take(8) {
        for network in [Network::Main, Network::Test, Network::Regtest] {
            let r = Receipt::new(network, o.pool, txid_bytes, o.index, ock, "");
            let _ = verify(&r, &tx, b"", false);
            let beyond = Receipt::new(
                network,
                o.pool,
                txid_bytes,
                o.index.saturating_add(1000),
                ock,
                "",
            );
            let _ = verify(&beyond, &tx, b"", false);
        }
    }
    Ok(issued)
}

#[test]
fn mutated_transactions_never_panic() {
    let per_fixture: usize = std::env::var("ZECEIPT_MUTATIONS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(40);
    let keys = vec![
        OutgoingKeys::from_ufvk(Network::Regtest, UFVK.trim()).unwrap(),
        OutgoingKeys::from_orchard_ovk(
            Network::Main,
            hex::decode(OVK.trim()).unwrap().try_into().unwrap(),
        ),
    ];
    let ock = Receipt::from_json(RECEIPT).unwrap().ock_bytes().unwrap();
    let (mut parsed, mut total, mut issued) = (0usize, 0usize, 0usize);
    for (f, (name, hex_tx)) in FIXTURES.iter().enumerate() {
        let original = hex::decode(hex_tx.trim()).unwrap();
        assert!(
            parse_transaction(&original).is_ok(),
            "{name} parses as committed"
        );
        let mut rng = Rng(0x9e37_79b9_7f4a_7c15 ^ (f as u64 + 1));
        for i in 0..per_fixture {
            let input = mutate(&mut rng, original.clone());
            match catch_unwind(AssertUnwindSafe(|| exercise(&input, &keys, ock))) {
                Ok(Ok(n)) => issued += n,
                Ok(Err(e)) => panic!("{name}, mutation {i}: {e}; input {}", hex::encode(&input)),
                Err(_) => panic!(
                    "{name}, mutation {i} panicked; input {}",
                    hex::encode(&input)
                ),
            }
            total += 1;
            if parse_transaction(&input).is_ok() {
                parsed += 1;
            }
        }
    }
    // Some mutations must survive parsing, or the later steps would never run.
    // (`ZECEIPT_MUTATIONS=0` skips the run.)
    assert!(
        total == 0 || parsed > total / 50,
        "only {parsed} of {total} mutated inputs parsed"
    );
    eprintln!("{total} mutated transactions, {parsed} parsed, {issued} receipts issued and verified, none panicked");
}

/// Flip, overwrite, cut or insert bytes of a text input; the result is read as UTF-8, lossily, as a page would.
fn mutate_text(rng: &mut Rng, s: &str) -> String {
    let mut b = s.as_bytes().to_vec();
    for _ in 0..1 + rng.below(3) {
        let len = b.len();
        match rng.below(4) {
            0 if len > 0 => {
                let i = rng.below(len);
                b[i] ^= 1 << rng.below(8);
            }
            1 if len > 0 => {
                let i = rng.below(len);
                const PALETTE: &[u8] = b"{}[]\",:0aZ-_#/+=\\ \n";
                b[i] = PALETTE[rng.below(PALETTE.len())];
            }
            2 => b.truncate(rng.below(len + 1)),
            _ => {
                let i = rng.below(len + 1);
                let extra: Vec<u8> = (0..1 + rng.below(16)).map(|_| rng.next() as u8).collect();
                b.splice(i..i, extra);
            }
        }
    }
    String::from_utf8_lossy(&b).into_owned()
}

#[test]
fn mutated_receipts_packs_and_well_known_files_never_panic() {
    use zeceipt_core::zeceipt_types::binding::{
        evaluate, receipt_claim, WellKnownFile, WellKnownKey,
    };
    use zeceipt_core::zeceipt_types::ed25519_dalek::SigningKey;
    use zeceipt_core::zeceipt_types::AuditPack;

    let per_input: usize = std::env::var("ZECEIPT_MUTATIONS")
        .ok()
        .and_then(|v| v.parse().ok())
        .map(|n: usize| n * 10)
        .unwrap_or(1_000);
    let tx = parse_transaction(&hex::decode(FIXTURES[3].1.trim()).unwrap()).unwrap();
    // A throwaway key whose id claims a domain, so the issuer binding reads the well-known file.
    let key = SigningKey::from_bytes(&[7u8; 32]);
    let base = Receipt::from_json(RECEIPT).unwrap();
    let mut signed = base.clone();
    signed.issuer_key_id = None;
    signed.issuer_pubkey = None;
    signed.signature = None;
    let signed = signed
        .with_key_id("2026-09@pay.example.org")
        .sign(&key)
        .unwrap();
    assert!(
        verify(&signed, &tx, b"auditor-nonce-7", true).is_ok(),
        "the base receipt verifies"
    );
    let mut file = WellKnownFile::new();
    file.put(WellKnownKey {
        key_id: "2026-09@pay.example.org".into(),
        pubkey: hex::encode(key.verifying_key().to_bytes()),
        note: None,
    })
    .unwrap();
    let file_json = serde_json::to_string(&file).unwrap();
    let pack_json = AuditPack::new("audit", vec![base.clone(), signed.clone()], 1)
        .to_json()
        .unwrap();
    let inputs = [
        ("receipt JSON", RECEIPT.trim().to_string()),
        ("signed receipt JSON", signed.to_json().unwrap()),
        (
            "receipt link",
            signed.to_url("https://pay.example.org").unwrap(),
        ),
    ];

    let (mut total, mut parsed) = (0usize, 0usize);
    let mut rng = Rng(0x5eed_0f7e_c319_17a0);
    for (name, original) in &inputs {
        for i in 0..per_input {
            let input = mutate_text(&mut rng, original);
            let outcome = catch_unwind(AssertUnwindSafe(|| {
                let Ok(r) = Receipt::parse(&input) else {
                    return false;
                };
                let _ = r.verify_signature();
                let _ = r.check_challenge(b"auditor-nonce-7");
                let _ = r.ock_bytes();
                let _ = verify(&r, &tx, b"auditor-nonce-7", true);
                let _ = verify(&r, &tx, b"", false);
                let _ = receipt_claim(&r);
                let _ = evaluate(&r, "pay.example.org", file_json.as_bytes());
                true
            }));
            let Ok(ok) = outcome else {
                panic!("{name}, mutation {i} panicked; input {input:?}")
            };
            total += 1;
            parsed += ok as usize;
        }
    }
    for i in 0..per_input {
        let body = mutate_text(&mut rng, &file_json);
        let outcome = catch_unwind(AssertUnwindSafe(|| {
            evaluate(&signed, "pay.example.org", body.as_bytes())
        }));
        assert!(
            outcome.is_ok(),
            "well-known file, mutation {i} panicked; body {body:?}"
        );
        let pack = mutate_text(&mut rng, &pack_json);
        let outcome = catch_unwind(AssertUnwindSafe(|| {
            if let Ok(p) = AuditPack::from_json(&pack) {
                for r in &p.receipts {
                    let _ = verify(r, &tx, b"auditor-nonce-7", false);
                }
            }
        }));
        assert!(
            outcome.is_ok(),
            "audit pack, mutation {i} panicked; pack {pack:?}"
        );
        total += 2;
    }
    assert!(total == 0 || parsed > 0, "no mutated receipt parsed");
    eprintln!("{total} mutated receipts, packs and well-known files, {parsed} receipts parsed, none panicked");
}
