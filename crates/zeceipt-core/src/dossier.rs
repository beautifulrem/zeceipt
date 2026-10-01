//! Checking a source-of-funds dossier (`spec/dossier-v1.md`) against chain data.
//!
//! The caller fetches every transaction the dossier names (`txids_needed`) from a node it trusts, with the height it
//! was mined at, and passes them in; this module does no I/O, so the CLI (native gRPC) and the browser (gRPC-web, WASM)
//! run the same checks. Every claim reports `verified`, `failed` (with the reason) or `not_checked` (the data to check
//! it was not supplied), and the facts a reviewer needs: values, heights, where funds came from and went.
//!
//! Nullifiers: a note's nullifier is derived from the account's nullifier-deriving key `nk` and the note alone
//! (`Note::nullifier`, which reads only `nk` from the full viewing key it is given). The dossier discloses `nk`; this
//! module pairs it with fixed, public `ak` and `rivk` values to form a key that `Note::nullifier` accepts. That key can
//! derive nullifiers and nothing else useful: its incoming viewing key is not the account's. A disclosed nullifier
//! found among a transaction's spends proves that transaction spent that note (finding a different `nk` that maps the
//! note to one of those nullifiers would break the nullifier PRF); a wrong `nk` produces nullifiers that appear nowhere.

use std::collections::{BTreeMap, HashMap};

use orchard::keys::FullViewingKey;
use serde::Serialize;
use sha2::Digest;
use zcash_primitives::transaction::Transaction;
use zeceipt_types::delivery::DeliveryProof;
use zeceipt_types::dossier::{Claim, Dossier};
use zeceipt_types::{Network, Pool};

use crate::delivery::check_note;
use crate::{parse_transaction, txid_hex, verify, MemoView};

/// A transaction the caller fetched: its bytes, the height its node reports it mined at (`None` when not mined or
/// not known), and whether a node reported it in the mempool (not mined yet). Loaded from a file, the height is
/// unknown and `mempool` false.
#[derive(Debug, Clone)]
pub struct TxData {
    pub bytes: Vec<u8>,
    pub height: Option<u64>,
    pub mempool: bool,
}

/// The outcome of one claim.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    Verified,
    /// The chain data contradicts the claim.
    Failed,
    /// Not checkable yet: a transaction is in the mempool or was not found; check again later.
    NotChecked,
    /// The data given cannot show it (an origin whose note is never spent here): waiting will not change that.
    Unproven,
}

