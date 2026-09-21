//! Zeceipt receipt envelope v0.
//!
//! A receipt discloses exactly one shielded output of one Zcash transaction by
//! revealing that output's Outgoing Cipher Key (OCK). This crate defines the
//! envelope format, its canonical signing bytes, the shareable URL form, and
//! ed25519 issuer signatures. It has no Zcash cryptography and no network I/O.
//!
//! Format reference: `spec/receipt-v0.md`.

#![forbid(unsafe_code)]

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};

/// Format identifier. Also the domain prefix of the canonical signing string.
pub const VERSION: &str = "zeceipt-v0";

/// Errors produced while encoding, decoding or checking envelopes.
#[derive(Debug, thiserror::Error)]
pub enum TypesError {
    #[error("unsupported receipt version {0:?}")]
    UnsupportedVersion(String),
    #[error("field {0} is not valid base64url")]
    Base64(&'static str),
    #[error("field {field} has wrong length: expected {expected}, got {got}")]
    Length {
        field: &'static str,
        expected: usize,
        got: usize,
    },
    #[error("field {0} is not valid hex")]
    Hex(&'static str),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    #[error("URL does not contain a receipt payload")]
    Url,
    #[error("issuer public key is invalid")]
    PublicKey,
    #[error("signature is invalid")]
    SignatureInvalid,
    #[error("receipt is unsigned")]
    Unsigned,
    #[error("challenge mismatch")]
    ChallengeMismatch,
}

/// Which shielded pool the disclosed output lives in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Pool {
    Ironwood,
    Orchard,
    Sapling,
}

impl Pool {
    pub fn as_str(&self) -> &'static str {
        match self {
            Pool::Ironwood => "ironwood",
            Pool::Orchard => "orchard",
            Pool::Sapling => "sapling",
        }
    }
}

/// Zcash network the transaction was mined on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Network {
    Main,
    Test,
}

/// The receipt envelope. Field names are part of the wire format.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Receipt {
    /// Always [`VERSION`].
    pub version: String,
    pub network: Network,
    pub pool: Pool,
    /// Transaction id in display (explorer) byte order, lower-case hex.
    pub txid: String,
    /// Index of the output inside the pool's bundle (0-based).
    pub output_index: u32,
    /// Per-output Outgoing Cipher Key, 32 bytes, base64url without padding.
    pub ock: String,
    /// Human-readable label chosen by the issuer (invoice id, USD amount, date…).
    #[serde(default)]
    pub label: String,
    /// Optional verifier-supplied challenge (ZIP 311 `msg`), base64url.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub challenge: Option<String>,
    /// Optional key identifier published in the issuer's well-known file.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub issuer_key_id: Option<String>,
    /// Issuer ed25519 public key, 32 bytes hex.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub issuer_pubkey: Option<String>,
    /// ed25519 signature over [`Receipt::canonical_bytes`], 64 bytes hex.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub signature: Option<String>,
    /// Optional ZIP 311 profile marker for future alignment; ignored by v0 verifiers.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub zip311_profile: Option<String>,
}

impl Receipt {
    /// Build an unsigned receipt.
    pub fn new(
        network: Network,
        pool: Pool,
        txid: [u8; 32],
        output_index: u32,
        ock: [u8; 32],
        label: impl Into<String>,
    ) -> Self {
        Receipt {
            version: VERSION.to_string(),
            network,
            pool,
            txid: hex::encode(txid),
            output_index,
            ock: URL_SAFE_NO_PAD.encode(ock),
            label: label.into(),
            challenge: None,
            issuer_key_id: None,
            issuer_pubkey: None,
            signature: None,
            zip311_profile: Some("outputs-only".to_string()),
        }
    }

    /// Attach a verifier-supplied challenge (opaque bytes).
    pub fn with_challenge(mut self, challenge: &[u8]) -> Self {
        self.challenge = Some(URL_SAFE_NO_PAD.encode(challenge));
        self
    }

    pub fn with_key_id(mut self, key_id: impl Into<String>) -> Self {
        self.issuer_key_id = Some(key_id.into());
        self
    }

    /// Decode the txid field into display-order bytes.
    pub fn txid_bytes(&self) -> Result<[u8; 32], TypesError> {
        let v = hex::decode(&self.txid).map_err(|_| TypesError::Hex("txid"))?;
        fixed::<32>("txid", &v)
    }

