//! No input makes the core panic (slice U3). Zebra's GHSA-h5rr-8pqv-grp9 was found by fuzzing (OSS-Fuzz): a parsed
//! transaction that a later step could not handle aborted the node (R127). Here every committed transaction is mutated
//! with a seeded generator (bit flips, byte overwrites, truncation, deletions, insertions, a swapped branch id) and each
//! result goes through every step a receipt takes: parse, txid, output listing, issuing with the fixtures' keys, and
//! verifying a receipt made for that transaction's own txid with a real OCK. Errors are expected; a panic fails. In the
//! browser a panic traps the WASM, so the page would lose its verifier. `ZECEIPT_MUTATIONS` sets the count per
//! fixture: 40 by default (about 12 s in a debug build), and the deep run the slice records is
//! `ZECEIPT_MUTATIONS=5000 cargo test --release -p zeceipt-core --test mutation -- --nocapture`.

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

/// Every step a receipt takes, on one input. Errors are fine; only a panic is a failure.
fn exercise(bytes: &[u8], keys: &[OutgoingKeys], ock: [u8; 32]) {
    let Ok(tx) = parse_transaction(bytes) else {
        return;
    };
    let txid = txid_hex(&tx);
    let outputs = enumerate_outputs(&tx);
    for k in keys {
        for include_change in [false, true] {
            let _ = issue(
                &tx,
                k,
                &IssueOptions {
                    label: String::new(),
                    challenge: None,
                    key_id: None,
                    include_change,
                    signer: None,
                },
            );
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
    let (mut parsed, mut total) = (0usize, 0usize);
    for (f, (name, hex_tx)) in FIXTURES.iter().enumerate() {
        let original = hex::decode(hex_tx.trim()).unwrap();
        assert!(
            parse_transaction(&original).is_ok(),
            "{name} parses as committed"
        );
        let mut rng = Rng(0x9e37_79b9_7f4a_7c15 ^ (f as u64 + 1));
        for i in 0..per_fixture {
            let input = mutate(&mut rng, original.clone());
            let outcome = catch_unwind(AssertUnwindSafe(|| exercise(&input, &keys, ock)));
            assert!(
                outcome.is_ok(),
                "{name}, mutation {i} panicked; input {}",
                hex::encode(&input)
            );
            total += 1;
            if parse_transaction(&input).is_ok() {
                parsed += 1;
            }
        }
    }
    // Some mutations must survive parsing, or the later steps would never run.
    assert!(
        parsed > total / 50,
        "only {parsed} of {total} mutated inputs parsed"
    );
    eprintln!("{total} mutated transactions, {parsed} parsed, none panicked");
}
