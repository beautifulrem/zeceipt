//! End-to-end CLI tests: exit codes and failure stages, fully offline.
use std::path::PathBuf;
use std::process::Command;

fn bin() -> Command {
    Command::new(env!("CARGO_BIN_EXE_zeceipt"))
}

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn fixture(name: &str) -> String {
    root()
        .join("fixtures")
        .join(name)
        .to_string_lossy()
        .into_owned()
}

fn run(args: &[&str]) -> (i32, String, String) {
    let out = bin().args(args).output().expect("run zeceipt");
    (
        out.status.code().unwrap_or(-1),
        String::from_utf8_lossy(&out.stdout).into_owned(),
        String::from_utf8_lossy(&out.stderr).into_owned(),
    )
}

fn stage(stdout: &str) -> String {
    let v: serde_json::Value = serde_json::from_str(stdout.trim()).expect("json output");
    v["stage"].as_str().unwrap_or("").to_string()
}

#[test]
fn usage_errors_exit_3_and_help_exits_0() {
    assert_eq!(run(&["verify"]).0, 3);
    assert_eq!(run(&["no-such-command"]).0, 3);
    assert_eq!(run(&["--help"]).0, 0);
}

#[test]
fn valid_receipt_exits_0_with_expected_fields() {
    let (code, out, err) = run(&[
        "verify",
        &fixture("synthetic-receipt.json"),
        "--raw-tx-file",
        &fixture("synthetic-ironwood.hex"),
        "--challenge",
        "auditor-nonce-7",
        "--require-signature",
    ]);
    assert_eq!(code, 0, "stderr: {err}");
    let v: serde_json::Value = serde_json::from_str(out.trim()).unwrap();
    assert_eq!(v["valid"], true);
    assert_eq!(v["value_zat"], 250_000_000);
    assert_eq!(v["memo"]["text"], "INV-2026-0142");
    assert!(v["recipient"].as_str().unwrap().starts_with("u1"));
    assert_eq!(v["challenge_checked"], true);
}

