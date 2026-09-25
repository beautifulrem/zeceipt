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

/// `issue` prints links with the payload in the fragment (spec §2), and `verify` takes
/// that link as well as the v0 path form.
#[test]
fn issue_prints_fragment_links_and_verify_takes_both_forms() {
    let raw = fixture("synthetic-ironwood.hex");
    let ovk = std::fs::read_to_string(fixture("synthetic-ovk.hex")).unwrap();
    let (c, o, err) = run(&[
        "issue",
        "--raw-tx-file",
        &raw,
        "--ovk",
        ovk.trim(),
        "--label",
        "link-test",
        "--host",
        "https://receipts.example",
    ]);
    assert_eq!(c, 0, "stderr: {err}");
    assert!(!err.contains("no --host"), "{err}");
    let v: serde_json::Value = serde_json::from_str(o.trim()).unwrap();
    let url = v["receipts"][0]["url"].as_str().unwrap().to_string();
    assert!(url.starts_with("https://receipts.example/r#ey"), "{url}");
    let path_form = url.replacen("/r#", "/r/", 1);
    for link in [&url, &path_form] {
        let (c, o, err) = run(&["verify", link, "--raw-tx-file", &raw]);
        assert_eq!(c, 0, "{link}: {o} {err}");
        let v: serde_json::Value = serde_json::from_str(o.trim()).unwrap();
        assert_eq!(v["valid"], true);
        assert_eq!(v["value_zat"], 250_000_000);
    }
}

