//! Issuer key binding (spec §7): the domain a receipt claims in its signed key id (`<label>@<domain>`), the
//! well-known file that domain serves (`https://<domain>/.well-known/zeceipt.json`), and the outcome of comparing the
//! two. Control of the domain is the binding (NIP-05, did:web). Pure: fetching the file is the caller's (the CLI,
//! the receipt page), so every verifier evaluates it the same way. An outcome never changes whether a receipt is
//! valid: it is confirmed, not listed, or unknown.

use serde::{Deserialize, Serialize};

use crate::Receipt;

/// Where a domain serves its keys.
pub const WELL_KNOWN_PATH: &str = "/.well-known/zeceipt.json";
/// Files larger than this are not read (spec §7).
pub const MAX_FILE_BYTES: usize = 64 * 1024;
/// The only file version this crate reads.
pub const FILE_VERSION: &str = "zeceipt-v0";

/// A domain claimed by a key id of the form `<label>@<domain>`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Claim {
    pub label: String,
    pub domain: String,
}

impl Claim {
    /// The file's URL: HTTPS on the default port.
    pub fn url(&self) -> String {
        format!("https://{}{}", self.domain, WELL_KNOWN_PATH)
    }
}

/// The claim a key id makes, if it makes one: exactly one `@`, a label of 1–64 `A-Z a-z 0-9 . _ -`, and a lowercase
/// DNS name with at least one dot, no port and no IP literal (its last label is not all digits).
pub fn claim(key_id: &str) -> Option<Claim> {
    let (label, domain) = key_id.split_once('@')?;
    if domain.contains('@') || label.is_empty() || label.len() > 64 {
        return None;
    }
    if !label
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
    {
        return None;
    }
    if domain.len() > 253 {
        return None;
    }
    let labels: Vec<&str> = domain.split('.').collect();
    if labels.len() < 2 {
        return None;
    }
    for l in &labels {
        let ok_chars = l
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-');
        if l.is_empty() || l.len() > 63 || !ok_chars || l.starts_with('-') || l.ends_with('-') {
            return None;
        }
    }
    if labels
        .last()
        .is_some_and(|tld| tld.bytes().all(|b| b.is_ascii_digit()))
    {
        return None; // an IPv4 literal, or a numeric TLD
    }
    Some(Claim {
        label: label.to_string(),
        domain: domain.to_string(),
    })
}

/// The well-known file (spec §7).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WellKnownFile {
    pub version: String,
    pub keys: Vec<WellKnownKey>,
}

/// One key a domain vouches for.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WellKnownKey {
    pub key_id: String,
    /// ed25519 public key, 64 hex characters.
    pub pubkey: String,
    /// Free text, shown as text (for example "retired 2026-12; receipts before stay ours").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

impl WellKnownFile {
    pub fn new() -> Self {
        WellKnownFile {
            version: FILE_VERSION.to_string(),
            keys: Vec::new(),
        }
    }

    /// Add a key, replacing an entry with the same key id. The key id must claim a domain, and every entry of a file
    /// must claim the same one (a file vouches for its own domain only).
    pub fn put(&mut self, key: WellKnownKey) -> Result<(), BindingError> {
        let c = claim(&key.key_id).ok_or(BindingError::KeyIdClaimsNoDomain)?;
        if let Some(other) = self
            .keys
            .iter()
            .filter_map(|k| claim(&k.key_id))
            .find(|o| o.domain != c.domain)
        {
            return Err(BindingError::MixedDomains {
                file: other.domain,
                key: c.domain,
            });
        }
        if key.pubkey.len() != 64 || hex::decode(&key.pubkey).is_err() {
            return Err(BindingError::BadPubkey);
        }
        let key = WellKnownKey {
            pubkey: key.pubkey.to_ascii_lowercase(),
            ..key
        };
        match self.keys.iter_mut().find(|k| k.key_id == key.key_id) {
            Some(slot) => *slot = key,
            None => self.keys.push(key),
        }
        Ok(())
    }
}

impl Default for WellKnownFile {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum BindingError {
    #[error("the key id must be <label>@<domain> to claim a domain (spec §7)")]
    KeyIdClaimsNoDomain,
    #[error(
        "a well-known file vouches for its own domain only: it has keys for {file}, not {key}"
    )]
    MixedDomains { file: String, key: String },
    #[error("the public key must be 64 hex characters (ed25519)")]
    BadPubkey,
}

/// The outcome of a lookup (spec §7). None of the three affects whether the receipt is valid.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum Binding {
    /// The domain lists this key id with this public key: it vouches for the key now.
    Confirmed { domain: String },
    /// The domain answered with a valid file that does not list this key id with this public key.
    NotListed { domain: String },
    /// No conclusion; `reason` says why.
    Unknown { reason: String },
}

fn unknown(reason: &str) -> Binding {
    Binding::Unknown {
        reason: reason.to_string(),
    }
}

