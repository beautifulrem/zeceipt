//! Write the above-MAX_MONEY fixture pair (slice U5): `cargo run -p zeceipt-core --features synthetic --example
//! make_above_max_money`, from the repository root. A synthetic Ironwood output worth MAX_MONEY + 1 zatoshis, spliced
//! into the committed mainnet transaction (not consensus-valid), and an unsigned receipt for it.
use std::fs;
use zcash_protocol::value::MAX_MONEY;
use zeceipt_core::synthetic::splice_ironwood_output;
use zeceipt_core::zeceipt_types::{Network, Pool, Receipt};

fn main() {
    let template = fs::read_to_string(
        "fixtures/0e85513c8ac28fcd6ea5324e08bde3360e5cb78e176f536d6659f14fee87da69.hex",
    )
    .expect("run from repo root");
    let bytes = hex::decode(template.trim()).unwrap();
    let syn = splice_ironwood_output(&bytes, MAX_MONEY + 1, [0u8; 512]).unwrap();
    let tx = zeceipt_core::parse_transaction(&syn.tx_bytes).unwrap();
    let mut txid = [0u8; 32];
    txid.copy_from_slice(&hex::decode(zeceipt_core::txid_hex(&tx)).unwrap());
    let receipt = Receipt::new(
        Network::Main,
        Pool::Ironwood,
        txid,
        0,
        syn.ock,
        "above MAX_MONEY",
    );
    fs::write(
        "fixtures/synthetic-above-max-money.hex",
        hex::encode(&syn.tx_bytes),
    )
    .unwrap();
    fs::write(
        "fixtures/synthetic-above-max-money-receipt.json",
        receipt.to_json().unwrap(),
    )
    .unwrap();
    println!(
        "txid {} value {} zat written to fixtures/",
        zeceipt_core::txid_hex(&tx),
        syn.value_zat
    );
}
