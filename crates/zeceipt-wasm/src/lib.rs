//! wasm-bindgen surface for verifying Zeceipt receipts in the browser.
//!
//! The browser fetches the raw transaction (gRPC-web or a same-origin proxy)
//! and passes it here; all cryptography runs locally. No network access here.

#![forbid(unsafe_code)]

use serde::Serialize;
use wasm_bindgen::prelude::*;
use zeceipt_core::zeceipt_types::delivery::DeliveryProof;
use zeceipt_core::zeceipt_types::{binding, Network, Receipt};
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
    /// `receipt` (a zeceipt receipt, the sender's side) or `delivery-proof` (a `zdp:1:` proof, either side).
    kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    stage: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    txid: Option<String>,
    /// ZIP 239 wtxid (txid then authorizing-data digest, internal byte order), hex: it also covers the signatures and
    /// proofs, which a v5/v6 txid does not.
    #[serde(skip_serializing_if = "Option::is_none")]
    wtxid: Option<String>,
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

const PROVES: &str = "this transaction pays the shown value to the shown recipient with the shown memo; whoever produced this receipt knew this output's OCK, as does anyone holding an earlier receipt for it; a signature attributes the receipt to a key, not the OCK to the sender";
const DOES_NOT_PROVE: &str =
    "who is presenting this receipt; that the output is still unspent, or that whoever presents the receipt can spend it; anything about other outputs, transactions or balances";

const DELIVERY_PROVES: &str = "this transaction delivers the shown value to the shown receiver with the shown memo: the proof's note is the one the action commits to, and the note's own key decrypts the action's ciphertext; whoever made the proof could see that note (the recipient with an incoming viewing key, or the sender with an outgoing one), as can anyone holding an earlier copy of it";
const DELIVERY_DOES_NOT_PROVE: &str = "who sent it, or who is presenting this proof (a delivery proof carries no signature and no challenge); that the output is still unspent; anything about other outputs, transactions or balances";

fn memo_out(m: MemoView) -> MemoOut {
    match m {
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
    }
}

fn zec(zat: u64) -> String {
    format!("{}.{:08}", zat / 100_000_000, zat % 100_000_000)
}

fn stage(e: &CoreError) -> &'static str {
    use zeceipt_core::zeceipt_types::TypesError as T;
    match e {
        CoreError::TxidMismatch { .. } | CoreError::DeliveryTxidMismatch { .. } => "txid",
        CoreError::Types(T::SignatureInvalid) | CoreError::Types(T::Unsigned) => "signature",
        CoreError::Types(T::ChallengeMismatch) => "challenge",
        CoreError::OutputIndexOutOfRange { .. } | CoreError::NoBundle(_) => "output",
        CoreError::RecoveryFailed { .. }
        | CoreError::DeliveryMismatch { .. }
        | CoreError::ValueOutOfRange { .. } => "recovery",
        CoreError::UnsupportedBranch { .. } => "tx",
        _ => "other",
    }
}

