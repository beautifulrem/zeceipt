//! Regenerate `spec/test-vectors/receipt-v0.json`:
//! `cargo run -p zeceipt-types --example gen_vectors > spec/test-vectors/receipt-v0.json`
use serde_json::json;
use zeceipt_types::ed25519_dalek::SigningKey;
use zeceipt_types::{Network, Pool, Receipt};

fn main() {
    let key = SigningKey::from_bytes(&[7u8; 32]);
    let base = Receipt::new(
        Network::Main,
        Pool::Ironwood,
        [0x11; 32],
        2,
        [0x22; 32],
        "INV-2026-0142 | 150.00 USD",
    );
    let cases: Vec<(&str, Receipt)> = vec![
        ("main-ironwood-plain", base.clone()),
        ("with-challenge", base.clone().with_challenge(b"nonce-42")),
        ("with-key-id", base.clone().with_key_id("2026-09")),
        (
            "testnet-sapling-empty-label",
            Receipt::new(Network::Test, Pool::Sapling, [0xab; 32], 0, [0xcd; 32], ""),
        ),
        (
            "orchard-max-index",
            Receipt::new(
                Network::Main,
                Pool::Orchard,
                [0x00; 32],
                u32::MAX,
                [0xff; 32],
                "x",
            ),
        ),
    ];
    let mut vectors = Vec::new();
    // One vector per (network, pool) so that adding an enum variant without
    // regenerating vectors (and rebuilding the wasm package) fails the guard.
    let mut cases = cases;
    for (ni, network) in [Network::Main, Network::Test, Network::Regtest]
        .into_iter()
        .enumerate()
    {
        for (pi, pool) in [Pool::Ironwood, Pool::Orchard, Pool::Sapling]
            .into_iter()
            .enumerate()
        {
            let name: &'static str = Box::leak(
                format!("enum-{:?}-{:?}", network, pool)
                    .to_lowercase()
                    .into_boxed_str(),
            );
            cases.push((
                name,
                Receipt::new(
                    network,
                    pool,
                    [ni as u8 + 1; 32],
                    pi as u32,
                    [0x5a; 32],
                    "enum coverage",
                ),
            ));
        }
    }
    for (name, r) in &cases {
        let signed = r.clone().sign(&key).unwrap();
        vectors.push(json!({
            "name": name,
            "receipt": r,
            "canonical_bytes_hex": hex::encode(r.canonical_bytes().unwrap()),
            "signature_hex": signed.signature.clone().unwrap(),
            "signed_receipt": signed,
            "verifies": true,
        }));
    }
    let mut flipped = base.clone().sign(&key).unwrap();
    flipped.network = Network::Test;
    vectors.push(json!({
        "name": "negative-network-flipped-after-signing",
        "receipt": base,
        "canonical_bytes_hex": hex::encode(base.canonical_bytes().unwrap()),
        "signature_hex": base.clone().sign(&key).unwrap().signature.unwrap(),
        "signed_receipt": flipped,
        "verifies": false,
    }));
    // Shareable URL forms (spec §2) for the first vector's signed receipt: the fragment
    // form issuers emit, and the v0 path form verifiers still accept.
    let first = base.clone().sign(&key).unwrap();
    let host = "https://receipts.example";
    let fragment_url = first.to_url(host).unwrap();
    let url_forms = json!({
        "vector": cases[0].0,
        "host": host,
        "fragment": fragment_url,
        "path": fragment_url.replacen("/r#", "/r/", 1),
    });
    println!(
        "{}",
        serde_json::to_string_pretty(&json!({
            "format": "zeceipt-v0",
            "note": "Deterministic vectors. signing_key_hex is a throwaway ed25519 secret used only for these vectors.",
            "signing_key_hex": hex::encode(key.to_bytes()),
            "networks": Network::ALL.iter().map(|n| n.as_str()).collect::<Vec<_>>(),
            "pools": Pool::ALL.iter().map(|p| p.as_str()).collect::<Vec<_>>(),
            "canonical_bytes": "b\"zeceipt-v0\" || network(1) || pool(1) || txid(32) || output_index u32 LE || ock(32) || len(label) u32 LE || label || len(challenge) u32 LE || challenge || len(issuer_key_id) u32 LE || issuer_key_id",
            "vectors": vectors,
            "url_forms": url_forms,
        }))
        .unwrap()
    );
}
