//! Source-of-funds dossiers, format `zeceipt-dossier-v1` (`spec/dossier-v1.md`).
//!
//! A dossier is what a holder of shielded ZEC hands a reviewer (an exchange's compliance team, an OTC desk, a lender)
//! instead of a viewing key: a set of notes, each opened by a `zdp:1:` note opening, sender receipts for payments the
//! holder made, optionally the nullifier-deriving key `nk`, and claims about those funds: where they entered the
//! holder's wallet, how they moved on, that a deposit was paid from them, and that the holder can spend them now.
//!
//! There is deliberately no "unspent at height H" claim: without a zero-knowledge proof nothing binds a disclosed
//! `nk` to a note's owner until one of that note's nullifiers appears on chain, so a wrong `nk` (or someone else's note
//! whose opening its sender knows) would read as unspent forever. Every claim here that uses `nk` instead tests a
//! nullifier that is on chain, which a wrong `nk` cannot produce; the holder shows current funds by spending them
//! (`Control`). `zeceipt_core::dossier` checks every claim against chain data. This
//! module only defines and parses the document: it has no Zcash cryptography.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::delivery::DeliveryProof;
use crate::{Network, Receipt, TypesError};

/// Format identifier.
pub const DOSSIER_VERSION: &str = "zeceipt-dossier-v1";

/// A source-of-funds dossier.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Dossier {
    pub version: String,
    pub network: Network,
    /// When the holder built it (RFC 3339, UTC); informational.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created: Option<String>,
    /// Free text from the holder (a name, a case number); unauthenticated.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subject: Option<String>,
    /// The nullifier-deriving key of the holder's Orchard-family account, 32 bytes hex. Needed by `path`, `deposit`
    /// with `funded_by`, and `control`; it lets the reviewer compute the nullifiers of the disclosed notes (and of any
    /// other note of this account whose opening they learn), not decrypt anything.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nk: Option<String>,
    /// The disclosed notes, by id: each a `zdp:1:` opening (txid, pool, action, receiver, value, rseed).
    pub notes: BTreeMap<String, String>,
    /// Sender receipts (`zeceipt-v0`) for payments the holder made, by id.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub receipts: BTreeMap<String, Receipt>,
    pub claims: Vec<Claim>,
}

/// One claim about the disclosed funds.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase", deny_unknown_fields)]
pub enum Claim {
    /// The note's transaction is where these funds entered the holder's wallet: what funded it (transparent inputs,
    /// shielded spends) is reported from the transaction itself.
    Origin { note: String },
    /// Funds moved on: `from` is spent in the transaction that created `to`.
    Path { from: String, to: String },
    /// A payment the holder made (the receipt's output), paid from the listed notes (spent in its transaction).
    Deposit {
        receipt: String,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        funded_by: Vec<String>,
    },
    /// Control and current funds: `reply` is a note whose memo carries the reviewer's `nonce`, created by a transaction
    /// that spends `spent`. Only the holder of the spending key can make that transaction, and only after the nonce was
    /// issued, so the holder controlled at least the spent notes' value then.
    Control {
        nonce: String,
        reply: String,
        spent: Vec<String>,
    },
}

impl Claim {
    pub fn kind(&self) -> &'static str {
        match self {
            Claim::Origin { .. } => "origin",
            Claim::Path { .. } => "path",
            Claim::Deposit { .. } => "deposit",
            Claim::Control { .. } => "control",
        }
    }

    /// Note ids this claim names.
    pub fn notes(&self) -> Vec<&str> {
        match self {
            Claim::Origin { note } => vec![note],
            Claim::Path { from, to } => vec![from, to],
            Claim::Deposit { funded_by, .. } => funded_by.iter().map(String::as_str).collect(),
            Claim::Control { reply, spent, .. } => {
                let mut v: Vec<&str> = spent.iter().map(String::as_str).collect();
                v.push(reply);
                v
            }
        }
    }

    /// Whether checking this claim needs `nk` (every claim that tests a nullifier).
    pub fn needs_nk(&self) -> bool {
        match self {
            Claim::Origin { .. } => false,
            Claim::Deposit { funded_by, .. } => !funded_by.is_empty(),
            _ => true,
        }
    }
}

impl Dossier {
    /// Parse and check the document's own consistency: version, every referenced note and receipt exists, every
    /// note is a well-formed `zdp:1:` opening, `nk` is 32 bytes hex and present when a claim needs it.
    pub fn parse(json: &str) -> Result<Self, TypesError> {
        let d: Dossier = serde_json::from_str(json.trim())?;
        d.validate()?;
        Ok(d)
    }

