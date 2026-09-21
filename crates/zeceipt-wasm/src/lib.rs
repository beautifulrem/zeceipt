//! wasm-bindgen surface for verifying Zeceipt receipts in the browser.
//!
//! The browser fetches the raw transaction (gRPC-web or a same-origin proxy)
//! and passes it here; all cryptography runs locally. No network access here.

#![forbid(unsafe_code)]

use serde::Serialize;
use wasm_bindgen::prelude::*;
use zeceipt_core::zeceipt_types::Receipt;
use zeceipt_core::{CoreError, MemoView};

#[derive(Serialize)]
struct MemoOut {
    kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    hex: Option<String>,
}

#[derive(Serialize)]
struct VerifyOut {
    valid: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    stage: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    txid: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pool: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    output_index: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    recipient: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    value_zat: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    value_zec: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    memo: Option<MemoOut>,
    #[serde(skip_serializing_if = "Option::is_none")]
    label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    issuer_pubkey: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    issuer_key_id: Option<String>,
    challenge_checked: bool,
    proves: &'static str,
    does_not_prove: &'static str,
}

const PROVES: &str = "this transaction pays the shown value to the shown recipient with the shown memo; the issuer knew this output's outgoing cipher key";
const DOES_NOT_PROVE: &str =
    "who is presenting this receipt; anything about other outputs, transactions or balances";

fn stage(e: &CoreError) -> &'static str {
    use zeceipt_core::zeceipt_types::TypesError as T;
    match e {
        CoreError::TxidMismatch { .. } => "txid",
        CoreError::Types(T::SignatureInvalid) | CoreError::Types(T::Unsigned) => "signature",
        CoreError::Types(T::ChallengeMismatch) => "challenge",
        CoreError::OutputIndexOutOfRange { .. } | CoreError::NoBundle(_) => "output",
        CoreError::RecoveryFailed { .. } => "recovery",
        _ => "other",
    }
}

fn fail(stage: &'static str, error: String) -> VerifyOut {
    VerifyOut {
        valid: false,
        stage: Some(stage),
        error: Some(error),
        txid: None,
        pool: None,
        output_index: None,
        recipient: None,
        value_zat: None,
        value_zec: None,
        memo: None,
        label: None,
        issuer_pubkey: None,
        issuer_key_id: None,
        challenge_checked: false,
        proves: PROVES,
        does_not_prove: DOES_NOT_PROVE,
    }
}

/// Parse a receipt (JSON, URL, or base64url payload) and return it as a JS object.
#[wasm_bindgen]
pub fn parse_receipt(input: &str) -> Result<JsValue, JsValue> {
    let r = Receipt::parse(input).map_err(|e| JsValue::from_str(&e.to_string()))?;
    serde_wasm_bindgen::to_value(&r).map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Verify `receipt` against `raw_tx_hex`. `challenge` is the expected challenge
/// (UTF-8, empty if none). Returns a plain object; never throws for invalid receipts.
#[wasm_bindgen]
pub fn verify_receipt(
    receipt: &str,
    raw_tx_hex: &str,
    challenge: &str,
    require_signature: bool,
) -> JsValue {
    let out = verify_inner(receipt, raw_tx_hex, challenge, require_signature);
    serde_wasm_bindgen::to_value(&out).unwrap_or(JsValue::NULL)
}

fn verify_inner(
    receipt: &str,
    raw_tx_hex: &str,
    challenge: &str,
    require_signature: bool,
) -> VerifyOut {
    let r = match Receipt::parse(receipt) {
        Ok(r) => r,
        Err(e) => return fail("parse", e.to_string()),
    };
    let bytes = match hex::decode(raw_tx_hex.trim()) {
        Ok(b) => b,
        Err(_) => return fail("tx", "raw transaction is not hex".into()),
    };
    let tx = match zeceipt_core::parse_transaction(&bytes) {
        Ok(t) => t,
        Err(e) => return fail("tx", e.to_string()),
    };
    match zeceipt_core::verify(&r, &tx, challenge.as_bytes(), require_signature) {
        Ok(v) => VerifyOut {
            valid: true,
            stage: None,
            error: None,
            txid: Some(v.txid),
            pool: Some(v.recovered.pool.as_str()),
            output_index: Some(v.recovered.index),
            recipient: Some(v.recovered.recipient),
            value_zat: Some(v.recovered.value_zat),
            value_zec: Some(format!(
                "{}.{:08}",
                v.recovered.value_zat / 100_000_000,
                v.recovered.value_zat % 100_000_000
            )),
            memo: Some(match v.recovered.memo {
                MemoView::Empty => MemoOut {
                    kind: "empty",
                    text: None,
                    hex: None,
                },
                MemoView::Text(t) => MemoOut {
                    kind: "text",
                    text: Some(t),
                    hex: None,
                },
                MemoView::Bytes(h) => MemoOut {
                    kind: "bytes",
                    text: None,
                    hex: Some(h),
                },
            }),
            label: Some(r.label.clone()),
            issuer_pubkey: v.issuer_pubkey,
            issuer_key_id: r.issuer_key_id.clone(),
            challenge_checked: v.challenge_checked,
            proves: PROVES,
            does_not_prove: DOES_NOT_PROVE,
        },
        Err(e) => fail(stage(&e), e.to_string()),
    }
}

/// Check only the envelope's issuer signature (no transaction needed).
/// Returns `{ signed: bool, valid: bool, issuer_pubkey?: string, error?: string }`.
#[wasm_bindgen]
pub fn check_signature(receipt: &str) -> JsValue {
    #[derive(Serialize)]
    struct Out {
        signed: bool,
        valid: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        issuer_pubkey: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    }
    let out = match Receipt::parse(receipt) {
        Err(e) => Out {
            signed: false,
            valid: false,
            issuer_pubkey: None,
            error: Some(e.to_string()),
        },
        Ok(r) => {
            if r.signature.is_none() {
                Out {
                    signed: false,
                    valid: false,
                    issuer_pubkey: None,
                    error: None,
                }
            } else {
                match r.verify_signature() {
                    Ok(pk) => Out {
                        signed: true,
                        valid: true,
                        issuer_pubkey: Some(hex::encode(pk.to_bytes())),
                        error: None,
                    },
                    Err(e) => Out {
                        signed: true,
                        valid: false,
                        issuer_pubkey: None,
                        error: Some(e.to_string()),
                    },
                }
            }
        }
    };
    serde_wasm_bindgen::to_value(&out).unwrap_or(JsValue::NULL)
}

/// Library version string.
#[wasm_bindgen]
pub fn version() -> String {
    format!(
        "zeceipt-wasm {} ({})",
        env!("CARGO_PKG_VERSION"),
        zeceipt_core::zeceipt_types::VERSION
    )
}
