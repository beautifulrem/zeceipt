//! The conformance vectors of `spec/dossier-v1.md` §11 (`spec/test-vectors/dossier-v1.json`), run against this
//! implementation: every case patches a real testnet dossier, supplies its transactions from `fixtures/testnet/`, and
//! must give the recorded outcome. `packages/verify/test/dossier-vectors.mjs` runs the same file through the WASM.
//!
//! `ZECEIPT_WRITE_VECTORS=1 cargo test -p zeceipt-core --test dossier_vectors` rewrites every `expect` from the current
//! code instead of checking it; review the diff before committing it.

use std::collections::HashMap;

use serde_json::{json, Value};
use zeceipt_core::dossier::{
    check_dossier_with, prevout_txids, txids_needed, CheckOptions, Report, Status, TxData,
};
use zeceipt_core::zeceipt_types::dossier::Dossier;

fn repo(p: &str) -> String {
    std::fs::read_to_string(format!("{}/../../{p}", env!("CARGO_MANIFEST_DIR"))).unwrap()
}

/// RFC 6902 `add`, `replace` and `remove` on JSON pointers without escapes (`-` appends to an array).
fn apply(doc: &mut Value, patch: &[Value]) {
    for op in patch {
        let path: Vec<&str> = op["path"].as_str().unwrap()[1..].split('/').collect();
        let (last, parents) = path.split_last().unwrap();
        let mut at = &mut *doc;
        for k in parents {
            at = match at {
                Value::Array(a) => &mut a[k.parse::<usize>().unwrap()],
                v => &mut v[*k],
            };
        }
        let value = op.get("value").cloned();
        match (op["op"].as_str().unwrap(), at) {
            ("remove", Value::Array(a)) => {
                a.remove(last.parse().unwrap());
            }
            ("remove", Value::Object(o)) => {
                o.remove(*last);
            }
            ("add", Value::Array(a)) if *last == "-" => a.push(value.unwrap()),
            ("add", Value::Array(a)) => a.insert(last.parse().unwrap(), value.unwrap()),
            (_, Value::Array(a)) => a[last.parse::<usize>().unwrap()] = value.unwrap(),
            (_, Value::Object(o)) => {
                o.insert(last.to_string(), value.unwrap());
            }
            (o, _) => panic!("cannot {o} at {:?}", op["path"]),
        }
    }
}

/// The transactions a case supplies: what the dossier names, then its origins' previous transactions (as the CLI
/// fetches them), from files, changed as the case says.
fn supply(d: &Dossier, txs: &Value, heights: &Value) -> HashMap<String, TxData> {
    let file = |t: &str| {
        let p = format!(
            "{}/../../fixtures/testnet/{t}.hex",
            env!("CARGO_MANIFEST_DIR")
        );
        std::fs::read_to_string(p)
            .ok()
            .map(|h| hex::decode(h.trim()).unwrap())
    };
    let omit = |t: &str| {
        txs["omit"]
            .as_array()
            .is_some_and(|a| a.iter().any(|x| x == t))
    };
    let mut got: HashMap<String, TxData> = HashMap::new();
    for round in 0..2 {
        let ids = if round == 0 {
            txids_needed(d)
        } else {
            prevout_txids(d, &got)
        };
        for t in ids {
            if omit(&t) {
                continue;
            }
            let bytes = match txs["hex"].get(&t) {
                Some(h) => hex::decode(h.as_str().unwrap()).unwrap_or_default(),
                None => match file(&t) {
                    Some(b) => b,
                    None => continue,
                },
            };
            let mempool = txs["mempool"] == "all"
                || txs["mempool"]
                    .as_array()
                    .is_some_and(|a| a.iter().any(|x| *x == t));
            let height = if mempool || txs["heights"] != true {
                None
            } else {
                heights[&t].as_u64()
            };
            got.insert(
                t,
                TxData {
                    bytes,
                    height,
                    mempool,
                },
            );
        }
    }
    got
}

