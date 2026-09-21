//! Write an offline synthetic fixture: `cargo run -p zeceipt-core --features synthetic --example make_synthetic`
use std::fs;
use zeceipt_core::synthetic::splice_ironwood_output;

fn main() {
    let template = fs::read_to_string(
        "fixtures/0e85513c8ac28fcd6ea5324e08bde3360e5cb78e176f536d6659f14fee87da69.hex",
    )
    .expect("run from repo root");
    let bytes = hex::decode(template.trim()).unwrap();
    let mut memo = [0u8; 512];
    memo[..13].copy_from_slice(b"INV-2026-0142");
    let syn = splice_ironwood_output(&bytes, 250_000_000, memo).unwrap();
    fs::write(
        "fixtures/synthetic-ironwood.hex",
        hex::encode(&syn.tx_bytes),
    )
    .unwrap();
    fs::write("fixtures/synthetic-ovk.hex", hex::encode(syn.ovk)).unwrap();
    let tx = zeceipt_core::parse_transaction(&syn.tx_bytes).unwrap();
    println!(
        "synthetic txid {} value {} zat written to fixtures/",
        zeceipt_core::txid_hex(&tx),
        syn.value_zat
    );
}