/// What the chain says about one disclosed note.
#[derive(Debug, Clone, Serialize)]
pub struct NoteFact {
    pub txid: String,
    pub pool: &'static str,
    pub action: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recipient: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value_zat: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memo: Option<String>,
    /// The note's nullifier (hex), when the dossier carries `nk`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nullifier: Option<String>,
    /// The transaction that spent this note, when its nullifier is among a supplied transaction's spends. Only then
    /// is the note shown to belong to the account whose `nk` the dossier discloses: a note's sender knows its opening
    /// too, but not the recipient's `nk`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spent_in: Option<String>,
    /// Why the note could not be opened, if it could not.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// A transparent input of a funding transaction.
#[derive(Debug, Clone, Serialize)]
pub struct TransparentInput {
    /// The output it spends, `txid:index`.
    pub prevout: String,
    /// The address of the output it spends, read from that output's script (P2PKH or P2SH) in the previous
    /// transaction, when that transaction was supplied. Never read from the input's own signature script: a v5/v6
    /// txid does not cover it (ZIP 244), so a node or a file could put any address there.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub address: Option<String>,
    /// The value of the output it spends, from the previous transaction.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value_zat: Option<u64>,
    /// The index of this dossier's `transparent_payment` claim for the output it spends: the holder paid it there
    /// (funds that left the shielded pool and came back).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub paid_in_claim: Option<usize>,
}

/// Where a transaction's value came from, as the transaction itself shows it.
#[derive(Debug, Clone, Serialize)]
pub struct Funding {
    pub transparent_inputs: Vec<TransparentInput>,
    /// Shielded actions and spends in the transaction (Ironwood, Orchard, Sapling). An Orchard-family action always
    /// carries a nullifier, real or dummy, so this counts possible spends, not real ones.
    pub shielded_actions: usize,
    pub sapling_spends: usize,
    /// Disclosed notes of this dossier spent by this transaction (their nullifiers are in it).
    pub from_disclosed: Vec<String>,
}

/// The outcome of one claim, with the facts behind it.
#[derive(Debug, Clone, Serialize)]
pub struct ClaimResult {
    pub index: usize,
    pub kind: &'static str,
    pub status: Status,
    /// One sentence a reviewer reads.
    pub summary: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub details: Vec<String>,
    /// For origin claims: what funded the note's transaction.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub funding: Option<Funding>,
    /// For control claims, the value the spent disclosed notes carried; for deposit and transparent payment claims,
    /// the amount paid.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value_zat: Option<u64>,
    /// For transparent payment claims: the address the output pays (P2PKH or P2SH), read from its script.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub paid_to: Option<String>,
    /// For path, deposit, transparent payment and control claims: a lower bound on the value the claim's transaction
    /// spent from shielded notes the dossier does not disclose (from the pools' public value balances), when above 0.
    /// The claim holds, but the disclosed notes do not explain all of what that transaction paid.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub undisclosed_input_min_zat: Option<u64>,
}

/// The whole report.
#[derive(Debug, Clone, Serialize)]
pub struct Report {
    pub version: &'static str,
    pub network: Network,
    /// Some disclosed note's nullifier, derived with the dossier's `nk`, is among a supplied transaction's spends: `nk`
    /// is that account's, and the notes it spent belonged to it.
    pub nk_proven: bool,
    /// A control claim verified against the nonce the reviewer says they issued: whoever answered it could spend that
    /// account's notes. False without an expected nonce, since an old dossier answers an old nonce.
    pub controlled: bool,
    /// A dossier-level problem that fails the claims it concerns (an `nk` that is not a key, …).
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub problems: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subject: Option<String>,
    /// sha256 of the dossier as given (hex), for a case file.
    pub dossier_sha256: String,
    pub notes: BTreeMap<String, NoteFact>,
    pub claims: Vec<ClaimResult>,
    /// Every claim verified.
    pub all_verified: bool,
    /// What the report as a whole supports, the first that applies:
    /// - `not_verified`: some claim did not verify, or there is a problem;
    /// - `consistent_offline`: every claim holds against the transactions supplied, but some came without a height from
    ///   a node (files): nothing was checked against the chain;
    /// - `verified_partly_explained`: every claim verified, but some funds are not traced back to an origin
    ///   (`untraced`), or a transaction spent undisclosed funds too (`undisclosed_input_min_zat`);
    /// - `verified_history_only`: the history is verified and explained, but no control answers the reviewer's nonce;
    /// - `verified_with_control`: all of it, and the holder answered the reviewer's nonce.
    pub assurance: &'static str,
    /// Every transaction the claims rest on came from a node, with the height it was mined at.
    pub anchored: bool,
    /// Funding notes of payments and control claims that no chain of path claims leads back to an origin claim.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub untraced: Vec<String>,
    /// The sum of the claims' `undisclosed_input_min_zat`: at least this much of what the claims' transactions paid
    /// came from funds the dossier does not explain.
    pub undisclosed_input_min_zat: u64,
    /// Origin claims that name no source: funded by undisclosed shielded notes, or by disclosed ones (a hop), or by
    /// transparent inputs whose previous transactions were not supplied.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub unexplained_origins: Vec<String>,
    /// Transparent inputs of the claims' transactions whose value is unknown (their previous transaction missing).
    #[serde(skip_serializing_if = "is_zero")]
    pub unvalued_inputs: usize,
    /// The block whose hash a verified control claim's beacon nonce is (spec §7.4).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub beacon_height: Option<u64>,
    /// Whether a verified payment pays the deposit address the reviewer gave; absent when they gave none.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deposit_address_paid: Option<bool>,
    /// The height the reviewer says the nonce was issued at, when given: a control transaction mined before it fails.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub issued_at_height: Option<u64>,
    /// What the holder disclosed by handing this dossier over.
    pub disclosed: Vec<String>,
    /// What no claim here proves.
    pub does_not_prove: Vec<&'static str>,
}

pub const REPORT_VERSION: &str = "zeceipt-dossier-report-v1";

/// How `zeceipt dossier nonce` (and the case page) start a nonce; a memo starting so marks a challenge answer.
pub const CHALLENGE_PREFIX: &str = "zeceipt-challenge-";

/// A beacon nonce: `zeceipt-beacon-<height>-<block hash, display hex>`. Nobody can know a block's hash before it is
/// mined, and anyone can look it up after, so a control answering one was made after that block, with no reviewer
/// to trust for the nonce's freshness (spec §7.4).
pub const BEACON_PREFIX: &str = "zeceipt-beacon-";

/// The height and block hash a beacon nonce names, if it is one.
pub fn parse_beacon(nonce: &str) -> Option<(u64, String)> {
    let rest = nonce.trim().strip_prefix(BEACON_PREFIX)?;
    let (h, hash) = rest.split_once('-')?;
    let hash = hash.to_lowercase();
    (hash.len() == 64 && hash.bytes().all(|c| c.is_ascii_hexdigit()))
        .then_some(())
        .and(h.parse().ok().map(|h| (h, hash)))
}

/// The heights whose block hashes the dossier's beacon nonces name: fetch them (hash and time) for `CheckOptions`.
pub fn beacon_heights(d: &Dossier) -> Vec<u64> {
    let mut v: Vec<u64> = d
        .claims
        .iter()
        .filter_map(|c| match c {
            Claim::Control { nonce, .. } => parse_beacon(nonce).map(|(h, _)| h),
            _ => None,
        })
        .collect();
    v.sort();
    v.dedup();
    v
}

const DOES_NOT_PROVE: &[&str] = &[
    "who the counterparties are: an origin shows the transparent addresses that funded a transaction, not who holds them",
    "the value of undisclosed inputs of a transaction: they are counted, not valued",
    "anything about notes, payments or balances the dossier does not disclose",
    "that funds are unspent now: control shows the holder could spend the listed notes when the challenge transaction was made",
    "a legal attestation: this is evidence a reviewer weighs, not a certificate",
];

/// Public `ak` and a small `rivk` that, with a disclosed `nk`, form a full viewing key good only for deriving nullifiers
/// (see the module doc). `ak` is the spend validating key of the Orchard key whose 32 bytes are all 0x07 (a published
/// test value, so no one's key); `rivk` is 1 (then 2, 3, … if that makes an invalid key).
const NULLIFIER_KEY_FILLER: ([u8; 32], [u8; 32]) = (
    hex_literal(b"6ebb833c1d2f8433080abceabe47906097f90678d603f577d0486c9111737b07"),
    [0u8; 32],
);

const fn hex_literal(s: &[u8; 64]) -> [u8; 32] {
    let mut out = [0u8; 32];
    let mut i = 0;
    while i < 32 {
        out[i] = (nibble(s[2 * i]) << 4) | nibble(s[2 * i + 1]);
        i += 1;
    }
    out
}

const fn nibble(c: u8) -> u8 {
    match c {
        b'0'..=b'9' => c - b'0',
        b'a'..=b'f' => c - b'a' + 10,
        _ => panic!("hex"),
    }
}

/// A full viewing key that carries `nk` and derives nullifiers with it. `None` if no filler makes a valid key.
pub fn nullifier_key(nk: [u8; 32]) -> Option<FullViewingKey> {
    // A handful of public fillers: `FullViewingKey::from_bytes` refuses a key whose ivk would be zero, which one
    // filler can hit for a given nk with negligible probability; another filler then works.
    for tweak in 0u8..8 {
        let mut b = [0u8; 96];
        b[..32].copy_from_slice(&NULLIFIER_KEY_FILLER.0);
        b[32..64].copy_from_slice(&nk);
        let mut rivk = NULLIFIER_KEY_FILLER.1;
        rivk[0] = tweak + 1;
        b[64..].copy_from_slice(&rivk);
        if let Some(k) = FullViewingKey::from_bytes(&b) {
            return Some(k);
        }
    }
    None
}

/// Every Orchard-family nullifier a transaction reveals (Ironwood and Orchard actions), hex.
pub fn tx_nullifiers(tx: &Transaction) -> Vec<String> {
    let mut out = Vec::new();
    for b in [tx.ironwood_bundle(), tx.orchard_bundle()]
        .into_iter()
        .flatten()
    {
        out.extend(
            b.actions()
                .iter()
                .map(|a| hex::encode(a.nullifier().to_bytes())),
        );
    }
    out
}

/// The txids a dossier's checks need: every note's transaction and every receipt's.
pub fn txids_needed(d: &Dossier) -> Vec<String> {
    let mut v: Vec<String> = d
        .note_proofs()
        .map(|m| m.values().map(DeliveryProof::txid_hex).collect())
        .unwrap_or_default();
    v.extend(d.receipts.values().map(|r| r.txid.to_lowercase()));
    v.extend(d.claims.iter().filter_map(|c| match c {
        Claim::TransparentPayment { tx, .. } => Some(tx.clone()),
        _ => None,
    }));
    v.sort();
    v.dedup();
    v
}

/// The txids of the transactions whose outputs the dossier's transactions spend (their transparent inputs), so the
/// caller can fetch them too and the report can name each funder's address and value from the output itself (and
/// count transparent money that entered a path or a payment, spec §5.6). Call
/// it with the transactions `txids_needed` returned; fetch these; check with all of them.
pub fn prevout_txids(d: &Dossier, txs: &HashMap<String, TxData>) -> Vec<String> {
    let mut out = Vec::new();
    for named in txids_needed(d) {
        let Some(tx) = txs
            .get(&named)
            .and_then(|t| parse_transaction(&t.bytes).ok())
        else {
            continue;
        };
        if let Some(b) = tx.transparent_bundle() {
            for i in &b.vin {
                let (txid, _) = outpoint(i);
                if !out.contains(&txid) && !txs.contains_key(&txid) {
                    out.push(txid);
                }
            }
        }
    }
    out
}

/// An input's outpoint: (display txid, index), from its serialization (32-byte hash, 4-byte index).
fn outpoint<A: zcash_transparent::bundle::Authorization>(
    i: &zcash_transparent::bundle::TxIn<A>,
) -> (String, u32) {
    let o = i.prevout();
    let mut h = *o.txid().as_ref();
    h.reverse();
    (hex::encode(h), o.n())
}

/// An output's value and address: the address from a standard P2PKH or P2SH script.
fn output_facts(tx: &Transaction, n: u32, network: Network) -> Option<(u64, Option<String>)> {
    let out = tx.transparent_bundle()?.vout.get(n as usize)?;
    let mut raw = Vec::new();
    out.write(&mut raw).ok()?;
    let value = u64::from_le_bytes(raw.get(..8)?.try_into().ok()?);
    let (len, rest) = compact_size(raw.get(8..)?)?;
    let script = rest.get(..len)?;
    Some((value, script_address(script, network)))
}

/// The address a standard output script pays: P2PKH or P2SH; `None` for anything else.
fn script_address(script: &[u8], network: Network) -> Option<String> {
    use zcash_transparent::address::TransparentAddress;
    let addr = match script {
        // OP_DUP OP_HASH160 <20> OP_EQUALVERIFY OP_CHECKSIG
        [0x76, 0xa9, 0x14, h @ .., 0x88, 0xac] if h.len() == 20 => {
            TransparentAddress::PublicKeyHash(h.try_into().ok()?)
        }
        // OP_HASH160 <20> OP_EQUAL
        [0xa9, 0x14, h @ .., 0x87] if h.len() == 20 => {
            TransparentAddress::ScriptHash(h.try_into().ok()?)
        }
        _ => return None,
    };
    Some(match network {
        Network::Main => zcash_keys::encoding::encode_transparent_address_p(
            &zcash_protocol::consensus::MainNetwork,
            &addr,
        ),
        Network::Test => zcash_keys::encoding::encode_transparent_address_p(
            &zcash_protocol::consensus::TestNetwork,
            &addr,
        ),
        Network::Regtest => {
            zcash_keys::encoding::encode_transparent_address_p(&crate::regtest_params(), &addr)
        }
    })
}

/// What funded `tx`: its transparent inputs (with the address and value of each spent output, when its transaction
/// was supplied) and shielded spends, and which disclosed notes it spends.
fn funding(
    tx: &Transaction,
    network: Network,
    spent_by: &[String],
    txs: &HashMap<String, TxData>,
    claims: &[Claim],
) -> Funding {
    let mut transparent_inputs = Vec::new();
    if let Some(b) = tx.transparent_bundle() {
        for i in &b.vin {
            let (txid, n) = outpoint(i);
            let facts = txs
                .get(&txid)
                .and_then(|t| parse_transaction(&t.bytes).ok())
                .filter(|p| txid_hex(p) == txid)
                .and_then(|p| output_facts(&p, n, network));
            let paid_in_claim = claims.iter().position(|c| {
                matches!(c, Claim::TransparentPayment { tx, output, .. } if *tx == txid && *output == n)
            });
            transparent_inputs.push(TransparentInput {
                prevout: format!("{txid}:{n}"),
                address: facts.as_ref().and_then(|f| f.1.clone()),
                value_zat: facts.map(|f| f.0),
                paid_in_claim,
            });
        }
    }
    let shielded_actions = [tx.ironwood_bundle(), tx.orchard_bundle()]
        .into_iter()
        .flatten()
        .map(|b| b.actions().len())
        .sum();
    let sapling_spends = tx.sapling_bundle().map_or(0, |b| b.shielded_spends().len());
    Funding {
        transparent_inputs,
        shielded_actions,
        sapling_spends,
        from_disclosed: spent_by.to_vec(),
    }
}

fn compact_size(b: &[u8]) -> Option<(usize, &[u8])> {
    match *b.first()? {
        n @ 0..=0xfc => Some((n as usize, &b[1..])),
        0xfd => Some((
            u16::from_le_bytes([*b.get(1)?, *b.get(2)?]) as usize,
            b.get(3..)?,
        )),
        _ => None, // no script is 64 KiB or longer
    }
}

fn memo_text(m: &MemoView) -> String {
    match m {
        MemoView::Empty => String::new(),
        MemoView::Text(t) => t.clone(),
        MemoView::Bytes(h) => format!("bytes {h}"),
    }
}

/// An amount with its coin's name: TAZ on testnet and regtest, ZEC on mainnet.
fn amount(zat: u64, network: Network) -> String {
    let unit = if matches!(network, Network::Main) {
        "ZEC"
    } else {
        "TAZ"
    };
    format!("{}.{:08} {unit}", zat / 100_000_000, zat % 100_000_000)
}

/// Check every claim of `d` against `txs` (txid → bytes and height). `raw` is the dossier text as given, hashed into the
/// report. `expect_nonce`, when the reviewer gives it, must be the nonce every control claim answers: a dossier made
/// for another reviewer, or an old one, then fails (the nonce is the reviewer's to remember).
pub fn check_dossier(
    d: &Dossier,
    raw: &str,
    given: &HashMap<String, TxData>,
    expect_nonce: Option<&str>,
) -> Report {
    check_dossier_with(
        d,
        raw,
        given,
        &CheckOptions {
            expect_nonce: expect_nonce.map(str::to_string),
            ..Default::default()
        },
    )
}

/// What the reviewer knows about the challenge they issued.
#[derive(Debug, Clone, Default)]
pub struct CheckOptions {
    /// The nonce they issued: every control claim must answer it.
    pub expect_nonce: Option<String>,
    /// The chain height when they issued it: a control transaction mined below it was made before the nonce existed
    /// (someone guessed or leaked it early), so it fails.
    pub issued_at_height: Option<u64>,
    /// The blocks a beacon nonce names, by height: (hash, display hex; time, Unix seconds), from a node the reviewer
    /// trusts (`beacon_heights`).
    pub beacons: BTreeMap<u64, (String, u32)>,
    /// The deposit address the reviewer assigned this customer: a transparent payment or a deposit must pay it.
    pub expect_deposit_address: Option<String>,
}

/// `check_dossier`, with everything the reviewer knows about their challenge.
pub fn check_dossier_with(
    d: &Dossier,
    raw: &str,
    given: &HashMap<String, TxData>,
    opts: &CheckOptions,
) -> Report {
    let expect_nonce = opts.expect_nonce.as_deref();
    let mut problems = Vec::new();
    // Every supplied transaction under its own txid, recomputed from its bytes: one filed under another txid is set
    // aside (a mislabelled file must not stand in for the transaction a claim names). Bytes that do not parse keep
    // their label, so the note that names them reports them as malformed.
    let mut sane: HashMap<String, TxData> = HashMap::new();
    for (label, t) in given {
        let label = label.to_lowercase();
        match parse_transaction(&t.bytes) {
            Ok(tx) if txid_hex(&tx) != label => problems.push(format!(
                "a transaction supplied as {} is {}: set aside",
                short(&label),
                short(&txid_hex(&tx))
            )),
            _ => {
                sane.insert(label, t.clone());
            }
        }
    }
    let txs = &sane;
    let nk_key = match d.nk_bytes() {
        None => None,
        Some(nk) => match nullifier_key(nk) {
            Some(k) => Some(k),
            None => {
                problems.push("nk is not a valid Orchard nullifier key encoding: no nullifier can be derived from it".to_string());
                None
            }
        },
    };
    let net = d.network;
    // Every nullifier any supplied transaction reveals: a disclosed note found here was spent there.
    let mut spent_at: HashMap<String, String> = HashMap::new();
    for (txid, t) in txs {
        if let Ok(tx) = parse_transaction(&t.bytes) {
            for nf in tx_nullifiers(&tx) {
                spent_at.insert(nf, txid.clone());
            }
        }
    }
    let mut notes: BTreeMap<String, NoteFact> = BTreeMap::new();
    let proofs = d.note_proofs().unwrap_or_default();
    for (id, p) in &proofs {
        let txid = p.txid_hex();
        let mut fact = NoteFact {
            txid: txid.clone(),
            pool: p.pool.as_str(),
            action: u32::from(p.action),
            height: None,
            recipient: None,
            value_zat: None,
            memo: None,
            nullifier: None,
            spent_in: None,
            error: None,
        };
        match txs.get(&txid) {
            None => {
                fact.error =
                    Some("its transaction was not found on the node, or not supplied".into())
            }
            Some(t) => {
                fact.height = t.height;
                match check_note(&t.bytes, p, net) {
                    Ok((del, note)) => {
                        fact.recipient = Some(del.recovered.recipient);
                        fact.value_zat = Some(del.recovered.value_zat);
                        fact.memo = Some(memo_text(&del.recovered.memo));
                        if let Some(k) = &nk_key {
                            let nf = hex::encode(note.nullifier(k).to_bytes());
                            fact.spent_in = spent_at.get(&nf).cloned();
                            fact.nullifier = Some(nf);
                        }
                    }
                    Err(e) => fact.error = Some(e.to_string()),
                }
            }
        }
        notes.insert(id.clone(), fact);
    }
    let disclosed_nf: Vec<(String, String)> = notes
        .iter()
        .filter_map(|(id, f)| f.nullifier.clone().map(|n| (id.clone(), n)))
        .collect();
    let spends_in = |tx: &Transaction| -> Vec<String> {
        let nfs = tx_nullifiers(tx);
        disclosed_nf
            .iter()
            .filter(|(_, n)| nfs.contains(n))
            .map(|(id, _)| id.clone())
            .collect()
    };
    let parsed = |txid: &str| txs.get(txid).and_then(|t| parse_transaction(&t.bytes).ok());
    let missing = |id: &str| notes.get(id).is_some_and(|f| !txs.contains_key(&f.txid));
    let note_ok = |id: &str| notes.get(id).is_some_and(|f| f.error.is_none());
    let note_err = |id: &str| -> String {
        notes
            .get(id)
            .and_then(|f| f.error.clone())
            .unwrap_or_else(|| "not disclosed".into())
    };
    let value = |id: &str| notes.get(id).and_then(|f| f.value_zat).unwrap_or(0);
    let when = |id: &str| {
        notes
            .get(id)
            .and_then(|f| f.height)
            .map(|h| format!(" at height {h}"))
            .unwrap_or_default()
    };
    // The inclusion of the transactions a claim rests on: any in the mempool makes the claim wait; any loaded without
    // a height (a file) is noted.
    let inclusion = |txids: &[String], r: &mut ClaimResult| {
        let in_mempool: Vec<&String> = txids
            .iter()
            .filter(|t| txs.get(*t).is_some_and(|x| x.mempool))
            .collect();
        let unknown: Vec<&String> = txids
            .iter()
            .filter(|t| {
                txs.get(*t)
                    .is_some_and(|x| !x.mempool && x.height.is_none())
            })
            .collect();
        if !in_mempool.is_empty() && r.status == Status::Verified {
            r.status = Status::NotChecked;
            r.details.push(format!(
                "{} in the mempool, not mined yet: check again once mined.",
                in_mempool
                    .iter()
                    .map(|t| short(t))
                    .collect::<Vec<_>>()
                    .join(", ")
            ));
        }
        if !unknown.is_empty() {
            r.details.push(format!("Loaded without a height (from a file): the inclusion of {} in the chain was not checked here.", unknown.iter().map(|t| short(t)).collect::<Vec<_>>().join(", ")));
        }
    };
    let needs_nk_failed = |r: &mut ClaimResult| -> bool {
        if nk_key.is_none() {
            r.summary = if d.nk.is_some() {
                "nk is not a valid key, so no nullifier can be tested.".into()
            } else {
                "The dossier carries no nk.".into()
            };
            true
        } else {
            false
        }
    };

    let mut claims = Vec::new();
    let mut beacon_ok: Option<u64> = None;
    let mut beacon_verified: Option<u64> = None;
    for (index, c) in d.claims.iter().enumerate() {
        let kind = c.kind();
        let mut r = ClaimResult {
            index,
            kind,
            status: Status::Failed,
            summary: String::new(),
            details: vec![],
            funding: None,
            value_zat: None,
            paid_to: None,
            undisclosed_input_min_zat: None,
        };
        let ids = c.notes();
        if let Some(m) = ids.iter().find(|n| missing(n)) {
            r.status = Status::NotChecked;
            r.summary = format!(
                "The transaction of note {m} ({}) was not found on the node, or not supplied.",
                short(&notes[*m].txid)
            );
            claims.push(r);
            continue;
        }
        match c {
            Claim::Origin { note } => {
                if !note_ok(note) {
                    r.summary = format!("Note {note} does not open: {}", note_err(note));
                } else {
                    let f = &notes[note];
                    let tx = parsed(&f.txid).expect("opened, so parsed");
                    let funding = funding(&tx, net, &spends_in(&tx), txs, &d.claims);
                    let from = if !funding.from_disclosed.is_empty() {
                        format!(
                            "funded by disclosed note{} {}",
                            if funding.from_disclosed.len() > 1 {
                                "s"
                            } else {
                                ""
                            },
                            funding.from_disclosed.join(", ")
                        )
                    } else if !funding.transparent_inputs.is_empty() {
                        let addrs = dedup(
                            funding
                                .transparent_inputs
                                .iter()
                                .filter_map(|i| i.address.clone())
                                .collect(),
                        );
                        let valued: Vec<u64> = funding
                            .transparent_inputs
                            .iter()
                            .filter_map(|i| i.value_zat)
                            .collect();
                        let n = funding.transparent_inputs.len();
                        format!(
                            "funded by {n} transparent input{}{}{}",
                            if n > 1 { "s" } else { "" },
                            if valued.len() == n {
                                format!(" worth {}", amount(valued.iter().sum(), net))
                            } else {
                                String::new()
                            },
                            if addrs.is_empty() {
                                " (their previous transactions were not supplied)".into()
                            } else {
                                format!(" from {}", addrs.join(", "))
                            }
                        ) + &{
                            let paid: Vec<String> = funding
                                .transparent_inputs
                                .iter()
                                .filter(|i| i.paid_in_claim.is_some())
                                .map(|i| {
                                    let (t, n) =
                                        i.prevout.split_once(':').unwrap_or((&i.prevout, ""));
                                    format!("{}:{n}", short(t))
                                })
                                .collect();
                            if paid.is_empty() {
                                String::new()
                            } else {
                                // By outpoint, not claim number: readers number claims from 0 (the report's
                                // `index`) or from 1 (the case page).
                                format!(
                                    ", which the holder paid there from disclosed notes (transparent payment {})",
                                    paid.join(", ")
                                )
                            }
                        }
                    } else {
                        "funded from the shielded pool by an undisclosed sender".into()
                    };
                    r.summary = format!(
                        "{} arrived in note {note}, in {}{}, {from}.",
                        amount(value(note), net),
                        short(&f.txid),
                        when(note)
                    );
                    match &f.spent_in {
                        Some(t) => {
                            r.status = Status::Verified;
                            r.details.push(format!("{note} was later spent with this dossier's nk (in {}), so it belonged to that account.", short(t)));
                        }
                        None => {
                            r.status = Status::Unproven;
                            r.details.push(format!("Nothing here shows {note} is the holder's: its nullifier is in no supplied transaction, and the sender of a note knows its opening too. A path, deposit or control claim that spends it would show it."));
                        }
                    }
                    // Funders' change: a transparent output of this transaction back to an address that funded it.
                    let funders: Vec<&String> = funding
                        .transparent_inputs
                        .iter()
                        .filter_map(|i| i.address.as_ref())
                        .collect();
                    let vouts = tx.transparent_bundle().map_or(0, |b| b.vout.len());
                    for k in 0..vouts as u32 {
                        if let Some((v, Some(a))) = output_facts(&tx, k, net) {
                            if funders.contains(&&a) {
                                r.details.push(format!(
                                    "{} of the inputs went back to {a} (output {k}): change to the funder.",
                                    amount(v, net)
                                ));
                            }
                        }
                    }
                    r.funding = Some(funding);
                    let mut on = vec![f.txid.clone()];
                    on.extend(f.spent_in.clone());
                    inclusion(&on, &mut r);
                }
            }
            Claim::Path { from, to } => {
                if needs_nk_failed(&mut r) {
                } else if !note_ok(from) || !note_ok(to) {
                    r.summary = format!(
                        "A note does not open: {from}: {}; {to}: {}",
                        if note_ok(from) {
                            "ok".into()
                        } else {
                            note_err(from)
                        },
                        if note_ok(to) {
                            "ok".into()
                        } else {
                            note_err(to)
                        }
                    );
                } else {
                    let tx = parsed(&notes[to].txid).expect("opened, so parsed");
                    let spent = spends_in(&tx);
                    if spent.iter().any(|s| s == from) {
                        r.status = Status::Verified;
                        r.summary = format!(
                            "{} in {from} was spent in {}{}, which created {to} ({}).",
                            amount(value(from), net),
                            short(&notes[to].txid),
                            when(to),
                            amount(value(to), net)
                        );
                        if spent.len() > 1 {
                            r.details.push(format!(
                                "That transaction also spends disclosed notes {}.",
                                spent
                                    .iter()
                                    .filter(|s| *s != from)
                                    .cloned()
                                    .collect::<Vec<_>>()
                                    .join(", ")
                            ));
                        }
                        if notes[to].spent_in.is_none() {
                            r.details.push(format!("{to} is not shown to be the holder's: that transaction may have paid it to someone else (a change note and a payment look alike here)."));
                        }
                        inclusion(&[notes[from].txid.clone(), notes[to].txid.clone()], &mut r);
                    } else {
                        r.summary = format!("{from}'s nullifier, derived with this dossier's nk, is not among {}'s spends: that transaction did not spend {from} with this account's key.", short(&notes[to].txid));
                    }
                }
            }
            Claim::Deposit { receipt, funded_by } => {
                let rc = &d.receipts[receipt];
                let rtx = rc.txid.to_lowercase();
                match txs.get(&rtx).map(|t| (t, parse_transaction(&t.bytes))) {
                    None => {
                        r.status = Status::NotChecked;
                        r.summary = format!("The transaction of receipt {receipt} ({}) was not found on the node, or not supplied.", short(&rtx));
                    }
                    Some((_, Err(e))) => {
                        r.summary = format!("Receipt {receipt}'s transaction does not parse: {e}")
                    }
                    Some((t, Ok(tx))) => match verify(rc, &tx, b"", false) {
                        Err(e) => r.summary = format!("Receipt {receipt} does not verify: {e}"),
                        Ok(v) => {
                            let paid = format!(
                                "{} to {} (memo \"{}\") in {}{}",
                                amount(v.recovered.value_zat, net),
                                v.recovered.recipient,
                                memo_text(&v.recovered.memo),
                                short(&v.txid),
                                t.height
                                    .map(|h| format!(" at height {h}"))
                                    .unwrap_or_default()
                            );
                            r.value_zat = Some(v.recovered.value_zat);
                            r.paid_to = Some(v.recovered.recipient.clone());
                            if !funded_by.is_empty() && nk_key.is_none() {
                                needs_nk_failed(&mut r);
                            } else {
                                let spent = spends_in(&tx);
                                let unfunded: Vec<&String> =
                                    funded_by.iter().filter(|n| !spent.contains(n)).collect();
                                if !unfunded.is_empty() {
                                    r.summary = format!("Receipt {receipt} opens a payment of {paid}, but not from {}: their nullifiers are not among its spends.", unfunded.iter().map(|s| s.as_str()).collect::<Vec<_>>().join(", "));
                                } else {
                                    r.status = Status::Verified;
                                    r.summary = if funded_by.is_empty() {
                                        format!("The receipt opens a payment of {paid}.")
                                    } else {
                                        format!(
                                            "The holder paid {paid}, from {} ({} disclosed).",
                                            funded_by.join(", "),
                                            amount(funded_by.iter().map(|n| value(n)).sum(), net)
                                        )
                                    };
                                    if funded_by.is_empty() {
                                        r.details.push("No funding notes are listed, so nothing ties this payment to the holder's other notes; whoever knows the output's OCK could make this receipt.".into());
                                    }
                                }
                                if let Some(pk) = v.issuer_pubkey {
                                    r.details
                                        .push(format!("The receipt is signed by key {pk}."));
                                }
                                let mut on = vec![rtx.clone()];
                                on.extend(funded_by.iter().map(|n| notes[n].txid.clone()));
                                inclusion(&on, &mut r);
                            }
                        }
                    },
                }
            }
            Claim::Control {
                nonce,
                reply,
                spent,
            } => {
                let bad: Vec<&String> = spent
                    .iter()
                    .chain(std::iter::once(reply))
                    .filter(|n| !note_ok(n))
                    .collect();
                if needs_nk_failed(&mut r) {
                } else if !bad.is_empty() {
                    r.summary = format!(
                        "Notes do not open: {}",
                        bad.iter()
                            .map(|n| format!("{n}: {}", note_err(n)))
                            .collect::<Vec<_>>()
                            .join("; ")
                    );
                } else if expect_nonce.is_some_and(|e| e.trim() != nonce.trim()) {
                    r.summary = format!("This control claim answers nonce {nonce}, not the one you issued: it was made for another challenge, or an earlier one.");
                } else if let Some((bh, bhash)) =
                    parse_beacon(nonce).filter(|_| expect_nonce.is_none())
                {
                    match opts.beacons.get(&bh) {
                        None => {
                            r.status = Status::NotChecked;
                            r.summary = format!("This control claim answers a beacon, the hash of block {bh}, which was not looked up: check again with a node.");
                        }
                        Some((hash, _)) if *hash != bhash => {
                            r.summary = format!("The beacon nonce names block {bh} with hash {}, but block {bh}'s hash is {}: it is not that block's beacon.", short(&bhash), short(hash));
                        }
                        Some(_) => {
                            beacon_ok = Some(bh);
                        }
                    }
                }
                // A beacon's block: the challenge must be mined after it.
                let beacon_h0 = beacon_ok.filter(|_| r.summary.is_empty()).map(|h| h + 1);
                let h0_eff = opts.issued_at_height.or(beacon_h0);
                if r.summary.is_empty() {
                    let f = &notes[reply];
                    let tx = parsed(&f.txid).expect("opened, so parsed");
                    let spends = spends_in(&tx);
                    let unspent: Vec<&String> =
                        spent.iter().filter(|n| !spends.contains(n)).collect();
                    let memo = f.memo.clone().unwrap_or_default();
                    let total: u64 = spent.iter().map(|n| value(n)).sum();
                    r.value_zat = Some(total);
                    if !memo.contains(nonce.trim()) {
                        r.summary = format!("The reply note's memo does not carry the nonce {nonce} (it reads \"{memo}\").");
                    } else if !unspent.is_empty() {
                        r.summary = format!(
                            "The challenge transaction does not spend {}.",
                            unspent
                                .iter()
                                .map(|s| s.as_str())
                                .collect::<Vec<_>>()
                                .join(", ")
                        );
                    } else if let Some((h, h0)) = f.height.zip(h0_eff).filter(|(h, h0)| h < h0) {
                        r.summary = if beacon_h0.is_some() && opts.issued_at_height.is_none() {
                            format!("The challenge transaction {} was mined at height {h}, not after the beacon's block {}: it could have been made before the beacon existed.", short(&f.txid), h0 - 1)
                        } else {
                            format!("The challenge transaction {} was mined at height {h}, before you issued the nonce at height {h0}: it was not made in answer to your challenge.", short(&f.txid))
                        };
                    } else if let (Some(b0), None) = (beacon_h0, f.height) {
                        r.status = Status::NotChecked;
                        r.summary = format!("This control claim answers the beacon of block {}, but the challenge transaction's height is not known here (a file), so it cannot be shown to come after that block.", b0 - 1);
                    } else {
                        r.status = Status::Verified;
                        r.summary = format!(
                            "Answering nonce {nonce}, the holder spent {} ({}) in {}{}: they could spend these funds after the nonce was issued.",
                            spent.join(", "),
                            amount(total, net),
                            short(&f.txid),
                            when(reply)
                        );
                        if let Some(h0) = beacon_h0 {
                            let (hash, time) = &opts.beacons[&(h0 - 1)];
                            r.details.push(format!("The nonce is the beacon of block {} (hash {}, mined at Unix time {time}): no one could know it before that block, so the challenge was made after it. Judge whether that block is recent enough for your case.", h0 - 1, short(hash)));
                        } else if expect_nonce.is_none() {
                            r.details.push("Check that this is the nonce you issued (zeceipt dossier verify --expect-nonce): an old dossier answers an old nonce.".into());
                        }
                        match (opts.issued_at_height, f.height) {
                            (Some(h0), Some(_)) => r.details.push(format!(
                                "Mined after the nonce was issued (at height {h0})."
                            )),
                            (Some(h0), None) => r.details.push(format!("Its height is not known here, so it was not checked against the height you issued the nonce at ({h0}).")),
                            (None, _) => {}
                        }
                        let mut on = vec![f.txid.clone()];
                        on.extend(spent.iter().map(|n| notes[n].txid.clone()));
                        inclusion(&on, &mut r);
                    }
                }
            }
            Claim::TransparentPayment {
                tx: ptx,
                output,
                funded_by,
            } => {
                let bad: Vec<&String> = funded_by.iter().filter(|n| !note_ok(n)).collect();
                if needs_nk_failed(&mut r) {
                } else if !bad.is_empty() {
                    r.summary = format!(
                        "Notes do not open: {}",
                        bad.iter()
                            .map(|n| format!("{n}: {}", note_err(n)))
                            .collect::<Vec<_>>()
                            .join("; ")
                    );
                } else {
                    match txs.get(ptx).map(|t| (t, parse_transaction(&t.bytes))) {
                        None => {
                            r.status = Status::NotChecked;
                            r.summary = format!("The payment's transaction ({}) was not found on the node, or not supplied.", short(ptx));
                        }
                        Some((_, Err(e))) => {
                            r.summary = format!("The payment's transaction does not parse: {e}")
                        }
                        Some((t, Ok(tx))) => match output_facts(&tx, *output, net) {
                            None => {
                                r.summary =
                                    format!("{} has no transparent output {output}.", short(ptx))
                            }
                            Some((v, addr)) => {
                                let to = addr
                                    .clone()
                                    .unwrap_or_else(|| "a non-standard script".into());
                                let paid = format!(
                                    "{} to {to} (transparent output {output}) in {}{}",
                                    amount(v, net),
                                    short(ptx),
                                    t.height
                                        .map(|h| format!(" at height {h}"))
                                        .unwrap_or_default()
                                );
                                r.value_zat = Some(v);
                                r.paid_to = addr;
                                let spent = spends_in(&tx);
                                let unfunded: Vec<&String> =
                                    funded_by.iter().filter(|n| !spent.contains(n)).collect();
                                if !unfunded.is_empty() {
                                    r.summary = format!("{} pays {paid}, but not from {}: their nullifiers are not among its spends.", short(ptx), unfunded.iter().map(|s| s.as_str()).collect::<Vec<_>>().join(", "));
                                } else {
                                    r.status = Status::Verified;
                                    r.summary = format!(
                                        "The holder paid {paid}, from {} ({} disclosed).",
                                        funded_by.join(", "),
                                        amount(funded_by.iter().map(|n| value(n)).sum(), net)
                                    );
                                    r.details.push("The address and amount are read from the output's script on chain; the funding notes' nullifiers in that transaction tie the payment to the holder.".into());
                                    let mut on = vec![ptx.clone()];
                                    on.extend(funded_by.iter().map(|n| notes[n].txid.clone()));
                                    inclusion(&on, &mut r);
                                }
                            }
                        },
                    }
                }
            }
        }
        if r.kind == "control" && r.status == Status::Verified && beacon_ok.is_some() {
            beacon_verified = beacon_ok;
        }
        beacon_ok = None;
        claims.push(r);
    }
    let mut disclosed = vec![format!(
        "{} note opening{} (each: its transaction, amount, recipient address and memo)",
        notes.len(),
        if notes.len() == 1 { "" } else { "s" }
    )];
    if d.nk.is_some() {
        disclosed.push("nk, the nullifier key: the reviewer can tell when any disclosed note is spent, and so can anyone who learns nk and another of the account's note openings (its sender knows them)".into());
    }
    if !d.receipts.is_empty() {
        disclosed.push(format!(
            "{} sender receipt{} (each opens one payment the holder made)",
            d.receipts.len(),
            if d.receipts.len() == 1 { "" } else { "s" }
        ));
    }
    // Trace closure: which notes a chain of verified path claims leads back to an origin claim.
    let mut traced: std::collections::BTreeSet<&str> = d
        .claims
        .iter()
        .filter_map(|c| match c {
            Claim::Origin { note } => Some(note.as_str()),
            _ => None,
        })
        .collect();
    loop {
        let before = traced.len();
        for (c, r) in d.claims.iter().zip(&claims) {
            if let Claim::Path { from, to } = c {
                if r.status == Status::Verified && traced.contains(from.as_str()) {
                    traced.insert(to.as_str());
                }
            }
        }
        if traced.len() == before {
            break;
        }
    }
    let mut untraced: Vec<String> = Vec::new();
    for c in &d.claims {
        let funding: Vec<&String> = match c {
            Claim::Deposit { funded_by, .. } | Claim::TransparentPayment { funded_by, .. } => {
                funded_by.iter().collect()
            }
            Claim::Control { spent, .. } => spent.iter().collect(),
            _ => vec![],
        };
        for n in funding {
            if !traced.contains(n.as_str()) && !untraced.contains(n) {
                untraced.push(n.clone());
            }
        }
    }
    // Value coverage: for each claim's transaction, how much it must have spent from undisclosed shielded notes. Per
    // pool, the notes spent are worth the notes created plus the pool's value balance (value leaving the pool); the
    // disclosed ones are known, so the rest is at least (disclosed created + receipts paid + balance − disclosed spent).
    let receipt_values: Vec<(String, Pool, u64)> = d
        .claims
        .iter()
        .zip(&claims)
        .filter_map(|(c, r)| match c {
            Claim::Deposit { receipt, .. } => Some((receipt, r)),
            _ => None,
        })
        .filter(|(receipt, r)| {
            r.status == Status::Verified && {
                // A receipt whose output is also a disclosed note is counted once, as the note.
                let rc = &d.receipts[*receipt];
                let txid = rc.txid.to_lowercase();
                !notes.values().any(|f| {
                    f.txid == txid && f.pool == rc.pool.as_str() && f.action == rc.output_index
                })
            }
        })
        .filter_map(|(receipt, r)| {
            let rc = &d.receipts[receipt];
            Some((rc.txid.to_lowercase(), rc.pool, r.value_zat?))
        })
        .collect();
    let receipts_by_tx = |txid: &str, pool: Pool| -> u64 {
        receipt_values
            .iter()
            .filter(|(t, p, _)| t == txid && *p == pool)
            .map(|(_, _, v)| v)
            .sum()
    };
    let undisclosed_min = |txid: &str| -> u64 {
        let Some(tx) = parsed(txid) else { return 0 };
        let mut total: i128 = 0;
        for (pool, bundle) in [
            (Pool::Ironwood, tx.ironwood_bundle()),
            (Pool::Orchard, tx.orchard_bundle()),
        ] {
            let Some(b) = bundle else { continue };
            let balance = i64::from(*b.value_balance()) as i128;
            let created: i128 = notes
                .values()
                .filter(|f| f.txid == txid && f.pool == pool.as_str())
                .filter_map(|f| f.value_zat)
                .sum::<u64>() as i128;
            let spent: i128 = notes
                .values()
                .filter(|f| f.spent_in.as_deref() == Some(txid) && f.pool == pool.as_str())
                .filter_map(|f| f.value_zat)
                .sum::<u64>() as i128;
            let paid = receipts_by_tx(txid, pool) as i128;
            total += (created + paid + balance - spent).max(0);
        }
        total += (i64::from(tx.sapling_value_balance()) as i128).max(0);
        total as u64
    };
    // Transparent money entering a path's or a payment's transaction is not explained by the disclosed notes either:
    // (value of the inputs whose previous transaction was supplied, inputs without it).
    let t_inputs = |txid: &str| -> (u64, usize) {
        let Some(tx) = parsed(txid) else {
            return (0, 0);
        };
        let Some(b) = tx.transparent_bundle() else {
            return (0, 0);
        };
        let (mut v, mut unknown) = (0u64, 0usize);
        for i in &b.vin {
            let (pt, n) = outpoint(i);
            match parsed(&pt).and_then(|p| output_facts(&p, n, net)) {
                Some((value, _)) => v += value,
                None => unknown += 1,
            }
        }
        (v, unknown)
    };
    let bounds: Vec<Option<(String, u64, usize)>> = d
        .claims
        .iter()
        .zip(&claims)
        .map(|(c, r)| {
            if r.status != Status::Verified {
                return None;
            }
            let txid = match c {
                Claim::Path { to, .. } => notes[to].txid.clone(),
                Claim::Deposit { receipt, .. } => d.receipts[receipt].txid.to_lowercase(),
                Claim::TransparentPayment { tx, .. } => tx.clone(),
                Claim::Control { reply, .. } => notes[reply].txid.clone(),
                Claim::Origin { .. } => return None,
            };
            let (tv, unknown) = t_inputs(&txid);
            let u = undisclosed_min(&txid) + tv;
            (u > 0 || unknown > 0).then_some((txid, u, unknown))
        })
        .collect();
    for (r, b) in claims.iter_mut().zip(&bounds) {
        if let Some((txid, u, unknown)) = b {
            let (txid, u, unknown) = (txid.clone(), *u, *unknown);
            if u > 0 {
                r.undisclosed_input_min_zat = Some(u);
                r.details.push(format!("{} also spent at least {} from funds this dossier does not explain (undisclosed notes, or transparent inputs): the disclosed notes do not explain all of what it paid.", short(&txid), amount(u, net)));
            }
            if unknown > 0 {
                r.details.push(format!("{} also has {unknown} transparent input{} whose previous transaction was not supplied: their value is not counted.", short(&txid), if unknown == 1 { "" } else { "s" }));
            }
        }
    }
    let unvalued_inputs: usize = {
        let mut seen: Vec<&String> = Vec::new();
        let mut n = 0;
        for (txid, _, unknown) in bounds.iter().flatten() {
            if !seen.contains(&txid) {
                seen.push(txid);
                n += unknown;
            }
        }
        n
    };
    // An origin explains its funds only when the transaction itself shows where they came from: transparent inputs
    // whose addresses are read from their outputs, and no shielded money the dossier does not disclose. An origin on
    // a note paid by an undisclosed shielded sender (or on the holder's own change) names no source (spec §5.6).
    let mut unexplained_origins: Vec<String> = Vec::new();
    for (c, r) in d.claims.iter().zip(claims.iter_mut()) {
        let Claim::Origin { note } = c else { continue };
        if r.status != Status::Verified {
            continue;
        }
        let f = r
            .funding
            .as_ref()
            .expect("a verified origin reports its funding");
        let named = !f.transparent_inputs.is_empty()
            && f.transparent_inputs.iter().all(|i| i.address.is_some());
        let shielded = undisclosed_min(&notes[note].txid);
        if !f.from_disclosed.is_empty() || !named || shielded > 0 {
            if !unexplained_origins.contains(note) {
                unexplained_origins.push(note.clone());
            }
            r.details.push(if !f.from_disclosed.is_empty() {
                format!("This origin's transaction spends disclosed notes ({}): it is a hop, not a source; a path claim states it.", f.from_disclosed.join(", "))
            } else if shielded > 0 {
                format!("Its source is not shown: at least {} came from shielded notes this dossier does not disclose.", amount(shielded, net))
            } else {
                "Its source is not shown: the transparent inputs' previous transactions were not supplied.".into()
            });
        }
    }
    // A transaction's bound is counted once, however many claims rest on it.
    let mut counted: Vec<&String> = Vec::new();
    let mut undisclosed_total = 0u64;
    for (txid, u, _) in bounds.iter().flatten() {
        if !counted.contains(&txid) {
            counted.push(txid);
            undisclosed_total += u;
        }
    }
    let anchored = txids_needed(d)
        .iter()
        .all(|t| txs.get(t).is_some_and(|x| x.height.is_some()));
    let control_ok = claims
        .iter()
        .any(|c| c.kind == "control" && c.status == Status::Verified);
    let all_ok = claims.iter().all(|c| c.status == Status::Verified);
    // The deposit address the reviewer assigned this customer: the dossier must show a payment to it from the holder's
    // notes (spec §7.2: the cross-check against a relayed control proof).
    let mut deposit_address_paid = None;
    if let Some(want) = opts
        .expect_deposit_address
        .as_deref()
        .map(|a| tex_as_transparent(a.trim(), net).unwrap_or_else(|| a.trim().to_string()))
        .as_deref()
    {
        if address_network(want).is_some_and(|n| n != net) {
            problems.push(format!("The deposit address you gave ({want}) is for another network than this dossier ({}).", match net { Network::Main => "mainnet", Network::Test => "testnet", Network::Regtest => "regtest" }));
            deposit_address_paid = Some(false);
        } else {
            let paid = claims.iter().any(|c| {
                matches!(c.kind, "transparent_payment" | "deposit")
                    && c.status == Status::Verified
                    && c.paid_to.as_deref() == Some(want)
            });
            deposit_address_paid = Some(paid);
            if !paid {
                problems.push(format!("No verified payment in this dossier pays the deposit address you assigned ({want}): it does not show that this holder made your deposit."));
            }
        }
    }
    if expect_nonce.is_some() && !d.claims.iter().any(|c| matches!(c, Claim::Control { .. })) {
        problems.push("You issued a nonce, and no control claim answers it: this dossier does not show the holder can spend these funds now.".into());
    }
    let mut report = Report {
        assurance: "not_verified", // set below
        anchored,
        untraced,
        undisclosed_input_min_zat: undisclosed_total,
        issued_at_height: opts.issued_at_height,
        version: REPORT_VERSION,
        network: d.network,
        nk_proven: notes.values().any(|n| n.spent_in.is_some()),
        controlled: control_ok && (expect_nonce.is_some() || beacon_verified.is_some()),
        beacon_height: beacon_verified,
        deposit_address_paid,
        unexplained_origins,
        unvalued_inputs,
        problems,
        subject: d.subject.clone(),
        dossier_sha256: hex::encode(sha2::Sha256::digest(raw.as_bytes())),
        all_verified: false, // set below, once `problems` is final
        notes,
        claims,
        disclosed,
        does_not_prove: DOES_NOT_PROVE.to_vec(),
    };
    report.all_verified = all_ok && report.problems.is_empty();
    report.assurance = if !report.all_verified {
        "not_verified"
    } else if !report.anchored {
        "consistent_offline"
    } else if !report.untraced.is_empty()
        || report.undisclosed_input_min_zat > 0
        || !report.unexplained_origins.is_empty()
        || report.unvalued_inputs > 0
    {
        "verified_partly_explained"
    } else if !report.controlled {
        "verified_history_only"
    } else {
        "verified_with_control"
    };
    report
}

/// A TEX address (ZIP 320) as the transparent P2PKH address it pays: a payment to a TEX address is an output to that
/// key hash, which is what the output's script names.
fn tex_as_transparent(a: &str, net: Network) -> Option<String> {
    use zcash_keys::address::Address;
    let decoded = match net {
        Network::Main => Address::decode(&zcash_protocol::consensus::MainNetwork, a),
        Network::Test => Address::decode(&zcash_protocol::consensus::TestNetwork, a),
        Network::Regtest => Address::decode(&crate::regtest_params(), a),
    }?;
    let Address::Tex(hash) = decoded else {
        return None;
    };
    let mut script = vec![0x76, 0xa9, 0x14];
    script.extend(hash);
    script.extend([0x88, 0xac]);
    script_address(&script, net)
}

/// The network an encoded address is for, from its prefix (transparent, TEX, Sapling, unified); `None` if unknown.
fn address_network(a: &str) -> Option<Network> {
    let a = a.trim();
    if a.starts_with("utest")
        || a.starts_with("textest")
        || a.starts_with("ztestsapling")
        || a.starts_with("tm")
        || a.starts_with("t2")
    {
        Some(Network::Test)
    } else if a.starts_with("uregtest")
        || a.starts_with("texregtest")
        || a.starts_with("zregtestsapling")
    {
        Some(Network::Regtest)
    } else if a.starts_with("u1")
        || a.starts_with("tex1")
        || a.starts_with("zs1")
        || a.starts_with("t1")
        || a.starts_with("t3")
    {
        Some(Network::Main)
    } else {
        None
    }
}

fn is_zero(n: &usize) -> bool {
    *n == 0
}

fn short(txid: &str) -> String {
    if txid.len() > 16 {
        format!("{}…{}", &txid[..8], &txid[txid.len() - 4..])
    } else {
        txid.into()
    }
}

fn dedup(mut v: Vec<String>) -> Vec<String> {
    v.sort();
    v.dedup();
    v
}

/// The Orchard-family pools a note can be in.
pub fn note_pool(p: &DeliveryProof) -> Pool {
    p.pool
}

/// For tests and tools: the display txid of a transaction.
pub fn display_txid(tx: &Transaction) -> String {
    txid_hex(tx)
}

/// What the holder hands the builder: their UFVK's keys, the transactions of the funds to explain in order (each
/// `(txid, bytes)`), and optionally the challenge transaction with the reviewer's nonce.
pub struct BuildInput<'a> {
    pub keys: &'a crate::OutgoingKeys,
    pub txs: Vec<Vec<u8>>,
    pub control: Option<(Vec<u8>, String)>,
    pub subject: Option<String>,
    pub created: Option<String>,
}