/// What a receipt's signed key id claims, if the receipt is signed and its signature verifies: without both, no lookup
/// is worth making (an unsigned or forged receipt claims nothing).
pub fn receipt_claim(receipt: &Receipt) -> Result<Claim, Binding> {
    if receipt.signature.is_none() || receipt.issuer_pubkey.is_none() {
        return Err(unknown("the receipt is unsigned"));
    }
    if receipt.verify_signature().is_err() {
        return Err(unknown("the receipt's signature does not verify"));
    }
    let key_id = receipt.issuer_key_id.as_deref().unwrap_or("");
    claim(key_id).ok_or_else(|| unknown("the key id claims no domain (it is not <label>@<domain>)"))
}

/// Compare a receipt with the file its claimed domain served (`body`, as fetched). The caller fetched the claim's URL
/// following the lookup rules (HTTPS, no redirects, at most `MAX_FILE_BYTES`, 10 s) and passes what it got; any
/// failure before this point is the caller's `Unknown`.
pub fn evaluate(receipt: &Receipt, body: &[u8]) -> Binding {
    let c = match receipt_claim(receipt) {
        Ok(c) => c,
        Err(b) => return b,
    };
    if body.len() > MAX_FILE_BYTES {
        return unknown("the file is larger than 64 KiB");
    }
    let file: WellKnownFile = match serde_json::from_slice(body) {
        Ok(f) => f,
        Err(_) => return unknown("the file is not a valid zeceipt.json"),
    };
    if file.version != FILE_VERSION {
        return unknown("the file's version is not zeceipt-v0");
    }
    let key_id = receipt.issuer_key_id.as_deref().unwrap_or("");
    let pubkey = receipt.issuer_pubkey.as_deref().unwrap_or("");
    let listed = file.keys.iter().any(|k| {
        // A file vouches for its own domain only: entries claiming another domain are ignored.
        claim(&k.key_id).is_some_and(|kc| kc.domain == c.domain)
            && k.key_id == key_id
            && k.pubkey.eq_ignore_ascii_case(pubkey)
    });
    if listed {
        Binding::Confirmed { domain: c.domain }
    } else {
        Binding::NotListed { domain: c.domain }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Network, Pool, Receipt};
    use ed25519_dalek::SigningKey;

    fn key(n: u8) -> SigningKey {
        SigningKey::from_bytes(&[n; 32])
    }
    fn signed(key_id: &str, k: &SigningKey) -> Receipt {
        let mut r = Receipt::new(Network::Main, Pool::Ironwood, [1; 32], 0, [2; 32], "label");
        r.issuer_key_id = Some(key_id.to_string());
        r.sign(k).unwrap()
    }
    fn file(entries: &[(&str, &SigningKey)]) -> Vec<u8> {
        let f = WellKnownFile {
            version: FILE_VERSION.into(),
            keys: entries
                .iter()
                .map(|(id, k)| WellKnownKey {
                    key_id: id.to_string(),
                    pubkey: hex::encode(k.verifying_key().to_bytes()),
                    note: None,
                })
                .collect(),
        };
        serde_json::to_vec(&f).unwrap()
    }

    #[test]
    fn claims() {
        assert_eq!(
            claim("2026-09@pay.example.org"),
            Some(Claim {
                label: "2026-09".into(),
                domain: "pay.example.org".into()
            })
        );
        assert_eq!(
            claim("2026-09@pay.example.org").unwrap().url(),
            "https://pay.example.org/.well-known/zeceipt.json"
        );
        for bad in [
            "2026-09",                  // no claim
            "@example.org",             // empty label
            "a@b@example.org",          // two @
            "a b@example.org",          // label character
            "a@Example.org",            // uppercase domain
            "a@localhost",              // one label
            "a@example.org:443",        // port
            "a@127.0.0.1",              // IP literal
            "a@-bad.example.org",       // label starts with -
            "a@exa_mple.org",           // underscore in a domain
            "a@example..org",           // empty label
            "a@example.org.",           // trailing dot
            "a@p\u{0430}y.example.org", // a Cyrillic "а": a lookalike of pay.example.org (review W1 round 1)
            "a@b\u{00fc}cher.example",  // Unicode: only the xn-- A-label form claims a domain
        ] {
            assert_eq!(claim(bad), None, "{bad}");
        }
        // The A-label of bücher.example, kept and looked up exactly as written.
        assert_eq!(
            claim("2026-09@xn--bcher-kva.example").map(|c| c.url()),
            Some("https://xn--bcher-kva.example/.well-known/zeceipt.json".to_string())
        );
        assert_eq!(
            claim(&format!("{}@example.org", "x".repeat(65))),
            None,
            "label too long"
        );
    }

    #[test]
    fn outcomes() {
        let (k, other) = (key(7), key(8));
        let r = signed("2026-09@pay.example.org", &k);
        assert_eq!(
            evaluate(&r, &file(&[("2026-09@pay.example.org", &k)])),
            Binding::Confirmed {
                domain: "pay.example.org".into()
            }
        );
        // Not listed: another public key under the same id, another id, or an empty file.
        for f in [
            file(&[("2026-09@pay.example.org", &other)]),
            file(&[("2026-10@pay.example.org", &k)]),
            file(&[]),
        ] {
            assert_eq!(
                evaluate(&r, &f),
                Binding::NotListed {
                    domain: "pay.example.org".into()
                }
            );
        }
        // A file vouches for its own domain only: an entry claiming another domain is ignored.
        let foreign = signed("2026-09@evil.example.net", &k);
        assert_eq!(
            evaluate(&foreign, &file(&[("2026-09@pay.example.org", &k)])),
            Binding::NotListed {
                domain: "evil.example.net".into()
            }
        );
        // Unknown: nothing to compare.
        assert!(matches!(evaluate(&r, b"not json"), Binding::Unknown { .. }));
        assert!(matches!(
            evaluate(&r, br#"{"version":"zeceipt-v1","keys":[]}"#),
            Binding::Unknown { .. }
        ));
        assert!(matches!(
            evaluate(&r, &vec![b' '; MAX_FILE_BYTES + 1]),
            Binding::Unknown { .. }
        ));
        assert!(
            matches!(
                evaluate(&signed("2026-09", &k), &file(&[])),
                Binding::Unknown { .. }
            ),
            "no claim"
        );
        let mut unsigned = r.clone();
        unsigned.signature = None;
        assert!(matches!(
            evaluate(&unsigned, &file(&[("2026-09@pay.example.org", &k)])),
            Binding::Unknown { .. }
        ));
        let mut forged = r.clone();
        forged.label = "altered".into();
        assert!(
            matches!(
                evaluate(&forged, &file(&[("2026-09@pay.example.org", &k)])),
                Binding::Unknown { .. }
            ),
            "a signature that does not verify claims nothing"
        );
        // An uppercase public key in the file still matches.
        let upper = format!(
            r#"{{"version":"zeceipt-v0","keys":[{{"key_id":"2026-09@pay.example.org","pubkey":"{}"}}]}}"#,
            hex::encode(k.verifying_key().to_bytes()).to_uppercase()
        );
        assert!(matches!(
            evaluate(&r, upper.as_bytes()),
            Binding::Confirmed { .. }
        ));
    }

    #[test]
    fn building_a_file() {
        let (k, k2) = (key(7), key(9));
        let mut f = WellKnownFile::new();
        let pk = |k: &SigningKey| hex::encode(k.verifying_key().to_bytes());
        f.put(WellKnownKey {
            key_id: "2026-09@pay.example.org".into(),
            pubkey: pk(&k),
            note: None,
        })
        .unwrap();
        f.put(WellKnownKey {
            key_id: "2026-10@pay.example.org".into(),
            pubkey: pk(&k2).to_uppercase(),
            note: Some("current".into()),
        })
        .unwrap();
        f.put(WellKnownKey {
            key_id: "2026-09@pay.example.org".into(),
            pubkey: pk(&k),
            note: Some("retired".into()),
        })
        .unwrap();
        assert_eq!(f.keys.len(), 2, "same key id replaced");
        assert_eq!(f.keys[0].note.as_deref(), Some("retired"));
        assert_eq!(f.keys[1].pubkey, pk(&k2), "stored lowercase");
        assert_eq!(
            f.put(WellKnownKey {
                key_id: "x@other.example.org".into(),
                pubkey: pk(&k),
                note: None
            }),
            Err(BindingError::MixedDomains {
                file: "pay.example.org".into(),
                key: "other.example.org".into()
            })
        );
        assert_eq!(
            f.put(WellKnownKey {
                key_id: "2026-11".into(),
                pubkey: pk(&k),
                note: None
            }),
            Err(BindingError::KeyIdClaimsNoDomain)
        );
        assert_eq!(
            f.put(WellKnownKey {
                key_id: "2026-11@pay.example.org".into(),
                pubkey: "zz".into(),
                note: None
            }),
            Err(BindingError::BadPubkey)
        );
        // What `put` builds, `evaluate` confirms.
        let r = signed("2026-10@pay.example.org", &k2);
        assert!(matches!(
            evaluate(&r, &serde_json::to_vec(&f).unwrap()),
            Binding::Confirmed { .. }
        ));
    }
}

#[cfg(test)]
mod vectors {
    /// The committed claim vectors (spec/test-vectors/binding-claims-v0.json) are exactly what `claim` decides; the
    /// console checks its own validator against the same file, so the rule has one definition.
    #[test]
    fn committed_claim_vectors_match() {
        let v: serde_json::Value = serde_json::from_str(include_str!(
            "../../../spec/test-vectors/binding-claims-v0.json"
        ))
        .unwrap();
        let cases = v["cases"].as_array().unwrap();
        assert!(cases.len() >= 20);
        for c in cases {
            let key_id = c["key_id"].as_str().unwrap();
            let got = super::claim(key_id)
                .map(|c| serde_json::json!({"label": c.label, "domain": c.domain, "url": c.url()}));
            assert_eq!(
                got.unwrap_or(serde_json::Value::Null),
                c["claim"],
                "{key_id}"
            );
        }
    }
}
