//! Key-id claim vectors for the issuer binding (spec §7), shared by every implementation of the rule:
//! `cargo run -p zeceipt-types --example gen_binding_vectors > spec/test-vectors/binding-claims-v0.json`
//! The Rust tests and the console's tests both check their parser against this file.
use serde_json::json;
use zeceipt_types::binding::claim;

fn main() {
    let cases = [
        ("2026-09@pay.example.org", "a claim"),
        (
            "k.1_a-b@sub.pay.example.org",
            "label characters; a subdomain",
        ),
        (
            "2026-09@xn--bcher-kva.example",
            "an internationalised name as its A-label",
        ),
        ("2026-09", "no @: a plain key id, no claim"),
        ("@example.org", "empty label"),
        ("a@b@example.org", "two @"),
        ("a b@example.org", "a space in the label"),
        ("a@Example.org", "an uppercase domain"),
        ("a@localhost", "one label"),
        ("a@example.org:443", "a port"),
        ("a@127.0.0.1", "an IP literal"),
        ("a@-bad.example.org", "a label starting with -"),
        ("a@bad-.example.org", "a label ending with -"),
        ("a@exa_mple.org", "an underscore in the domain"),
        ("a@example..org", "an empty domain label"),
        ("a@example.org.", "a trailing dot"),
        (
            "a@p\u{0430}y.example.org",
            "a Cyrillic а: a lookalike of pay.example.org",
        ),
        (
            "a@b\u{00fc}cher.example",
            "Unicode: only the xn-- form claims",
        ),
    ];
    let mut out: Vec<_> = cases
        .iter()
        .map(|(k, why)| json!({ "key_id": k, "why": why, "claim": claim(k).map(|c| json!({"label": c.label, "domain": c.domain, "url": c.url()})) }))
        .collect();
    let long_label = format!("{}@example.org", "x".repeat(65));
    out.push(json!({ "key_id": long_label, "why": "a 65-character label", "claim": claim(&long_label).map(|c| json!({"label": c.label, "domain": c.domain, "url": c.url()})) }));
    for (n, why) in [
        (63, "a 63-character domain label (the limit)"),
        (64, "a 64-character domain label"),
    ] {
        let key_id = format!("a@{}.example", "x".repeat(n));
        out.push(json!({ "key_id": key_id, "why": why, "claim": claim(&key_id).map(|c| json!({"label": c.label, "domain": c.domain, "url": c.url()})) }));
    }
    for (d, why) in [
        (53, "a 253-character domain (the limit)"),
        (54, "a 254-character domain"),
    ] {
        let key_id = format!(
            "a@{}.example",
            [
                "a".repeat(63),
                "b".repeat(63),
                "c".repeat(63),
                "d".repeat(d)
            ]
            .join(".")
        );
        assert_eq!(key_id.len() - 2, 200 + d, "{why}");
        out.push(json!({ "key_id": key_id, "why": why, "claim": claim(&key_id).map(|c| json!({"label": c.label, "domain": c.domain, "url": c.url()})) }));
    }
    println!(
        "{}",
        serde_json::to_string_pretty(&json!({
            "format": "zeceipt-v0 issuer key-id claims (spec §7)",
            "note": "claim is null when the key id claims no domain; such a key id is never looked up",
            "cases": out,
        }))
        .unwrap()
    );
}