/// Build a dossier from the holder's own view of their transactions (spec §5): every note the UFVK received or got as
/// change in them is disclosed; a transaction funded by no disclosed note gets an `origin` claim per note; one that
/// spends disclosed notes gets `path` claims to the notes it created for the holder, and a `deposit` claim, with a
/// sender receipt, for each output it paid to someone else; the challenge transaction gets a `control` claim. Only
/// Orchard-family notes are covered. The result is checked by `check_dossier` before it is returned.
/// The holder's transactions reordered so that every one comes after the transactions that created the notes it
/// spends: the holder may list them in any order, and a spend seen before the note's creation would read as an origin.
/// Otherwise the given order is kept.
fn spend_order(
    txs: Vec<Vec<u8>>,
    proving: &crate::delivery::ProvingKeys,
    nkey: &FullViewingKey,
    network: Network,
) -> Result<Vec<Vec<u8>>, crate::CoreError> {
    use crate::delivery::{prove_with, Side};
    let mut left: Vec<(Vec<u8>, Vec<String>, Vec<String>)> = Vec::new(); // (bytes, created nfs, revealed nfs)
    for bytes in txs {
        let tx = parse_transaction(&bytes)?;
        let mut created = Vec::new();
        for f in prove_with(&bytes, proving)?
            .iter()
            .filter(|f| f.side != Side::Sent)
        {
            let (_, note) = check_note(&bytes, &f.proof, network)?;
            created.push(hex::encode(note.nullifier(nkey).to_bytes()));
        }
        left.push((bytes, created, tx_nullifiers(&tx)));
    }
    let mut out = Vec::new();
    while !left.is_empty() {
        let ready = (0..left.len())
            .find(|&i| {
                !left
                    .iter()
                    .enumerate()
                    .any(|(j, other)| j != i && other.1.iter().any(|nf| left[i].2.contains(nf)))
            })
            .unwrap_or(0); // a cycle cannot happen on chain; keep the given order if it does
        out.push(left.remove(ready).0);
    }
    Ok(out)
}

