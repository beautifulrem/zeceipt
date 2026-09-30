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
use orchard::Note;
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
    Failed,
    NotChecked,
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
    /// Why the note could not be opened, if it could not.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// A transparent input of a funding transaction.
#[derive(Debug, Clone, Serialize)]
pub struct TransparentInput {
    /// The output it spends, `txid:index`.
    pub prevout: String,
    /// The P2PKH address whose key signed it, when the input is a standard P2PKH spend.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub address: Option<String>,
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
    /// For control and deposit claims: the value the spent disclosed notes carried.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value_zat: Option<u64>,
}

/// The whole report.
#[derive(Debug, Clone, Serialize)]
pub struct Report {
    pub version: &'static str,
    pub network: Network,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subject: Option<String>,
    /// sha256 of the dossier as given (hex), for a case file.
    pub dossier_sha256: String,
    pub notes: BTreeMap<String, NoteFact>,
    pub claims: Vec<ClaimResult>,
    /// Every claim verified.
    pub all_verified: bool,
    /// What the holder disclosed by handing this dossier over.
    pub disclosed: Vec<String>,
    /// What no claim here proves.
    pub does_not_prove: Vec<&'static str>,
}

pub const REPORT_VERSION: &str = "zeceipt-dossier-report-v1";

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
    v.sort();
    v.dedup();
    v
}