    pub fn ock_bytes(&self) -> Result<[u8; 32], TypesError> {
        let v = URL_SAFE_NO_PAD
            .decode(&self.ock)
            .map_err(|_| TypesError::Base64("ock"))?;
        fixed::<32>("ock", &v)
    }

    pub fn challenge_bytes(&self) -> Result<Vec<u8>, TypesError> {
        match &self.challenge {
            None => Ok(Vec::new()),
            Some(c) => URL_SAFE_NO_PAD
                .decode(c)
                .map_err(|_| TypesError::Base64("challenge")),
        }
    }

    /// Canonical byte string that the issuer signs:
    /// `b"zeceipt-v0" || network(1) || pool(1) || txid(32) || output_index u32 LE || ock(32) ||
    ///  len(label) u32 LE || label || len(challenge) u32 LE || challenge ||
    ///  len(issuer_key_id) u32 LE || issuer_key_id`.
    /// `network`: 0x00 main, 0x01 test. `pool`: 0x00 ironwood, 0x01 orchard, 0x02 sapling.
    pub fn canonical_bytes(&self) -> Result<Vec<u8>, TypesError> {
        if self.version != VERSION {
            return Err(TypesError::UnsupportedVersion(self.version.clone()));
        }
        let mut out = Vec::with_capacity(160 + self.label.len());
        out.extend_from_slice(VERSION.as_bytes());
        out.push(match self.network {
            Network::Main => 0x00,
            Network::Test => 0x01,
        });
        out.push(match self.pool {
            Pool::Ironwood => 0x00,
            Pool::Orchard => 0x01,
            Pool::Sapling => 0x02,
        });
        out.extend_from_slice(&self.txid_bytes()?);
        out.extend_from_slice(&self.output_index.to_le_bytes());
        out.extend_from_slice(&self.ock_bytes()?);
        let label = self.label.as_bytes();
        out.extend_from_slice(&(label.len() as u32).to_le_bytes());
        out.extend_from_slice(label);
        let challenge = self.challenge_bytes()?;
        out.extend_from_slice(&(challenge.len() as u32).to_le_bytes());
        out.extend_from_slice(&challenge);
        let key_id = self.issuer_key_id.as_deref().unwrap_or("").as_bytes();
        out.extend_from_slice(&(key_id.len() as u32).to_le_bytes());
        out.extend_from_slice(key_id);
        Ok(out)
    }

    /// Sign the receipt with the issuer's key; fills `issuer_pubkey` and `signature`.
    pub fn sign(mut self, key: &SigningKey) -> Result<Self, TypesError> {
        let msg = self.canonical_bytes()?;
        let sig = key.sign(&msg);
        self.issuer_pubkey = Some(hex::encode(key.verifying_key().to_bytes()));
        self.signature = Some(hex::encode(sig.to_bytes()));
        Ok(self)
    }

    /// Verify the issuer signature using the inline public key.
    ///
    /// This proves "signed by the holder of `issuer_pubkey`" and nothing more;
    /// binding that key to an organisation is a separate, optional step.
    pub fn verify_signature(&self) -> Result<VerifyingKey, TypesError> {
        let pk_hex = self.issuer_pubkey.as_ref().ok_or(TypesError::Unsigned)?;
        let sig_hex = self.signature.as_ref().ok_or(TypesError::Unsigned)?;
        let pk = hex::decode(pk_hex).map_err(|_| TypesError::Hex("issuer_pubkey"))?;
        let pk = VerifyingKey::from_bytes(&fixed::<32>("issuer_pubkey", &pk)?)
            .map_err(|_| TypesError::PublicKey)?;
        let sig = hex::decode(sig_hex).map_err(|_| TypesError::Hex("signature"))?;
        let sig = Signature::from_bytes(&fixed::<64>("signature", &sig)?);
        pk.verify(&self.canonical_bytes()?, &sig)
            .map_err(|_| TypesError::SignatureInvalid)?;
        Ok(pk)
    }

    /// Check that the verifier-supplied challenge matches the one bound into the receipt.
    /// A receipt without a challenge accepts only an empty expected challenge.
    pub fn check_challenge(&self, expected: &[u8]) -> Result<(), TypesError> {
        if self.challenge_bytes()? == expected {
            Ok(())
        } else {
            Err(TypesError::ChallengeMismatch)
        }
    }