pub fn build(input: BuildInput<'_>) -> Result<Dossier, crate::CoreError> {
    use crate::delivery::{prove_with, ProvingKeys, Side};
    use crate::{issue, IssueOptions};
    let network = input.keys.network;
    let fvk = input
        .keys
        .orchard_fvk
        .as_ref()
        .ok_or(crate::CoreError::MissingKey("Orchard full viewing"))?;
    let nk: [u8; 32] = fvk.to_bytes()[32..64].try_into().expect("32 bytes");
    let nkey = nullifier_key(nk)
        .ok_or_else(|| crate::CoreError::KeyDecode("no nullifier key for this nk".into()))?;
    let proving = ProvingKeys::from_outgoing_keys(input.keys)?;

    let mut notes: BTreeMap<String, String> = BTreeMap::new();
    let mut receipts: BTreeMap<String, zeceipt_types::Receipt> = BTreeMap::new();
    let mut claims: Vec<Claim> = Vec::new();
    let mut nullifiers: Vec<(String, String)> = Vec::new(); // (note id, nullifier hex)
    let mut n = 0usize;
    // The challenge transaction listed among the others too (a scan finds it): it is the control, only.
    let has_control = input.control.is_some();
    let control_txid = match &input.control {
        Some((b, _)) => Some(txid_hex(&parse_transaction(b)?)),
        None => None,
    };
    let listed: Vec<Vec<u8>> = input
        .txs
        .into_iter()
        .filter(|b| {
            control_txid.is_none()
                || parse_transaction(b).map(|t| txid_hex(&t)).ok() != control_txid
        })
        .collect();
    let mut all: Vec<(Vec<u8>, Option<String>)> = spend_order(listed, &proving, &nkey, network)?
        .into_iter()
        .map(|b| (b, None))
        .collect();
    if let Some((b, nonce)) = input.control {
        all.push((b, Some(nonce)));
    }
    for (bytes, nonce) in &all {
        let tx = parse_transaction(bytes)?;
        let tx_nfs = tx_nullifiers(&tx);
        let spent: Vec<String> = nullifiers
            .iter()
            .filter(|(_, nf)| tx_nfs.contains(nf))
            .map(|(id, _)| id.clone())
            .collect();
        let found = prove_with(bytes, &proving)?;
        // A challenge answer explained as an ordinary transaction would disclose its change, which the control claim
        // keeps back (spec §6.2): with no control given, refuse it, and say how to list it. With one, an earlier
        // challenge's answer is history like any other transaction (its funds moved on into the new challenge).
        if nonce.is_none() && !has_control {
            if let Some(f) = found.iter().find(|f| {
                f.side != Side::Sent
                    && memo_text(&f.delivered.recovered.memo).starts_with(CHALLENGE_PREFIX)
            }) {
                return Err(crate::CoreError::Malformed(format!(
                    "transaction {} answers a challenge (a memo reads {:?}): give it as the control transaction with that nonce, not in the list, or its change would be disclosed",
                    txid_hex(&tx),
                    memo_text(&f.delivered.recovered.memo)
                )));
            }
        }
        let mut created: Vec<(String, String)> = Vec::new(); // (id, memo)
                                                             // Minimal disclosure: in the challenge transaction only the reply note (its memo carries the nonce).
        let wanted = |f: &&crate::delivery::Found| {
            f.side != Side::Sent
                && nonce
                    .as_ref()
                    .is_none_or(|n| memo_text(&f.delivered.recovered.memo).contains(n.trim()))
        };
        for f in found.iter().filter(wanted) {
            n += 1;
            let id = format!("n{n}");
            let (_, note) = check_note(bytes, &f.proof, network)?;
            nullifiers.push((id.clone(), hex::encode(note.nullifier(&nkey).to_bytes())));
            notes.insert(id.clone(), f.proof.encode());
            created.push((id, memo_text(&f.delivered.recovered.memo)));
        }
        match nonce {
            Some(nonce) => {
                let reply = created
                    .iter()
                    .find(|(_, m)| m.contains(nonce.trim()))
                    .ok_or_else(|| crate::CoreError::Malformed("the challenge transaction pays the holder no note whose memo carries the nonce".into()))?;
                if spent.is_empty() {
                    return Err(crate::CoreError::Malformed("the challenge transaction spends none of the disclosed notes: list the transactions that created the notes it spends".into()));
                }
                claims.push(Claim::Control {
                    nonce: nonce.clone(),
                    reply: reply.0.clone(),
                    spent: spent.clone(),
                });
            }
            None if spent.is_empty() => {
                claims.extend(
                    created
                        .iter()
                        .map(|(id, _)| Claim::Origin { note: id.clone() }),
                );
            }
            None => {
                for (to, _) in &created {
                    for from in &spent {
                        claims.push(Claim::Path {
                            from: from.clone(),
                            to: to.clone(),
                        });
                    }
                }
            }
        }
        if nonce.is_none() && !spent.is_empty() {
            let opts = IssueOptions {
                label: String::new(),
                challenge: None,
                key_id: None,
                include_change: false,
                signer: None,
            };
            for (r, _) in issue(&tx, input.keys, &opts)? {
                let id = format!("r{}", receipts.len() + 1);
                claims.push(Claim::Deposit {
                    receipt: id.clone(),
                    funded_by: spent.clone(),
                });
                receipts.insert(id, r);
            }
            // Payments to transparent addresses (an exchange's deposit address): no receipt is needed, the output
            // is public; the spent notes tie it to the holder.
            let vouts = tx.transparent_bundle().map_or(0, |b| b.vout.len());
            for output in 0..vouts as u32 {
                claims.push(Claim::TransparentPayment {
                    tx: txid_hex(&tx),
                    output,
                    funded_by: spent.clone(),
                });
            }
        }
    }
    if claims.is_empty() {
        return Err(crate::CoreError::Malformed(
            "none of these transactions pays or spends a note this key can see".into(),
        ));
    }
    let d = Dossier {
        version: zeceipt_types::dossier::DOSSIER_VERSION.into(),
        network,
        created: input.created,
        subject: input.subject,
        nk: Some(hex::encode(nk)),
        notes,
        receipts,
        claims,
    };
    d.validate()?;
    Ok(d)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_output_script_names_the_address_it_pays() {
        // hash160 of the secp256k1 generator's compressed key, 751e76e8…3bd6, in a P2PKH script and a P2SH one.
        let h = hex::decode("751e76e8199196d454941c45d1b3a323f1433bd6").unwrap();
        let mut p2pkh = vec![0x76, 0xa9, 0x14];
        p2pkh.extend(&h);
        p2pkh.extend([0x88, 0xac]);
        let mut p2sh = vec![0xa9, 0x14];
        p2sh.extend(&h);
        p2sh.push(0x87);
        let (a, b) = (
            script_address(&p2pkh, Network::Main).unwrap(),
            script_address(&p2pkh, Network::Test).unwrap(),
        );
        assert!(a.starts_with("t1") && b.starts_with("tm"), "{a} {b}");
        assert!(script_address(&p2sh, Network::Main)
            .unwrap()
            .starts_with("t3"));
        // Anything else names nothing: OP_RETURN, a truncated P2PKH, a 21-byte hash.
        assert!(script_address(&[0x6a, 0x01, 0x00], Network::Main).is_none());
        assert!(script_address(&p2pkh[..24], Network::Main).is_none());
        let mut long = vec![0xa9, 0x15];
        long.extend([0u8; 21]);
        long.push(0x87);
        assert!(script_address(&long, Network::Main).is_none());
    }

    #[test]
    fn nullifier_key_accepts_any_nk_we_tried() {
        for i in 0u8..64 {
            let mut nk = [i; 32];
            nk[31] &= 0x3f; // a canonical Pallas base field element
            assert!(nullifier_key(nk).is_some(), "nk {i}");
        }
    }
}