/// `--host` has no default (slice S2): the page a host serves can read the link's fragment,
/// so a default the operator does not control could collect every receipt. Without it the
/// receipts are still issued and written, with no link, and stderr says why.
#[test]
fn issue_without_host_prints_no_link() {
    let raw = fixture("synthetic-ironwood.hex");
    let ovk = std::fs::read_to_string(fixture("synthetic-ovk.hex")).unwrap();
    let dir = std::env::temp_dir().join(format!("zeceipt-nohost-test-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let (c, o, err) = run(&[
        "issue",
        "--raw-tx-file",
        &raw,
        "--ovk",
        ovk.trim(),
        "--out-dir",
        dir.to_str().unwrap(),
    ]);
    assert_eq!(c, 0, "stderr: {err}");
    assert!(
        err.contains("no --host: receipts carry no link; pass --host with the site you control"),
        "{err}"
    );
    let v: serde_json::Value = serde_json::from_str(o.trim()).unwrap();
    let receipts = v["receipts"].as_array().unwrap();
    assert!(!receipts.is_empty());
    for r in receipts {
        assert!(
            r.as_object().unwrap().contains_key("url"),
            "the key stays: {r}"
        );
        assert!(r["url"].is_null(), "{r}");
    }
    assert_eq!(std::fs::read_dir(&dir).unwrap().count(), receipts.len());
    let _ = std::fs::remove_dir_all(&dir);
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
    // An explicit `null`, not an absent key: "unknown" must be encoded, not omitted.
    assert_eq!(
        v["receipts"][0]["recovered"].get("is_change"),
        Some(&serde_json::Value::Null)
    );

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

/// `--only-to` restricts issuance to the given recipients (matched by receiver), reports how many opened
/// outputs were skipped, and rejects undecodable addresses; `--ufvk-file` reads the key from a file.
#[test]
fn only_to_allow_list_and_ufvk_file() {
    let tx =
        fixture("regtest-48db254a361e9676b90d4864505bd536de9bc6952c46aeea087ec213fdac47b2.hex");
    let ufvk_file = fixture("regtest-issuer-ufvk.txt");
    let r3 = "uregtest1km3xxn9hysaxd6umac95x2dckkv4hdmjevkfar0qqs7056n9m04ays3u64e9zfmdtxdmd0mlqtqhcp2c4nal7znqf30l00yetcp28syj";
    let (code, out, err) = run(&[
        "issue",
        "--regtest",
        "--raw-tx-file",
        &tx,
        "--ufvk-file",
        &ufvk_file,
        "--include-change",
        "--only-to",
        r3,
    ]);
    assert_eq!(code, 0, "stderr: {err}");
    let v: serde_json::Value = serde_json::from_str(out.trim()).unwrap();
    let receipts = v["receipts"].as_array().unwrap();
    assert_eq!(receipts.len(), 1);
    assert_eq!(receipts[0]["recovered"]["memo"]["text"], "INV-R-003");
    assert_eq!(v["skipped_not_in_allow_list"], 3);
    assert_eq!(receipts[0]["matched_only_to"], serde_json::json!([r3]));

    // Two allow-list entries: each receipt names only the entry it actually pays.
    let r2 = "uregtest1qzj498rks3e6gfazv0fxns3d0v4qcdpj38yswctfhakqruuw9xv672xdhystq3mxyz66ytudxtgnm7ys6skun57za5llp0fp3saxsu4w";
    let (code, out, err) = run(&[
        "issue",
        "--regtest",
        "--raw-tx-file",
        &tx,
        "--ufvk-file",
        &ufvk_file,
        "--only-to",
        r2,
        "--only-to",
        r3,
    ]);
    assert_eq!(code, 0, "stderr: {err}");
    let v: serde_json::Value = serde_json::from_str(out.trim()).unwrap();
    let by_memo: std::collections::BTreeMap<String, serde_json::Value> = v["receipts"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| {
            (
                r["recovered"]["memo"]["text"].as_str().unwrap().to_string(),
                r["matched_only_to"].clone(),
            )
        })
        .collect();
    assert_eq!(by_memo.len(), 2);
    assert_eq!(by_memo["INV-R-002"], serde_json::json!([r2]));
    assert_eq!(by_memo["INV-R-003"], serde_json::json!([r3]));

    let (code, _, err) = run(&[
        "issue",
        "--regtest",
        "--raw-tx-file",
        &tx,
        "--ufvk-file",
        &ufvk_file,
        "--only-to",
        "u1notanaddress",
    ]);
    assert_eq!(code, 3, "stderr: {err}");
    assert!(err.contains("--only-to"), "{err}");

    let (code, _, err) = run(&[
        "issue",
        "--regtest",
        "--raw-tx-file",
        &tx,
        "--ufvk-file",
        &ufvk_file,
        "--only-to",
        r3.replace("uregtest", "utest").as_str(),
    ]);
    assert_eq!(code, 3, "stderr: {err}");
}

/// `well-known` (spec §7): the file binding a key to the domain its key id claims. Only the public
/// key is written; a second key for the same domain merges; a key id without a valid ASCII domain,
/// or a merge across domains, is refused (exit 3).
#[test]
fn well_known_prints_the_binding_file() {
    let dir = std::env::temp_dir().join(format!("zeceipt-wellknown-test-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let key = dir.join("issuer.key");
    let (c, o, _) = run(&["keygen", "--out", key.to_str().unwrap()]);
    assert_eq!(c, 0);
    let pubkey = serde_json::from_str::<serde_json::Value>(o.trim()).unwrap()["issuer_pubkey"]
        .as_str()
        .unwrap()
        .to_string();
    let secret = std::fs::read_to_string(&key).unwrap();

    let (c, o, err) = run(&[
        "well-known",
        "--key-file",
        key.to_str().unwrap(),
        "--key-id",
        "2026-09@pay.example.org",
    ]);
    assert_eq!(c, 0, "{err}");
    assert!(
        err.contains("https://pay.example.org/.well-known/zeceipt.json"),
        "{err}"
    );
    assert!(
        !o.contains(secret.trim()) && !err.contains(secret.trim()),
        "never the secret key"
    );
    let file: serde_json::Value = serde_json::from_str(o.trim()).unwrap();
    assert_eq!(
        file,
        serde_json::json!({"version": "zeceipt-v0", "keys": [{"key_id": "2026-09@pay.example.org", "pubkey": pubkey}]})
    );

    let first = dir.join("zeceipt.json");
    std::fs::write(&first, o.trim()).unwrap();
    let (c, o, err) = run(&[
        "well-known",
        "--key-file",
        key.to_str().unwrap(),
        "--key-id",
        "2026-10@pay.example.org",
        "--note",
        "current",
        "--merge",
        first.to_str().unwrap(),
    ]);
    assert_eq!(c, 0, "{err}");
    let merged: serde_json::Value = serde_json::from_str(o.trim()).unwrap();
    assert_eq!(merged["keys"].as_array().unwrap().len(), 2);
    assert_eq!(merged["keys"][1]["note"], "current");

    for (key_id, needle) in [
        ("2026-09", "<label>@<domain>"),
        ("2026-09@p\u{0430}y.example.org", "<label>@<domain>"),
        ("2026-09@other.example.org", "its own domain only"),
    ] {
        let (c, _, err) = run(&[
            "well-known",
            "--key-file",
            key.to_str().unwrap(),
            "--key-id",
            key_id,
            "--merge",
            first.to_str().unwrap(),
        ]);
        assert_eq!(c, 3, "{key_id}: {err}");
        assert!(err.contains(needle), "{key_id}: {err}");
    }
    let _ = std::fs::remove_dir_all(&dir);
}

/// `verify --issuer-file` / `--check-issuer` (spec §7): the binding is reported next to the verdict
/// and never changes `valid`. Offline here: the file is compared as given (the fetch rules are
/// unit-tested in `wellknown.rs`; `--check-issuer` without a claim makes no request).
#[test]
fn verify_reports_the_issuer_binding_and_never_changes_validity() {
    let dir = std::env::temp_dir().join(format!("zeceipt-binding-test-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let raw = fixture("synthetic-ironwood.hex");
    let ovk = std::fs::read_to_string(fixture("synthetic-ovk.hex")).unwrap();
    let key = dir.join("issuer.key");
    let other = dir.join("other.key");
    assert_eq!(run(&["keygen", "--out", key.to_str().unwrap()]).0, 0);
    assert_eq!(run(&["keygen", "--out", other.to_str().unwrap()]).0, 0);
    let issue = |key_id: &str, out: &str| {
        let d = dir.join(out);
        let (c, _, err) = run(&[
            "issue",
            "--raw-tx-file",
            &raw,
            "--ovk",
            ovk.trim(),
            "--key-file",
            key.to_str().unwrap(),
            "--key-id",
            key_id,
            "--out-dir",
            d.to_str().unwrap(),
        ]);
        assert_eq!(c, 0, "{err}");
        std::fs::read_dir(&d)
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path()
    };
    let claimed = issue("2026-09@pay.example.org", "claimed");
    let plain = issue("2026-09", "plain");
    let well_known = |key_file: &PathBuf, name: &str| {
        let (c, o, err) = run(&[
            "well-known",
            "--key-file",
            key_file.to_str().unwrap(),
            "--key-id",
            "2026-09@pay.example.org",
        ]);
        assert_eq!(c, 0, "{err}");
        let p = dir.join(name);
        std::fs::write(&p, o).unwrap();
        p
    };
    let ours = well_known(&key, "ours.json");
    let theirs = well_known(&other, "theirs.json");
    let junk = dir.join("junk.json");
    std::fs::write(&junk, "<html>").unwrap();

    let verify = |receipt: &PathBuf, extra: &[&str]| {
        let mut args = vec!["verify", receipt.to_str().unwrap(), "--raw-tx-file", &raw];
        args.extend_from_slice(extra);
        let (c, o, err) = run(&args);
        assert_eq!(c, 0, "the binding never changes the verdict: {o} {err}");
        let v: serde_json::Value = serde_json::from_str(o.trim()).unwrap();
        assert_eq!(v["valid"], true);
        v
    };
    assert!(
        verify(&claimed, &[]).get("issuer_binding").is_none(),
        "no lookup unless asked"
    );
    assert_eq!(
        verify(&claimed, &["--issuer-file", ours.to_str().unwrap()])["issuer_binding"],
        serde_json::json!({"state": "confirmed", "domain": "pay.example.org"})
    );
    assert_eq!(
        verify(&claimed, &["--issuer-file", theirs.to_str().unwrap()])["issuer_binding"],
        serde_json::json!({"state": "not_listed", "domain": "pay.example.org"}),
        "the domain lists another key under this id"
    );
    assert_eq!(
        verify(&claimed, &["--issuer-file", junk.to_str().unwrap()])["issuer_binding"]["state"],
        "unknown"
    );
    let none = verify(&plain, &["--check-issuer"]);
    assert_eq!(none["issuer_binding"]["state"], "unknown");
    assert!(
        none["issuer_binding"]["reason"]
            .as_str()
            .unwrap()
            .contains("claims no domain"),
        "{none}"
    );
    let (c, _, err) = run(&[
        "verify",
        claimed.to_str().unwrap(),
        "--raw-tx-file",
        &raw,
        "--check-issuer",
        "--issuer-file",
        ours.to_str().unwrap(),
    ]);
    assert_eq!(c, 3, "the two are exclusive: {err}");
    let _ = std::fs::remove_dir_all(&dir);
}

/// The verdict's own words match spec §4 (slice D5, after review D2): whoever produced the receipt
/// knew the OCK, which anyone holding an earlier receipt for the output also knows; never "the issuer".
#[test]
fn verify_says_what_a_receipt_proves_as_spec_section_4_does() {
    let raw = fixture("synthetic-ironwood.hex");
    let ovk = std::fs::read_to_string(fixture("synthetic-ovk.hex")).unwrap();
    let (c, o, err) = run(&[
        "issue",
        "--raw-tx-file",
        &raw,
        "--ovk",
        ovk.trim(),
        "--host",
        "https://receipts.example",
    ]);
    assert_eq!(c, 0, "{err}");
    let url = serde_json::from_str::<serde_json::Value>(o.trim()).unwrap()["receipts"][0]["url"]
        .as_str()
        .unwrap()
        .to_string();
    let (c, o, _) = run(&["verify", &url, "--raw-tx-file", &raw]);
    assert_eq!(c, 0);
    let v: serde_json::Value = serde_json::from_str(o.trim()).unwrap();
    let proves = v["proves"].as_str().unwrap();
    assert!(
        proves.contains("whoever produced this receipt knew this output's OCK, as does anyone holding an earlier receipt for it"),
        "{proves}"
    );
    assert!(!proves.contains("the issuer knew"), "{proves}");
}