    pub fn to_json(&self) -> Result<String, TypesError> {
        Ok(serde_json::to_string(self)?)
    }

    pub fn from_json(s: &str) -> Result<Self, TypesError> {
        let r: Receipt = serde_json::from_str(s)?;
        if r.version != VERSION {
            return Err(TypesError::UnsupportedVersion(r.version));
        }
        Ok(r)
    }

    /// Shareable URL: `<host>/r/<base64url(json)>`.
    pub fn to_url(&self, host: &str) -> Result<String, TypesError> {
        let json = self.to_json()?;
        Ok(format!(
            "{}/r/{}",
            host.trim_end_matches('/'),
            URL_SAFE_NO_PAD.encode(json.as_bytes())
        ))
    }

    /// Parse a receipt from a URL, a bare base64url payload, or raw JSON.
    pub fn parse(input: &str) -> Result<Self, TypesError> {
        let s = input.trim();
        if s.starts_with('{') {
            return Self::from_json(s);
        }
        let payload = match s.rfind("/r/") {
            Some(i) => &s[i + 3..],
            None => s,
        };
        let payload = payload.split(['?', '#']).next().unwrap_or(payload);
        let bytes = URL_SAFE_NO_PAD
            .decode(payload)
            .map_err(|_| TypesError::Url)?;
        let json = String::from_utf8(bytes).map_err(|_| TypesError::Url)?;
        Self::from_json(&json)
    }
}

/// A set of receipts plus the issuer's declared total.
///
/// Verifying an audit pack proves a *lower bound*: the sum of recovered values is
/// at least what the receipts show. It cannot prove that no other payments exist.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AuditPack {
    pub version: String,
    pub title: String,
    /// Declared total in zatoshi (informational; verifiers recompute).
    pub declared_total_zat: u64,
    pub receipts: Vec<Receipt>,
}

impl AuditPack {
    pub fn new(title: impl Into<String>, receipts: Vec<Receipt>, declared_total_zat: u64) -> Self {
        AuditPack {
            version: VERSION.to_string(),
            title: title.into(),
            declared_total_zat,
            receipts,
        }
    }

    pub fn to_json(&self) -> Result<String, TypesError> {
        Ok(serde_json::to_string_pretty(self)?)
    }

    pub fn from_json(s: &str) -> Result<Self, TypesError> {
        let p: AuditPack = serde_json::from_str(s)?;
        if p.version != VERSION {
            return Err(TypesError::UnsupportedVersion(p.version));
        }
        Ok(p)
    }
}

/// Generate a fresh issuer signing key from a cryptographic RNG.
pub fn generate_signing_key<R: rand_core::CryptoRngCore>(rng: &mut R) -> SigningKey {
    SigningKey::generate(rng)
}

/// Re-export of the signature crate so callers can construct keys without a separate dependency.
pub use ed25519_dalek;