/// One Orchard-family action of a compact block (lightwalletd `CompactOrchardAction`, for the Ironwood or the Orchard
/// pool): enough to trial-decrypt it and to see which note it spends.
#[derive(Debug, Clone)]
pub struct CompactActionData {
    pub nullifier: [u8; 32],
    pub cmx: [u8; 32],
    pub ephemeral_key: [u8; 32],
    pub ciphertext: [u8; 52],
}

/// A transaction of the holder's, found by `WalletScanner`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct FoundTx {
    pub height: u64,
    pub txid: String,
    /// Notes this transaction paid the holder (received or change).
    pub received: usize,
    /// The holder's notes it spent.
    pub spent: usize,
}

/// Finds the holder's transactions in compact blocks (spec/dossier-v1.md §6, "finding the transactions"): it
/// trial-decrypts every Orchard-family action with the account's incoming viewing keys (both scopes), and derives each
/// found note's nullifier with `nk` to see where it is spent. Compact decryption opens the note plaintext's first 52
/// bytes, which carry the value and rseed, so the note, and so its nullifier, is known without the full transaction.
pub struct WalletScanner {
    ivks: Vec<(
        orchard::keys::PreparedIncomingViewingKey,
        orchard::keys::Scope,
    )>,
    nk_key: FullViewingKey,
    fvk: FullViewingKey,
    own: HashMap<[u8; 32], ()>,
    found: Vec<FoundTx>,
}

