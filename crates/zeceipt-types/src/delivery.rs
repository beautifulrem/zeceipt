//! Delivery proofs in the `zdp:1:` format of `saplingcash/zcash-delivery-proof` (its SPEC.md §2, Apache-2.0).
//!
//! A delivery proof opens one Orchard or Ironwood note by its receiver, value and rseed, so the *recipient* can prove a
//! payment with an incoming viewing key, which a zeceipt receipt (an OCK, from the sender's outgoing viewing key)
//! cannot do. Zeceipt checks these proofs as that specification requires (`zeceipt_core::delivery`); it does not
//! issue them. This module only decodes the 118 bytes: it has no Zcash cryptography.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;

use crate::{Pool, TypesError};

/// The text form's prefix: this format and its version. Another version is refused (SPEC §7).
pub const PREFIX: &str = "zdp:1:";
/// Length of a proof in bytes (SPEC §2).
pub const PROOF_LEN: usize = 118;

/// A decoded `zdp:1:` proof. Nothing here is checked against a transaction yet.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeliveryProof {
    /// The txid in internal byte order (reversed from how explorers display it).
    pub txid: [u8; 32],
    /// Orchard or Ironwood; the format has no Sapling.
    pub pool: Pool,
    /// Action index in the pool's bundle.
    pub action: u16,
    /// The raw Orchard-family address: an 11-byte diversifier, then the 32-byte pk_d.
    pub receiver: [u8; 43],
    /// Value in zatoshi.
    pub value: u64,
    pub rseed: [u8; 32],
}

impl DeliveryProof {
    /// Does this text look like a delivery proof (of any version)? Used to route input between the two formats.
    pub fn is_delivery_proof(text: &str) -> bool {
        text.trim_start().starts_with("zdp:")
    }

    /// Decode `zdp:1:<base64url>`. Surrounding whitespace is ignored; anything else that is off is refused.
    pub fn decode(text: &str) -> Result<Self, TypesError> {
        let text = text.trim();
        let body = match text.strip_prefix(PREFIX) {
            Some(b) => b,
            None if text.starts_with("zdp:") => {
                return Err(TypesError::UnsupportedVersion(
                    text.split(':').take(2).collect::<Vec<_>>().join(":"),
                ))
            }
            None => return Err(TypesError::Base64("zdp proof")),
        };
        let b = URL_SAFE_NO_PAD
            .decode(body)
            .map_err(|_| TypesError::Base64("zdp proof"))?;
        if b.len() != PROOF_LEN {
            return Err(TypesError::Length {
                field: "zdp proof",
                expected: PROOF_LEN,
                got: b.len(),
            });
        }
        let pool = match b[32] {
            1 => Pool::Orchard,
            2 => Pool::Ironwood,
            _ => return Err(TypesError::DeliveryPool(b[32])),
        };
        let mut p = DeliveryProof {
            txid: [0; 32],
            pool,
            action: u16::from_le_bytes([b[33], b[34]]),
            receiver: [0; 43],
            value: u64::from_le_bytes(b[78..86].try_into().expect("8 bytes")),
            rseed: [0; 32],
        };
        p.txid.copy_from_slice(&b[0..32]);
        p.receiver.copy_from_slice(&b[35..78]);
        p.rseed.copy_from_slice(&b[86..118]);
        Ok(p)
    }

    /// The text form, `zdp:1:` then the 118 bytes in base64url without padding.
    pub fn encode(&self) -> String {
        let mut b = Vec::with_capacity(PROOF_LEN);
        b.extend_from_slice(&self.txid);
        b.push(match self.pool {
            Pool::Orchard => 1,
            Pool::Ironwood => 2,
            Pool::Sapling => unreachable!("a delivery proof has no Sapling pool"),
        });
        b.extend_from_slice(&self.action.to_le_bytes());
        b.extend_from_slice(&self.receiver);
        b.extend_from_slice(&self.value.to_le_bytes());
        b.extend_from_slice(&self.rseed);
        format!("{PREFIX}{}", URL_SAFE_NO_PAD.encode(b))
    }

    /// The txid as explorers display it.
    pub fn txid_hex(&self) -> String {
        let mut t = self.txid;
        t.reverse();
        hex::encode(t)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> DeliveryProof {
        DeliveryProof {
            txid: [7; 32],
            pool: Pool::Ironwood,
            action: 3,
            receiver: [9; 43],
            value: 10_000,
            rseed: [5; 32],
        }
    }

    #[test]
    fn delivery_proofs_round_trip_and_refuse_what_the_format_refuses() {
        let p = sample();
        let text = p.encode();
        assert!(text.starts_with("zdp:1:"));
        assert_eq!(DeliveryProof::decode(&format!("  {text}\n")).unwrap(), p);
        assert!(DeliveryProof::is_delivery_proof(&text));
        assert!(!DeliveryProof::is_delivery_proof(
            "{\"version\":\"zeceipt-v0\"}"
        ));
        // another version, a short or long body, padding, a pool other than 1 or 2
        assert!(
            matches!(DeliveryProof::decode(&text.replacen("zdp:1:", "zdp:2:", 1)), Err(TypesError::UnsupportedVersion(v)) if v == "zdp:2")
        );
        assert!(matches!(
            DeliveryProof::decode(&text[..text.len() - 4]),
            Err(TypesError::Length { .. }) | Err(TypesError::Base64(_))
        ));
        assert!(DeliveryProof::decode(&format!("{text}AAAA")).is_err());
        assert!(DeliveryProof::decode(&format!("{text}=")).is_err());
        let mut raw = URL_SAFE_NO_PAD.decode(&text[PREFIX.len()..]).unwrap();
        for bad in [0u8, 3, 0xff] {
            raw[32] = bad;
            assert!(
                matches!(DeliveryProof::decode(&format!("{PREFIX}{}", URL_SAFE_NO_PAD.encode(&raw))), Err(TypesError::DeliveryPool(b)) if b == bad)
            );
        }
        assert_eq!(p.txid_hex(), "07".repeat(32));
    }
}