    pub fn validate(&self) -> Result<(), TypesError> {
        if self.version != DOSSIER_VERSION {
            return Err(TypesError::UnsupportedVersion(self.version.clone()));
        }
        for (id, text) in &self.notes {
            DeliveryProof::decode(text)
                .map_err(|e| TypesError::Dossier(format!("note {id}: {e}")))?;
        }
        if let Some(nk) = &self.nk {
            let b = hex::decode(nk.trim()).map_err(|_| TypesError::Hex("nk"))?;
            if b.len() != 32 {
                return Err(TypesError::Length {
                    field: "nk",
                    expected: 32,
                    got: b.len(),
                });
            }
        }
        // The same note under two ids would count its value twice (a control claim listing n4 and a copy of n4 would
        // prove twice the funds): every opening is disclosed once.
        let mut seen = std::collections::BTreeMap::new();
        for (id, text) in &self.notes {
            let p = DeliveryProof::decode(text).expect("checked above");
            if let Some(other) = seen.insert((p.txid, p.action, p.pool.as_str()), id) {
                return Err(TypesError::Dossier(format!(
                    "notes {other} and {id} open the same note"
                )));
            }
        }
        if self.claims.is_empty() {
            return Err(TypesError::Dossier(
                "a dossier makes at least one claim".into(),
            ));
        }
        for (i, c) in self.claims.iter().enumerate() {
            for n in c.notes() {
                if !self.notes.contains_key(n) {
                    return Err(TypesError::Dossier(format!(
                        "claim {i} ({}) names note {n:?}, which the dossier does not disclose",
                        c.kind()
                    )));
                }
            }
            if let Claim::Deposit { receipt, .. } = c {
                if !self.receipts.contains_key(receipt) {
                    return Err(TypesError::Dossier(format!("claim {i} (deposit) names receipt {receipt:?}, which the dossier does not include")));
                }
            }
            let listed: Vec<&str> = match c {
                Claim::Control { spent, .. } => spent.iter().map(String::as_str).collect(),
                Claim::Deposit { funded_by, .. } => funded_by.iter().map(String::as_str).collect(),
                _ => vec![],
            };
            if let Some(dup) = listed
                .iter()
                .enumerate()
                .find_map(|(k, n)| listed[..k].contains(n).then_some(n))
            {
                return Err(TypesError::Dossier(format!(
                    "claim {i} ({}) lists note {dup} twice",
                    c.kind()
                )));
            }
            if let Claim::Control { nonce, spent, .. } = c {
                if nonce.trim().len() < 8 {
                    return Err(TypesError::Dossier(format!(
                        "claim {i} (control): a nonce of at least 8 characters, from the reviewer"
                    )));
                }
                if spent.is_empty() {
                    return Err(TypesError::Dossier(format!(
                        "claim {i} (control) names no spent note"
                    )));
                }
            }
            if c.needs_nk() && self.nk.is_none() {
                return Err(TypesError::Dossier(format!(
                    "claim {i} ({}) needs nk, which the dossier does not include",
                    c.kind()
                )));
            }
        }
        for (id, r) in &self.receipts {
            if r.network != self.network {
                return Err(TypesError::Dossier(format!(
                    "receipt {id} is for another network than the dossier"
                )));
            }
        }
        Ok(())
    }

    /// The decoded note openings, by id.
    pub fn note_proofs(&self) -> Result<BTreeMap<String, DeliveryProof>, TypesError> {
        self.notes
            .iter()
            .map(|(id, t)| DeliveryProof::decode(t).map(|p| (id.clone(), p)))
            .collect()
    }

    /// The `nk` bytes, if the dossier carries it.
    pub fn nk_bytes(&self) -> Option<[u8; 32]> {
        let b = hex::decode(self.nk.as_ref()?.trim()).ok()?;
        b.try_into().ok()
    }

    pub fn to_json(&self) -> Result<String, TypesError> {
        Ok(serde_json::to_string_pretty(self)?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> String {
        let note = |action| {
            DeliveryProof {
                txid: [1; 32],
                pool: crate::Pool::Ironwood,
                action,
                receiver: [2; 43],
                value: 5,
                rseed: [3; 32],
            }
            .encode()
        };
        let (p, q) = (note(0), note(1));
        serde_json::json!({
            "version": DOSSIER_VERSION, "network": "test", "nk": "11".repeat(32),
            "notes": { "n1": p, "n2": q },
            "claims": [ { "type": "origin", "note": "n1" }, { "type": "path", "from": "n1", "to": "n2" },
                        { "type": "control", "nonce": "reviewer-nonce-1", "reply": "n2", "spent": ["n1"] } ]
        })
        .to_string()
    }

    #[test]
    fn a_dossier_parses_and_refuses_what_it_cannot_be() {
        let d = Dossier::parse(&sample()).unwrap();
        assert_eq!(d.claims.len(), 3);
        assert_eq!(Dossier::parse(&d.to_json().unwrap()).unwrap(), d);
        let mut v: serde_json::Value = serde_json::from_str(&sample()).unwrap();
        v["claims"][1]["to"] = "n9".into();
        assert!(
            matches!(Dossier::parse(&v.to_string()), Err(TypesError::Dossier(m)) if m.contains("n9"))
        );
        let mut v: serde_json::Value = serde_json::from_str(&sample()).unwrap();
        v.as_object_mut().unwrap().remove("nk");
        assert!(
            matches!(Dossier::parse(&v.to_string()), Err(TypesError::Dossier(m)) if m.contains("needs nk"))
        );
        let mut v: serde_json::Value = serde_json::from_str(&sample()).unwrap();
        v["version"] = "zeceipt-dossier-v2".into();
        assert!(matches!(
            Dossier::parse(&v.to_string()),
            Err(TypesError::UnsupportedVersion(_))
        ));
        let mut v: serde_json::Value = serde_json::from_str(&sample()).unwrap();
        v["claims"][0]["extra"] = 1.into();
        assert!(
            Dossier::parse(&v.to_string()).is_err(),
            "unknown fields are refused"
        );
        let mut v: serde_json::Value = serde_json::from_str(&sample()).unwrap();
        v["notes"]["n1"] = "zdp:1:AAAA".into();
        assert!(Dossier::parse(&v.to_string()).is_err());
        let mut v: serde_json::Value = serde_json::from_str(&sample()).unwrap();
        v["claims"] = serde_json::json!([{ "type": "control", "nonce": "short", "reply": "n1", "spent": ["n2"] }]);
        assert!(Dossier::parse(&v.to_string()).is_err());
        let mut v: serde_json::Value = serde_json::from_str(&sample()).unwrap();
        v["claims"] = serde_json::json!([{ "type": "holding", "notes": ["n1"], "height": 10 }]);
        assert!(
            Dossier::parse(&v.to_string()).is_err(),
            "no unspent-at-height claim: see the module doc"
        );
    }
}