fn fixed<const N: usize>(field: &'static str, v: &[u8]) -> Result<[u8; N], TypesError> {
    v.try_into().map_err(|_| TypesError::Length {
        field,
        expected: N,
        got: v.len(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::rngs::OsRng;

    fn sample() -> Receipt {
        Receipt::new(
            Network::Main,
            Pool::Ironwood,
            [0x11; 32],
            2,
            [0x22; 32],
            "INV-2026-0142",
        )
    }

    #[test]
    fn json_round_trip() {
        let r = sample();
        let j = r.to_json().unwrap();
        let back = Receipt::from_json(&j).unwrap();
        assert_eq!(r, back);
    }

    #[test]
    fn url_round_trip_and_bare_payload() {
        let r = sample();
        let url = r.to_url("https://zeceipt.xyz/").unwrap();
        assert!(url.starts_with("https://zeceipt.xyz/r/"));
        assert_eq!(Receipt::parse(&url).unwrap(), r);
        let payload = url.rsplit("/r/").next().unwrap();
        assert_eq!(Receipt::parse(payload).unwrap(), r);
        assert_eq!(Receipt::parse(&r.to_json().unwrap()).unwrap(), r);
    }

    #[test]
    fn sign_and_verify() {
        let key = SigningKey::generate(&mut OsRng);
        let r = sample().with_challenge(b"nonce-42").sign(&key).unwrap();
        let pk = r.verify_signature().unwrap();
        assert_eq!(pk, key.verifying_key());
        r.check_challenge(b"nonce-42").unwrap();
        assert!(matches!(
            r.check_challenge(b"other").unwrap_err(),
            TypesError::ChallengeMismatch
        ));
    }

    #[test]
    fn tamper_each_field_breaks_signature() {
        let key = SigningKey::generate(&mut OsRng);
        let good = sample().with_challenge(b"c").sign(&key).unwrap();
        assert!(good.verify_signature().is_ok());

        let mut t = good.clone();
        t.output_index += 1;
        assert!(t.verify_signature().is_err(), "index");

        let mut t = good.clone();
        let mut ock = t.ock_bytes().unwrap();
        ock[0] ^= 1;
        t.ock = URL_SAFE_NO_PAD.encode(ock);
        assert!(t.verify_signature().is_err(), "ock");

        let mut t = good.clone();
        let mut txid = t.txid_bytes().unwrap();
        txid[31] ^= 1;
        t.txid = hex::encode(txid);
        assert!(t.verify_signature().is_err(), "txid");

        let mut t = good.clone();
        t.label.push('x');
        assert!(t.verify_signature().is_err(), "label");

        let mut t = good.clone();
        t.challenge = Some(URL_SAFE_NO_PAD.encode(b"d"));
        assert!(t.verify_signature().is_err(), "challenge");

        let mut t = good.clone();
        t.signature = Some(hex::encode([0u8; 64]));
        assert!(t.verify_signature().is_err(), "signature");

        let mut t = good.clone();
        t.network = Network::Test;
        assert!(t.verify_signature().is_err(), "network");

        let mut t = good.clone();
        t.pool = Pool::Orchard;
        assert!(t.verify_signature().is_err(), "pool");

        let mut t = good.clone();
        t.issuer_key_id = Some("other".into());
        assert!(t.verify_signature().is_err(), "issuer_key_id");
    }

    /// Committed test vectors (`spec/test-vectors/receipt-v0.json`) pin the
    /// canonical byte encoding and signature for third-party implementations.
    #[test]
    fn committed_test_vectors_match() {
        let raw = include_str!("../../../spec/test-vectors/receipt-v0.json");
        let vectors: serde_json::Value = serde_json::from_str(raw).unwrap();
        let key = SigningKey::from_bytes(&[7u8; 32]);
        assert_eq!(
            vectors["signing_key_hex"].as_str().unwrap(),
            hex::encode(key.to_bytes())
        );
        for v in vectors["vectors"].as_array().unwrap() {
            let r = Receipt::from_json(&v["receipt"].to_string()).unwrap();
            assert_eq!(
                hex::encode(r.canonical_bytes().unwrap()),
                v["canonical_bytes_hex"].as_str().unwrap(),
                "{}",
                v["name"]
            );
            let signed = r.clone().sign(&key).unwrap();
            assert_eq!(
                signed.signature.as_deref().unwrap(),
                v["signature_hex"].as_str().unwrap(),
                "{}",
                v["name"]
            );
            assert!(signed.verify_signature().is_ok());
            let expect_ok = v["verifies"].as_bool().unwrap();
            let given: Receipt = serde_json::from_str(&v["signed_receipt"].to_string()).unwrap();
            assert_eq!(given.verify_signature().is_ok(), expect_ok, "{}", v["name"]);
        }
    }

    #[test]
    fn unsigned_is_reported_not_panicked() {
        assert!(matches!(
            sample().verify_signature().unwrap_err(),
            TypesError::Unsigned
        ));
    }

    #[test]
    fn wrong_version_rejected() {
        let mut r = sample();
        r.version = "zeceipt-v9".into();
        assert!(r.canonical_bytes().is_err());
        let j = r.to_json().unwrap();
        assert!(Receipt::from_json(&j).is_err());
    }

    #[test]
    fn audit_pack_round_trip() {
        let p = AuditPack::new("Q3 bounties", vec![sample(), sample()], 123);
        let j = p.to_json().unwrap();
        assert_eq!(AuditPack::from_json(&j).unwrap(), p);
    }
}