impl WalletScanner {
    pub fn new(keys: &crate::OutgoingKeys) -> Result<Self, crate::CoreError> {
        use orchard::keys::{PreparedIncomingViewingKey, Scope};
        let fvk = keys
            .orchard_fvk
            .clone()
            .ok_or(crate::CoreError::MissingKey("Orchard full viewing"))?;
        let nk: [u8; 32] = fvk.to_bytes()[32..64].try_into().expect("32 bytes");
        let nk_key = nullifier_key(nk)
            .ok_or_else(|| crate::CoreError::KeyDecode("no nullifier key for this nk".into()))?;
        let ivks = [Scope::External, Scope::Internal]
            .into_iter()
            .map(|s| (PreparedIncomingViewingKey::new(&fvk.to_ivk(s)), s))
            .collect();
        Ok(WalletScanner {
            ivks,
            nk_key,
            fvk,
            own: HashMap::new(),
            found: Vec::new(),
        })
    }

    /// Trial-decrypt compact actions with both scopes' incoming viewing keys, in one batch: the batch shares the
    /// expensive part of key agreement across actions, which is most of a scan's time in 2022–23's spam blocks.
    /// `ironwood` selects the note encryption domain (Ironwood's note plaintext version differs from Orchard's).
    fn decrypt(
        &self,
        actions: &[&CompactActionData],
        ironwood: bool,
    ) -> Vec<Option<orchard::Note>> {
        use orchard::note::{ExtractedNoteCommitment, Nullifier};
        use orchard::note_encryption::{CompactAction, IronwoodVersion, OrchardVersion};
        use zcash_note_encryption::{batch, EphemeralKeyBytes};
        let ivks: Vec<orchard::keys::PreparedIncomingViewingKey> =
            self.ivks.iter().map(|(k, _)| k.clone()).collect();
        // Actions whose nullifier or commitment is not a valid encoding cannot be the holder's: they are skipped.
        let parsed: Vec<(usize, CompactAction)> = actions
            .iter()
            .enumerate()
            .filter_map(|(k, a)| {
                let nf = Option::<Nullifier>::from(Nullifier::from_bytes(&a.nullifier))?;
                let cmx = Option::<ExtractedNoteCommitment>::from(
                    ExtractedNoteCommitment::from_bytes(&a.cmx),
                )?;
                Some((
                    k,
                    CompactAction::from_parts(
                        nf,
                        cmx,
                        EphemeralKeyBytes(a.ephemeral_key),
                        a.ciphertext,
                    ),
                ))
            })
            .collect();
        let mut out = vec![None; actions.len()];
        if ironwood {
            let batch_in: Vec<_> = parsed
                .iter()
                .map(|(_, a)| {
                    (
                        NoteEncryptionDomain::<IronwoodVersion>::for_compact_action(a),
                        a.clone(),
                    )
                })
                .collect();
            for ((k, _), r) in parsed
                .iter()
                .zip(batch::try_compact_note_decryption(&ivks, &batch_in))
            {
                out[*k] = r.map(|((n, _), _)| n);
            }
        } else {
            let batch_in: Vec<_> = parsed
                .iter()
                .map(|(_, a)| {
                    (
                        NoteEncryptionDomain::<OrchardVersion>::for_compact_action(a),
                        a.clone(),
                    )
                })
                .collect();
            for ((k, _), r) in parsed
                .iter()
                .zip(batch::try_compact_note_decryption(&ivks, &batch_in))
            {
                out[*k] = r.map(|((n, _), _)| n);
            }
        }
        out
    }