fn fail(stage: &'static str, error: String) -> VerifyOut {
    VerifyOut {
        valid: false,
        kind: "receipt",
        stage: Some(stage),
        error: Some(error),
        txid: None,
        wtxid: None,
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
    // Never `null` (slice U5): a result that cannot be represented is reported as a failure, not dropped.
    serde_wasm_bindgen::to_value(&out).unwrap_or_else(|e| {
        serde_wasm_bindgen::to_value(&fail(
            "other",
            format!("the result cannot be represented: {e}"),
        ))
        .unwrap_or(JsValue::NULL)
    })
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
            kind: "receipt",
            stage: None,
            error: None,
            txid: Some(v.txid),
            wtxid: Some(zeceipt_core::delivery::wtxid_hex(&tx)),
            pool: Some(v.recovered.pool.as_str()),
            output_index: Some(v.recovered.index),
            recipient: Some(v.recovered.recipient),
            value_zat: Some(v.recovered.value_zat),
            value_zec: Some(zec(v.recovered.value_zat)),
            memo: Some(memo_out(v.recovered.memo)),
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

/// Is this input a `zdp:1:` delivery proof rather than a receipt? (Any `zdp:` prefix: another version is then refused
/// by name.)
#[wasm_bindgen]
pub fn is_delivery_proof(input: &str) -> bool {
    DeliveryProof::is_delivery_proof(input)
}

/// Decode a `zdp:1:` delivery proof: `{ txid, pool, output_index, value_zat }` (display-order txid), so the caller can
/// fetch the transaction it names. Throws on a malformed proof.
#[wasm_bindgen]
pub fn parse_delivery_proof(input: &str) -> Result<JsValue, JsValue> {
    let p = DeliveryProof::decode(input).map_err(|e| JsValue::from_str(&e.to_string()))?;
    serde_json::json!({
        "txid": p.txid_hex(),
        "pool": p.pool.as_str(),
        "output_index": p.action,
        "value_zat": p.value,
    })
    .serialize(&serde_wasm_bindgen::Serializer::json_compatible())
    .map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Check a `zdp:1:` delivery proof against `raw_tx_hex` (zcash-delivery-proof SPEC §4; `zeceipt_core::delivery`).
/// `network` (`main`, `test` or `regtest`) only chooses how the recipient is written: a proof does not name its
/// network. Returns the same shape as `verify_receipt`, with `kind: "delivery-proof"`; never throws for a proof that
/// does not hold.
#[wasm_bindgen]
pub fn verify_delivery_proof(proof: &str, raw_tx_hex: &str, network: &str) -> JsValue {
    let out = delivery_inner(proof, raw_tx_hex, network);
    serde_wasm_bindgen::to_value(&out).unwrap_or_else(|e| {
        serde_wasm_bindgen::to_value(&fail(
            "other",
            format!("the result cannot be represented: {e}"),
        ))
        .unwrap_or(JsValue::NULL)
    })
}

fn delivery_inner(proof: &str, raw_tx_hex: &str, network: &str) -> VerifyOut {
    let failed = |stage, error| VerifyOut {
        kind: "delivery-proof",
        proves: DELIVERY_PROVES,
        does_not_prove: DELIVERY_DOES_NOT_PROVE,
        ..fail(stage, error)
    };
    let network = match network {
        "main" => Network::Main,
        "test" => Network::Test,
        "regtest" => Network::Regtest,
        other => return failed("other", format!("unknown network {other:?}")),
    };
    let p = match DeliveryProof::decode(proof) {
        Ok(p) => p,
        Err(e) => return failed("parse", e.to_string()),
    };
    let bytes = match hex::decode(raw_tx_hex.trim()) {
        Ok(b) => b,
        Err(_) => return failed("tx", "raw transaction is not hex".into()),
    };
    match zeceipt_core::delivery::check(&bytes, &p, network) {
        Ok(d) => VerifyOut {
            valid: true,
            kind: "delivery-proof",
            stage: None,
            error: None,
            txid: Some(d.txid),
            wtxid: Some(d.wtxid),
            pool: Some(d.recovered.pool.as_str()),
            output_index: Some(d.recovered.index),
            recipient: Some(d.recovered.recipient),
            value_zat: Some(d.recovered.value_zat),
            value_zec: Some(zec(d.recovered.value_zat)),
            memo: Some(memo_out(d.recovered.memo)),
            label: None,
            issuer_pubkey: None,
            issuer_key_id: None,
            challenge_checked: false,
            proves: DELIVERY_PROVES,
            does_not_prove: DELIVERY_DOES_NOT_PROVE,
        },
        Err(e) => failed(
            match e {
                CoreError::Malformed(_) | CoreError::UnsupportedBranch { .. } => "tx",
                _ => stage(&e),
            },
            e.to_string(),
        ),
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

/// The domain a receipt's signed key id claims (spec §7), when the receipt is signed, its signature verifies and the
/// key id is `<label>@<domain>`: `{ claim: { label, domain, url } }`; otherwise `{ binding: { state: "unknown", reason } }`
/// (nothing to look up). Makes no request: the caller fetches `url` only when its user asks.
#[wasm_bindgen]
pub fn issuer_claim(receipt: &str) -> JsValue {
    let out = match Receipt::parse(receipt) {
        Err(e) => {
            serde_json::json!({ "binding": { "state": "unknown", "reason": format!("not a receipt: {e}") } })
        }
        Ok(r) => match binding::receipt_claim(&r) {
            Ok(c) => {
                serde_json::json!({ "claim": { "label": c.label, "domain": c.domain, "url": c.url() } })
            }
            Err(b) => serde_json::json!({ "binding": b }),
        },
    };
    out.serialize(&serde_wasm_bindgen::Serializer::json_compatible())
        .unwrap_or(JsValue::NULL)
}

/// Compare a receipt with a well-known file (spec §7): `body` as served by `served_by`, the domain the caller fetched
/// from. Returns `{ state: "confirmed" | "not_listed", domain }` or `{ state: "unknown", reason }`. Never a verdict on
/// the receipt's validity.
#[wasm_bindgen]
pub fn issuer_binding(receipt: &str, served_by: &str, body: &[u8]) -> JsValue {
    let b = match Receipt::parse(receipt) {
        Err(e) => binding::Binding::Unknown {
            reason: format!("not a receipt: {e}"),
        },
        Ok(r) => binding::evaluate(&r, served_by, body),
    };
    b.serialize(&serde_wasm_bindgen::Serializer::json_compatible())
        .unwrap_or(JsValue::NULL)
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

/// The txids a source-of-funds dossier's checks need (spec/dossier-v1.md): the caller fetches each, with its height.
/// Throws on a dossier that does not parse.
#[wasm_bindgen]
pub fn dossier_txids(dossier: &str) -> Result<JsValue, JsValue> {
    let d = zeceipt_core::zeceipt_types::dossier::Dossier::parse(dossier)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    serde_wasm_bindgen::to_value(&zeceipt_core::dossier::txids_needed(&d))
        .map_err(|e| JsValue::from_str(&e.to_string()))
}

/// The txids whose outputs a dossier's origin transactions spend (fetch them too; spec/dossier-v1.md): the funders'
/// addresses and values come from those outputs. `txs` as for `check_dossier`.
#[wasm_bindgen]
pub fn dossier_prevout_txids(dossier: &str, txs: JsValue) -> Result<JsValue, JsValue> {
    let d = zeceipt_core::zeceipt_types::dossier::Dossier::parse(dossier)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    let chain = tx_map(txs).map_err(|e| JsValue::from_str(&e))?;
    serde_wasm_bindgen::to_value(&zeceipt_core::dossier::prevout_txids(&d, &chain))
        .map_err(|e| JsValue::from_str(&e.to_string()))
}

/// `{ "<txid>": { hex, height, mempool } }` → the core's map. A value whose hex does not decode is kept as empty
/// bytes, so the note that names it reports the transaction as malformed rather than missing.
fn tx_map(
    txs: JsValue,
) -> Result<std::collections::HashMap<String, zeceipt_core::dossier::TxData>, String> {
    #[derive(serde::Deserialize)]
    struct In {
        hex: String,
        #[serde(default)]
        height: Option<u64>,
        #[serde(default)]
        mempool: bool,
    }
    let given: std::collections::HashMap<String, In> =
        serde_wasm_bindgen::from_value(txs).map_err(|e| format!("txs: {e}"))?;
    Ok(given
        .into_iter()
        .map(|(txid, t)| {
            let bytes = hex::decode(t.hex.trim()).unwrap_or_default();
            (
                txid.to_lowercase(),
                zeceipt_core::dossier::TxData {
                    bytes,
                    height: t.height,
                    mempool: t.mempool,
                },
            )
        })
        .collect())
}

/// Check every claim of a dossier. `txs` is `{ "<txid>": { "hex": "...", "height": 123 | null, "mempool": bool } }`;
/// `expect_nonce` (empty for none) is the nonce the reviewer issued, which every control claim must answer, and
/// `issued_at_height` (optional) the chain height they issued it at: a control transaction mined below it fails.
/// Returns the report (`zeceipt-dossier-report-v1`), or `{ error, stage: "parse" }` for a dossier that does not parse;
/// never throws for a claim that fails.
#[wasm_bindgen]
pub fn check_dossier(
    dossier: &str,
    txs: JsValue,
    expect_nonce: &str,
    issued_at_height: Option<f64>,
) -> JsValue {
    let d = match zeceipt_core::zeceipt_types::dossier::Dossier::parse(dossier) {
        Ok(d) => d,
        Err(e) => {
            return json_value(
                &serde_json::json!({ "error": e.to_string(), "stage": "parse", "all_verified": false }),
            )
        }
    };
    let chain = match tx_map(txs) {
        Ok(c) => c,
        Err(e) => {
            return json_value(
                &serde_json::json!({ "error": e, "stage": "other", "all_verified": false }),
            )
        }
    };
    let opts = zeceipt_core::dossier::CheckOptions {
        expect_nonce: Some(expect_nonce.trim().to_string()).filter(|n| !n.is_empty()),
        issued_at_height: issued_at_height
            .filter(|h| h.is_finite() && *h >= 0.0)
            .map(|h| h as u64),
    };
    let report = zeceipt_core::dossier::check_dossier_with(&d, dossier, &chain, &opts);
    json_value(
        &serde_json::to_value(&report)
            .unwrap_or_else(|e| serde_json::json!({ "error": e.to_string() })),
    )
}

/// Build a dossier in the browser from the holder's UFVK (it never leaves the page) and the raw transactions of the
/// funds, oldest first; optionally the challenge transaction and the reviewer's nonce. Returns the dossier JSON text,
/// or throws with the reason.
#[wasm_bindgen]
pub fn build_dossier(
    ufvk: &str,
    network: &str,
    txs_hex: Vec<String>,
    control_hex: Option<String>,
    nonce: Option<String>,
    subject: Option<String>,
    created: Option<String>,
) -> Result<String, JsValue> {
    let err = |e: String| JsValue::from_str(&e);
    let network = match network {
        "main" => Network::Main,
        "test" => Network::Test,
        "regtest" => Network::Regtest,
        n => return Err(err(format!("unknown network {n:?}"))),
    };
    let keys = zeceipt_core::OutgoingKeys::from_ufvk(network, ufvk.trim())
        .map_err(|e| err(e.to_string()))?;
    let txs = txs_hex
        .iter()
        .map(|h| hex::decode(h.trim()).map_err(|_| err("a transaction is not hex".into())))
        .collect::<Result<Vec<_>, _>>()?;
    let control = match (control_hex, nonce) {
        (Some(h), Some(n)) if !h.trim().is_empty() => Some((
            hex::decode(h.trim())
                .map_err(|_| err("the challenge transaction is not hex".into()))?,
            n,
        )),
        _ => None,
    };
    let d = zeceipt_core::dossier::build(zeceipt_core::dossier::BuildInput {
        keys: &keys,
        txs,
        control,
        subject,
        created,
    })
    .map_err(|e| err(e.to_string()))?;
    d.to_json().map_err(|e| err(e.to_string()))
}

fn json_value(v: &serde_json::Value) -> JsValue {
    v.serialize(&serde_wasm_bindgen::Serializer::json_compatible())
        .unwrap_or(JsValue::NULL)
}

/// A wallet scan in the browser (the dossier builder's "find my transactions"): made from the holder's UFVK, which stays
/// in the page, it is fed serialized `CompactBlock`s from a gRPC-web `GetBlockRange` stream and reports the holder's
/// transactions (`zeceipt_core::dossier::WalletScanner`).
#[wasm_bindgen]
pub struct DossierScanner {
    inner: zeceipt_core::dossier::WalletScanner,
}

#[wasm_bindgen]
impl DossierScanner {
    #[wasm_bindgen(constructor)]
    pub fn new(ufvk: &str, network: &str) -> Result<DossierScanner, JsValue> {
        let network = match network {
            "main" => Network::Main,
            "test" => Network::Test,
            "regtest" => Network::Regtest,
            n => return Err(JsValue::from_str(&format!("unknown network {n:?}"))),
        };
        let keys = zeceipt_core::OutgoingKeys::from_ufvk(network, ufvk.trim())
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        let inner = zeceipt_core::dossier::WalletScanner::new(&keys)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        Ok(DossierScanner { inner })
    }

    /// Scan one serialized `CompactBlock`; returns its height.
    pub fn scan_block(&mut self, block: &[u8]) -> Result<u64, JsValue> {
        self.inner
            .scan_compact_block(block)
            .map_err(|e| JsValue::from_str(&e.to_string()))
    }

    /// The holder's transactions found so far: `[{ height, txid, received, spent }]`, in chain order.
    pub fn found(&self) -> JsValue {
        json_value(&serde_json::to_value(self.inner.found()).unwrap_or_default())
    }
}