/// What funded `tx`: its transparent inputs (with the P2PKH address that signed each, when standard) and shielded
/// spends, and which disclosed notes it spends.
fn funding(tx: &Transaction, network: Network, spent_by: &[String]) -> Funding {
    let mut transparent_inputs = Vec::new();
    if let Some(b) = tx.transparent_bundle() {
        for i in &b.vin {
            let mut raw = Vec::new();
            let _ = i.write(&mut raw);
            let mut prev = [0u8; 32];
            prev.copy_from_slice(&raw[..32]);
            prev.reverse();
            let n = u32::from_le_bytes([raw[32], raw[33], raw[34], raw[35]]);
            transparent_inputs.push(TransparentInput {
                prevout: format!("{}:{n}", hex::encode(prev)),
                address: p2pkh_signer(&raw[36..], network),
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

/// The address of a standard P2PKH `scriptSig` (`<sig> <33- or 65-byte pubkey>`), from a serialized input's script
/// (CompactSize length, then the script, then the sequence).
fn p2pkh_signer(after_prevout: &[u8], network: Network) -> Option<String> {
    let (len, rest) = compact_size(after_prevout)?;
    let script = rest.get(..len)?;
    let (sig_len, rest) = (*script.first()? as usize, &script[1..]);
    if !(9..=75).contains(&sig_len) {
        return None;
    }
    let rest = rest.get(sig_len..)?;
    let (pk_len, pk) = (*rest.first()? as usize, &rest[1..]);
    if !(pk_len == 33 || pk_len == 65) || pk.len() != pk_len {
        return None;
    }
    let sha = sha2::Sha256::digest(pk);
    let h: [u8; 20] = ripemd::Ripemd160::digest(sha).into();
    let addr = zcash_transparent::address::TransparentAddress::PublicKeyHash(h);
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

fn zec(zat: u64) -> String {
    format!("{}.{:08}", zat / 100_000_000, zat % 100_000_000)
}

/// Check every claim of `d` against `txs` (txid → bytes and height). `raw` is the dossier text as given, hashed into the
/// report.
pub fn check_dossier(d: &Dossier, raw: &str, txs: &HashMap<String, TxData>) -> Report {
    let nk_key = d.nk_bytes().and_then(nullifier_key);
    let mut notes: BTreeMap<String, NoteFact> = BTreeMap::new();
    let mut opened: HashMap<String, Note> = HashMap::new();
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
            error: None,
        };
        match txs.get(&txid) {
            None => fact.error = Some("its transaction was not supplied".into()),
            Some(t) => {
                fact.height = t.height;
                match check_note(&t.bytes, p, d.network) {
                    Ok((del, note)) => {
                        fact.recipient = Some(del.recovered.recipient);
                        fact.value_zat = Some(del.recovered.value_zat);
                        fact.memo = Some(memo_text(&del.recovered.memo));
                        if let Some(k) = &nk_key {
                            fact.nullifier = Some(hex::encode(note.nullifier(k).to_bytes()));
                        }
                        opened.insert(id.clone(), note);
                    }
                    Err(e) => fact.error = Some(e.to_string()),
                }
            }
        }
        notes.insert(id.clone(), fact);
    }
    // Every disclosed nullifier, to report which disclosed notes a transaction spends.
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
    let note_ok = |id: &str| notes.get(id).is_some_and(|f| f.error.is_none());
    let note_err = |id: &str| -> String {
        notes
            .get(id)
            .and_then(|f| f.error.clone())
            .unwrap_or_else(|| "not disclosed".into())
    };
    let value = |id: &str| notes.get(id).and_then(|f| f.value_zat).unwrap_or(0);

    let mut claims = Vec::new();
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
        };
        match c {
            Claim::Origin { note } => {
                if !note_ok(note) {
                    r.summary = format!("Note {note} does not open: {}", note_err(note));
                } else {
                    let f = &notes[note];
                    let tx = parsed(&f.txid).expect("opened, so parsed");
                    let funding = funding(&tx, d.network, &spends_in(&tx));
                    let from = if !funding.from_disclosed.is_empty() {
                        format!(
                            "from disclosed note{} {}",
                            if funding.from_disclosed.len() > 1 {
                                "s"
                            } else {
                                ""
                            },
                            funding.from_disclosed.join(", ")
                        )
                    } else if !funding.transparent_inputs.is_empty() {
                        let addrs: Vec<String> = funding
                            .transparent_inputs
                            .iter()
                            .filter_map(|i| i.address.clone())
                            .collect();
                        format!(
                            "from {} transparent input{}{}",
                            funding.transparent_inputs.len(),
                            if funding.transparent_inputs.len() > 1 {
                                "s"
                            } else {
                                ""
                            },
                            if addrs.is_empty() {
                                String::new()
                            } else {
                                format!(" signed by {}", dedup(addrs).join(", "))
                            }
                        )
                    } else {
                        "from shielded funds of an undisclosed sender".into()
                    };
                    r.status = Status::Verified;
                    r.summary = format!(
                        "{} ZEC reached the holder in {}{}, {from}.",
                        zec(value(note)),
                        short(&f.txid),
                        f.height
                            .map(|h| format!(" at height {h}"))
                            .unwrap_or_default()
                    );
                    r.funding = Some(funding);
                }
            }
            Claim::Path { from, to } => {
                if !note_ok(from) || !note_ok(to) {
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
                            "{} ZEC in {from} was spent in {}, which created {to} ({} ZEC).",
                            zec(value(from)),
                            short(&notes[to].txid),
                            zec(value(to))
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
                    } else {
                        r.summary = format!("{from}'s nullifier is not among {}'s spends: that transaction did not spend it (or nk is not the holder's).", short(&notes[to].txid));
                    }
                }
            }
            Claim::Deposit { receipt, funded_by } => {
                let rc = &d.receipts[receipt];
                match txs
                    .get(&rc.txid.to_lowercase())
                    .map(|t| (t, parse_transaction(&t.bytes)))
                {
                    None => {
                        r.status = Status::NotChecked;
                        r.summary =
                            format!("The transaction of receipt {receipt} was not supplied.");
                    }
                    Some((_, Err(e))) => {
                        r.summary = format!("Receipt {receipt}'s transaction does not parse: {e}")
                    }
                    Some((t, Ok(tx))) => match verify(rc, &tx, b"", false) {
                        Err(e) => r.summary = format!("Receipt {receipt} does not verify: {e}"),
                        Ok(v) => {
                            let spent = spends_in(&tx);
                            let missing: Vec<&String> =
                                funded_by.iter().filter(|n| !spent.contains(n)).collect();
                            let paid = format!(
                                "The holder paid {} ZEC to {} (memo \"{}\") in {}{}",
                                zec(v.recovered.value_zat),
                                v.recovered.recipient,
                                memo_text(&v.recovered.memo),
                                short(&v.txid),
                                t.height
                                    .map(|h| format!(" at height {h}"))
                                    .unwrap_or_default()
                            );
                            r.value_zat = Some(v.recovered.value_zat);
                            if !missing.is_empty() {
                                r.summary = format!("{paid}, but not from {}: their nullifiers are not among its spends.", missing.iter().map(|s| s.as_str()).collect::<Vec<_>>().join(", "));
                            } else {
                                r.status = Status::Verified;
                                r.summary = if funded_by.is_empty() {
                                    format!("{paid}.")
                                } else {
                                    format!(
                                        "{paid}, from {} ({} ZEC disclosed).",
                                        funded_by.join(", "),
                                        zec(funded_by.iter().map(|n| value(n)).sum())
                                    )
                                };
                            }
                            if let Some(pk) = v.issuer_pubkey {
                                r.details
                                    .push(format!("The receipt is signed by key {pk}."));
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
                if !bad.is_empty() {
                    r.summary = format!(
                        "Notes do not open: {}",
                        bad.iter()
                            .map(|n| format!("{n}: {}", note_err(n)))
                            .collect::<Vec<_>>()
                            .join("; ")
                    );
                } else {
                    let f = &notes[reply];
                    let in_mempool = txs.get(&f.txid).is_some_and(|t| t.mempool);
                    let tx = parsed(&f.txid).expect("opened, so parsed");
                    let spends = spends_in(&tx);
                    let missing: Vec<&String> =
                        spent.iter().filter(|n| !spends.contains(n)).collect();
                    let memo = f.memo.clone().unwrap_or_default();
                    let total: u64 = spent.iter().map(|n| value(n)).sum();
                    r.value_zat = Some(total);
                    if !memo.contains(nonce.trim()) {
                        r.summary = format!(
                            "The reply note's memo does not carry the nonce (it reads \"{memo}\")."
                        );
                    } else if !missing.is_empty() {
                        r.summary = format!(
                            "The challenge transaction does not spend {}.",
                            missing
                                .iter()
                                .map(|s| s.as_str())
                                .collect::<Vec<_>>()
                                .join(", ")
                        );
                    } else {
                        r.status = Status::Verified;
                        r.summary = format!(
                            "The holder spent {} ({} ZEC) in {}{}, answering the nonce: they could spend these funds after the nonce was issued.",
                            spent.join(", "),
                            zec(total),
                            short(&f.txid),
                            f.height.map(|h| format!(" at height {h}")).unwrap_or_default()
                        );
                        if in_mempool {
                            r.status = Status::NotChecked;
                            r.details.push("The challenge transaction is in the mempool, not mined yet: check again once it is.".into());
                        } else if f.height.is_none() {
                            r.details.push("The challenge transaction was loaded from a file: its inclusion in the chain was not checked here.".into());
                        }
                    }
                }
            }
        }
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
    Report {
        version: REPORT_VERSION,
        network: d.network,
        subject: d.subject.clone(),
        dossier_sha256: hex::encode(sha2::Sha256::digest(raw.as_bytes())),
        all_verified: claims.iter().all(|c| c.status == Status::Verified),
        notes,
        claims,
        disclosed,
        does_not_prove: DOES_NOT_PROVE.to_vec(),
    }
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
    let mut all: Vec<(Vec<u8>, Option<String>)> =
        input.txs.into_iter().map(|b| (b, None)).collect();
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
    fn a_p2pkh_script_sig_names_its_signers_address() {
        // The secp256k1 generator's compressed key: its hash160 is the well-known 751e76e8…3bd6.
        let pk = hex::decode("0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798")
            .unwrap();
        let mut script = vec![71u8];
        script.extend([0x30; 71]);
        script.push(33);
        script.extend(&pk);
        let mut input = vec![script.len() as u8];
        input.extend(&script);
        input.extend([0xff; 4]);
        let main = p2pkh_signer(&input, Network::Main).unwrap();
        let test = p2pkh_signer(&input, Network::Test).unwrap();
        assert!(
            main.starts_with("t1") && test.starts_with("tm"),
            "{main} {test}"
        );
        let h: [u8; 20] = ripemd::Ripemd160::digest(sha2::Sha256::digest(&pk)).into();
        assert_eq!(hex::encode(h), "751e76e8199196d454941c45d1b3a323f1433bd6");
        // Not P2PKH: a bare 1-byte script, a key of the wrong length.
        assert!(p2pkh_signer(&[1, 0x51, 0, 0, 0, 0], Network::Main).is_none());
        let mut bad = input.clone();
        bad[1 + 1 + 71] = 32;
        assert!(p2pkh_signer(&bad, Network::Main).is_none());
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