    /// Count one transaction's spends of the holder's notes (before the notes it pays them, so a note received and
    /// spent in one block is seen in order) and record the notes it pays them.
    fn record(
        &mut self,
        height: u64,
        txid: &str,
        actions: &[&CompactActionData],
        notes: &[Option<orchard::Note>],
    ) {
        let spent = actions
            .iter()
            .filter(|a| self.own.contains_key(&a.nullifier))
            .count();
        let mut received = 0;
        for n in notes.iter().flatten() {
            received += 1;
            self.own.insert(n.nullifier(&self.nk_key).to_bytes(), ());
            debug_assert_eq!(n.nullifier(&self.nk_key), n.nullifier(&self.fvk));
        }
        if received + spent > 0 {
            self.found.push(FoundTx {
                height,
                txid: txid.to_string(),
                received,
                spent,
            });
        }
    }

    /// Scan one transaction's compact actions of one pool (`ironwood`: the Ironwood pool, else Orchard).
    pub fn scan_tx(
        &mut self,
        height: u64,
        txid: &str,
        actions: &[CompactActionData],
        ironwood: bool,
    ) {
        let refs: Vec<&CompactActionData> = actions.iter().collect();
        let notes = self.decrypt(&refs, ironwood);
        self.record(height, txid, &refs, &notes);
    }