/// The outcome a case records: what conformance means (spec §11), plus the summaries of the claims that did not verify.
fn outcome(r: &Report) -> Value {
    let exit = if r.all_verified {
        0
    } else if !r.problems.is_empty()
        || r.claims
            .iter()
            .any(|c| matches!(c.status, Status::Failed | Status::Unproven))
    {
        1
    } else {
        2
    };
    let mut v = json!({
        "exit": exit,
        "all_verified": r.all_verified,
        "assurance": r.assurance,
        "nk_proven": r.nk_proven,
        "controlled": r.controlled,
        "statuses": r.claims.iter().map(|c| c.status).collect::<Vec<_>>(),
    });
    if !r.problems.is_empty() {
        v["problems"] = json!(r.problems);
    }
    let not: Vec<Value> = r
        .claims
        .iter()
        .filter(|c| c.status != Status::Verified)
        .map(
            |c| json!({"index": c.index, "kind": c.kind, "status": c.status, "summary": c.summary}),
        )
        .collect();
    if !not.is_empty() {
        v["not_verified"] = json!(not);
    }
    v
}

/// A parse error without serde's position, which depends on how the patched document was serialized.
fn parse_error(e: &str) -> String {
    match e.find(" at line ") {
        Some(i) => e[..i].to_string(),
        None => e.to_string(),
    }
}

#[test]
fn the_spec_vectors_hold() {
    let path = format!(
        "{}/../../spec/test-vectors/dossier-v1.json",
        env!("CARGO_MANIFEST_DIR")
    );
    let mut vectors: Value =
        serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
    let write = std::env::var("ZECEIPT_WRITE_VECTORS").is_ok_and(|v| v == "1");
    let heights = vectors["heights"].clone();
    let dossiers = vectors["dossiers"].clone();
    let base = |case: &Value| -> Value {
        let which = case["dossier"].as_str().unwrap_or("base");
        serde_json::from_str(&repo(dossiers[which].as_str().unwrap())).unwrap()
    };
    let mut wrong = Vec::new();
    let n = vectors["cases"].as_array().unwrap().len();
    for i in 0..n {
        let case = vectors["cases"][i].clone();
        let mut doc = base(&case);
        apply(&mut doc, case["patch"].as_array().unwrap());
        let text = serde_json::to_string_pretty(&doc).unwrap();
        let d = Dossier::parse(&text).unwrap_or_else(|e| panic!("case {}: {e}", case["name"]));
        let txs = supply(&d, &case["txs"], &heights);
        let opts = CheckOptions {
            expect_nonce: case["expect_nonce"].as_str().map(String::from),
            issued_at_height: case["issued_at_height"].as_u64(),
        };
        let got = outcome(&check_dossier_with(&d, &text, &txs, &opts));
        if write {
            vectors["cases"][i]["expect"] = got;
        } else if got != case["expect"] {
            wrong.push(format!(
                "case {}:\n  expected {}\n  got      {}",
                case["name"], case["expect"], got
            ));
        }
    }
    let n = vectors["parse_cases"].as_array().unwrap().len();
    for i in 0..n {
        let case = vectors["parse_cases"][i].clone();
        let mut doc = base(&case);
        apply(&mut doc, case["patch"].as_array().unwrap());
        let got = match Dossier::parse(&serde_json::to_string_pretty(&doc).unwrap()) {
            Ok(_) => json!({"exit": 0, "stage": "none"}),
            Err(e) => {
                json!({"exit": 1, "stage": "parse", "error": parse_error(&e.to_string())})
            }
        };
        if write {
            vectors["parse_cases"][i]["expect"] = got;
        } else if got != case["expect"] {
            wrong.push(format!(
                "parse case {}:\n  expected {}\n  got      {}",
                case["name"], case["expect"], got
            ));
        }
    }
    if write {
        std::fs::write(
            &path,
            serde_json::to_string_pretty(&vectors).unwrap() + "\n",
        )
        .unwrap();
    }
    assert!(wrong.is_empty(), "{}", wrong.join("\n"));
}