#[test]
fn failure_stages_and_exit_1() {
    let receipt = std::fs::read_to_string(fixture("synthetic-receipt.json")).unwrap();
    let raw = fixture("synthetic-ironwood.hex");
    let dir = std::env::temp_dir().join(format!("zeceipt-cli-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let write = |name: &str, s: &str| {
        let p = dir.join(name);
        std::fs::write(&p, s).unwrap();
        p.to_string_lossy().into_owned()
    };

    // wrong challenge
    let (c, o, _) = run(&[
        "verify",
        &fixture("synthetic-receipt.json"),
        "--raw-tx-file",
        &raw,
        "--challenge",
        "nope",
        "--require-signature",
    ]);
    assert_eq!((c, stage(&o)), (1, "challenge".into()));

    // network flipped after signing
    let flipped = receipt.replace("\"network\":\"main\"", "\"network\":\"test\"");
    assert_ne!(flipped, receipt);
    let p = write("flipped.json", &flipped);
    let (c, o, _) = run(&[
        "verify",
        &p,
        "--raw-tx-file",
        &raw,
        "--challenge",
        "auditor-nonce-7",
        "--require-signature",
    ]);
    assert_eq!((c, stage(&o)), (1, "signature".into()));

    // tampered ock, signature stripped: must fail at recovery
    let mut v: serde_json::Value = serde_json::from_str(&receipt).unwrap();
    let ock = v["ock"].as_str().unwrap().to_string();
    let last = ock.chars().last().unwrap();
    let new_last = if last == 'A' { 'B' } else { 'A' };
    v["ock"] = serde_json::Value::String(format!("{}{}", &ock[..ock.len() - 1], new_last));
    v.as_object_mut().unwrap().remove("signature");
    v.as_object_mut().unwrap().remove("issuer_pubkey");
    let p = write("tampered.json", &v.to_string());
    let (c, o, _) = run(&[
        "verify",
        &p,
        "--raw-tx-file",
        &raw,
        "--challenge",
        "auditor-nonce-7",
    ]);
    assert_eq!((c, stage(&o)), (1, "recovery".into()));

    // unsigned receipt but signature required
    let mut u: serde_json::Value = serde_json::from_str(&receipt).unwrap();
    u.as_object_mut().unwrap().remove("signature");
    u.as_object_mut().unwrap().remove("issuer_pubkey");
    let p = write("unsigned.json", &u.to_string());
    let (c, o, _) = run(&[
        "verify",
        &p,
        "--raw-tx-file",
        &raw,
        "--challenge",
        "auditor-nonce-7",
        "--require-signature",
    ]);
    assert_eq!((c, stage(&o)), (1, "signature".into()));

    // wrong transaction -> txid stage
    let (c, o, _) = run(&[
        "verify",
        &fixture("synthetic-receipt.json"),
        "--raw-tx-file",
        &fixture("0e85513c8ac28fcd6ea5324e08bde3360e5cb78e176f536d6659f14fee87da69.hex"),
        "--challenge",
        "auditor-nonce-7",
    ]);
    assert_eq!((c, stage(&o)), (1, "txid".into()));

    // explicit --testnet contradicts a mainnet receipt -> network stage
    let (c, o, _) = run(&[
        "verify",
        &fixture("synthetic-receipt.json"),
        "--testnet",
        "--raw-tx-file",
        &raw,
        "--challenge",
        "auditor-nonce-7",
    ]);
    assert_eq!((c, stage(&o)), (1, "network".into()));

    // garbage input -> parse stage
    let (c, o, _) = run(&["verify", "not-a-receipt", "--raw-tx-file", &raw]);
    assert_eq!((c, stage(&o)), (1, "parse".into()));
}

#[test]
fn inspect_issue_pack_and_verify_pack_offline() {
    let dir = std::env::temp_dir().join(format!("zeceipt-pack-test-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let raw = fixture("synthetic-ironwood.hex");

    let (c, o, _) = run(&["inspect", "--raw-tx-file", &raw]);
    assert_eq!(c, 0);
    let v: serde_json::Value = serde_json::from_str(o.trim()).unwrap();
    assert_eq!(v["version"], "V6");
    assert!(v["outputs"]
        .as_array()
        .unwrap()
        .iter()
        .any(|o| o["pool"] == "ironwood"));

    let key = dir.join("issuer.key");
    assert_eq!(run(&["keygen", "--out", key.to_str().unwrap()]).0, 0);
    let ovk = std::fs::read_to_string(fixture("synthetic-ovk.hex")).unwrap();
    let out_dir = dir.join("receipts");
    let (c, _, err) = run(&[
        "issue",
        "--raw-tx-file",
        &raw,
        "--ovk",
        ovk.trim(),
        "--label",
        "pack-test",
        "--key-file",
        key.to_str().unwrap(),
        "--out-dir",
        out_dir.to_str().unwrap(),
    ]);
    assert_eq!(c, 0, "stderr: {err}");
    let files: Vec<String> = std::fs::read_dir(&out_dir)
        .unwrap()
        .map(|e| e.unwrap().path().to_string_lossy().into_owned())
        .collect();
    assert_eq!(files.len(), 1);

    let (c, pack, _) = run(&[
        "pack",
        "--title",
        "t",
        "--declared-total-zat",
        "250000000",
        &files[0],
    ]);
    assert_eq!(c, 0);
    let pack_path = dir.join("pack.json");
    std::fs::write(&pack_path, &pack).unwrap();

    // raw tx dir keyed by txid
    let r: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&files[0]).unwrap()).unwrap();
    let raw_dir = dir.join("raw");
    std::fs::create_dir_all(&raw_dir).unwrap();
    std::fs::copy(
        &raw,
        raw_dir.join(format!("{}.hex", r["txid"].as_str().unwrap())),
    )
    .unwrap();
    let (c, o, _) = run(&[
        "verify-pack",
        pack_path.to_str().unwrap(),
        "--raw-tx-dir",
        raw_dir.to_str().unwrap(),
        "--require-signature",
    ]);
    assert_eq!(c, 0, "{o}");
    let v: serde_json::Value = serde_json::from_str(o.trim()).unwrap();
    assert_eq!(v["all_valid"], true);
    assert_eq!(v["verified_total_zat"], 250_000_000);
}

/// A consensus-valid regtest transaction (mined by Zebra) with a receipt issued
/// from the sender's UFVK: the strongest offline evidence in the repository.
#[test]
fn regtest_receipt_verifies_offline_and_tamper_fails() {
    let raw =
        fixture("regtest-48be62e21bdc98080da9aa396844c8bd7f86496ca0cb1759ea91d1a19e0fa92d.hex");
    let (c, o, err) = run(&[
        "verify",
        &fixture("regtest-receipt.json"),
        "--raw-tx-file",
        &raw,
        "--challenge",
        "auditor-nonce-9",
        "--require-signature",
    ]);
    assert_eq!(c, 0, "stderr: {err}");
    let v: serde_json::Value = serde_json::from_str(o.trim()).unwrap();
    assert_eq!(v["valid"], true);
    assert_eq!(v["pool"], "ironwood");
    assert_eq!(v["output_index"], 1);
    assert_eq!(v["value_zat"], 250_000_000);
    assert!(v["recipient"].as_str().unwrap().starts_with("uregtest1"));
    assert_eq!(v["memo"]["text"], "INV-R-001 | 3,797.00 USD @ 1518.81");
    // Wrong challenge and a mainnet-context contradiction both fail closed.
    let (c, o, _) = run(&[
        "verify",
        &fixture("regtest-receipt.json"),
        "--raw-tx-file",
        &raw,
        "--challenge",
        "x",
        "--require-signature",
    ]);
    assert_eq!((c, stage(&o)), (1, "challenge".into()));
    let (c, o, _) = run(&[
        "verify",
        &fixture("regtest-receipt.json"),
        "--raw-tx-file",
        &fixture("synthetic-ironwood.hex"),
        "--challenge",
        "auditor-nonce-9",
    ]);
    assert_eq!((c, stage(&o)), (1, "txid".into()));
}

/// `is_change` is `null` when the issuer key cannot recognise change (bare OVK)
/// and a real boolean when a UFVK is supplied (Zkool batch fixture: 3 payments,
/// change excluded by default, flagged with `--include-change`).
#[test]
fn is_change_is_null_with_bare_ovk_and_boolean_with_ufvk() {
    let ovk = std::fs::read_to_string(fixture("synthetic-ovk.hex")).unwrap();
    let (code, out, err) = run(&[
        "issue",
        "--raw-tx-file",
        &fixture("synthetic-ironwood.hex"),
        "--ovk",
        ovk.trim(),
        "--label",
        "t",
    ]);
    assert_eq!(code, 0, "stderr: {err}");
    assert!(
        err.contains("bare OVK cannot recognise change"),
        "warning missing: {err}"
    );
    let v: serde_json::Value = serde_json::from_str(out.trim()).unwrap();
    assert!(v["receipts"][0]["recovered"]["is_change"].is_null());

    let ufvk = std::fs::read_to_string(fixture("regtest-issuer-ufvk.txt")).unwrap();
    let tx =
        fixture("regtest-48db254a361e9676b90d4864505bd536de9bc6952c46aeea087ec213fdac47b2.hex");
    let (code, out, err) = run(&[
        "issue",
        "--regtest",
        "--raw-tx-file",
        &tx,
        "--ufvk",
        ufvk.trim(),
        "--label",
        "t",
    ]);
    assert_eq!(code, 0, "stderr: {err}");
    assert!(!err.contains("bare OVK"));
    let v: serde_json::Value = serde_json::from_str(out.trim()).unwrap();
    let receipts = v["receipts"].as_array().unwrap();
    assert_eq!(receipts.len(), 3);
    assert!(receipts
        .iter()
        .all(|r| r["recovered"]["is_change"] == false));

    let (code, out, _) = run(&[
        "issue",
        "--regtest",
        "--raw-tx-file",
        &tx,
        "--ufvk",
        ufvk.trim(),
        "--label",
        "t",
        "--include-change",
    ]);
    assert_eq!(code, 0);
    let v: serde_json::Value = serde_json::from_str(out.trim()).unwrap();
    let receipts = v["receipts"].as_array().unwrap();
    assert_eq!(receipts.len(), 4);
    let change: Vec<_> = receipts
        .iter()
        .filter(|r| r["recovered"]["is_change"] == true)
        .collect();
    assert_eq!(change.len(), 1);
    assert_eq!(change[0]["recovered"]["value_zec"], "217.25048750");
}