    /// The holder's transactions found so far, in chain order.
    pub fn found(&self) -> &[FoundTx] {
        &self.found
    }

    /// Scan one serialized lightwalletd `CompactBlock` (a protobuf message, as a gRPC-web stream carries it), and return
    /// its height. The browser has no protobuf library here, so the few fields a scan needs are read directly:
    /// `CompactBlock.height` (2) and `vtx` (7); `CompactTx.txid` (2), `actions` (6, Orchard) and `ironwood_actions` (9);
    /// `CompactOrchardAction` `nullifier` (1), `cmx` (2), `ephemeralKey` (3), `ciphertext` (4). Everything else is skipped.
    pub fn scan_compact_block(&mut self, bytes: &[u8]) -> Result<u64, crate::CoreError> {
        let bad = |what: &str| crate::CoreError::Malformed(format!("compact block: {what}"));
        let mut height = 0u64;
        let mut txs: Vec<&[u8]> = Vec::new();
        for f in proto_fields(bytes).ok_or_else(|| bad("not a protobuf message"))? {
            match f {
                (2, ProtoValue::Varint(h)) => height = h,
                (7, ProtoValue::Bytes(b)) => txs.push(b),
                _ => {}
            }
        }
        let mut parsed: Vec<(String, Vec<CompactActionData>, Vec<CompactActionData>)> = Vec::new();
        for tx in txs {
            let (mut txid, mut orchard, mut ironwood) = (String::new(), Vec::new(), Vec::new());
            for f in
                proto_fields(tx).ok_or_else(|| bad("a transaction is not a protobuf message"))?
            {
                match f {
                    (2, ProtoValue::Bytes(b)) => {
                        let mut id = b.to_vec();
                        id.reverse();
                        txid = hex::encode(id);
                    }
                    (6, ProtoValue::Bytes(a)) => orchard.extend(compact_action(a)),
                    (9, ProtoValue::Bytes(a)) => ironwood.extend(compact_action(a)),
                    _ => {}
                }
            }
            parsed.push((txid, ironwood, orchard));
        }
        self.scan_block_txs(height, &parsed);
        Ok(height)
    }

    /// Scan one block's transactions, each `(txid, Ironwood actions, Orchard actions)`, in block order: one batch
    /// decryption per pool for the whole block, then the transactions in order.
    pub fn scan_block_txs(
        &mut self,
        height: u64,
        parsed: &[(String, Vec<CompactActionData>, Vec<CompactActionData>)],
    ) {
        let iw: Vec<&CompactActionData> = parsed.iter().flat_map(|t| &t.1).collect();
        let or: Vec<&CompactActionData> = parsed.iter().flat_map(|t| &t.2).collect();
        let (iw_notes, or_notes) = (self.decrypt(&iw, true), self.decrypt(&or, false));
        let (mut i, mut o) = (0, 0);
        for (txid, ironwood, orchard) in parsed {
            if !ironwood.is_empty() {
                let refs: Vec<&CompactActionData> = ironwood.iter().collect();
                self.record(height, txid, &refs, &iw_notes[i..i + ironwood.len()]);
                i += ironwood.len();
            }
            if !orchard.is_empty() {
                let refs: Vec<&CompactActionData> = orchard.iter().collect();
                self.record(height, txid, &refs, &or_notes[o..o + orchard.len()]);
                o += orchard.len();
            }
        }
    }
}

/// A serialized lightwalletd `CompactBlock`'s height, hash (display hex) and time: what a beacon nonce names, for a
/// browser that fetched the block with `GetBlock`.
pub fn compact_block_id(bytes: &[u8]) -> Option<(u64, String, u32)> {
    let (mut height, mut hash, mut time) = (None, None, 0u32);
    for f in proto_fields(bytes)? {
        match f {
            (2, ProtoValue::Varint(h)) => height = Some(h),
            (3, ProtoValue::Bytes(b)) if b.len() == 32 => {
                let mut h = b.to_vec();
                h.reverse();
                hash = Some(hex::encode(h));
            }
            (5, ProtoValue::Varint(t)) => time = u32::try_from(t).ok()?,
            _ => {}
        }
    }
    Some((height?, hash?, time))
}

/// A protobuf field value, as far as a compact block needs: varints and length-delimited bytes.
enum ProtoValue<'a> {
    Varint(u64),
    Bytes(&'a [u8]),
}

/// A protobuf message's fields in order; `None` if it does not parse (wire types 1 and 5 are skipped by width).
fn proto_fields(mut b: &[u8]) -> Option<Vec<(u32, ProtoValue<'_>)>> {
    fn varint(b: &mut &[u8]) -> Option<u64> {
        let mut v = 0u64;
        for i in 0..10 {
            let (&byte, rest) = b.split_first()?;
            *b = rest;
            v |= u64::from(byte & 0x7f) << (7 * i);
            if byte & 0x80 == 0 {
                return Some(v);
            }
        }
        None
    }
    let mut out = Vec::new();
    while !b.is_empty() {
        let key = varint(&mut b)?;
        let (field, wire) = (u32::try_from(key >> 3).ok()?, key & 7);
        match wire {
            0 => out.push((field, ProtoValue::Varint(varint(&mut b)?))),
            2 => {
                let len = usize::try_from(varint(&mut b)?).ok()?;
                let (v, rest) = (b.get(..len)?, b.get(len..)?);
                b = rest;
                out.push((field, ProtoValue::Bytes(v)));
            }
            1 => b = b.get(8..)?,
            5 => b = b.get(4..)?,
            _ => return None,
        }
    }
    Some(out)
}

/// A `CompactOrchardAction`, when all four fields have their sizes.
fn compact_action(b: &[u8]) -> Option<CompactActionData> {
    let (mut nf, mut cmx, mut epk, mut ct) = (None, None, None, None);
    for f in proto_fields(b)? {
        if let (n, ProtoValue::Bytes(v)) = f {
            match n {
                1 => nf = v.try_into().ok(),
                2 => cmx = v.try_into().ok(),
                3 => epk = v.try_into().ok(),
                4 => ct = v.try_into().ok(),
                _ => {}
            }
        }
    }
    Some(CompactActionData {
        nullifier: nf?,
        cmx: cmx?,
        ephemeral_key: epk?,
        ciphertext: ct?,
    })
}

use orchard::note_encryption::NoteEncryptionDomain;
