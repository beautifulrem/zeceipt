//! `zeceipt` — issue and verify per-output receipts for shielded Zcash payments.
//!
//! Exit codes: 0 valid / success, 1 invalid receipt, 2 pending (transaction not
//! found or unconfirmed), 3 usage or configuration error.
#![forbid(unsafe_code)]

use std::path::PathBuf;
use std::process::ExitCode;

use anyhow::{anyhow, Context};
use clap::{Args, Parser, Subcommand};
use rand::rngs::OsRng;
use serde_json::json;
use zeceipt_core::zeceipt_types::ed25519_dalek::SigningKey;
use zeceipt_core::zeceipt_types::{AuditPack, Network, Receipt, TypesError};
use zeceipt_core::{CoreError, IssueOptions, OutgoingKeys};
use zeceipt_lwd::{Client, LwdError};

#[derive(Parser)]
#[command(
    name = "zeceipt",
    version,
    about = "Verifiable receipts for shielded Zcash payments (ZIP 311 outputs subset, Ironwood-native)"
)]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Args, Clone)]
struct NetArgs {
    /// Use the Zcash testnet.
    #[arg(long, global = true)]
    testnet: bool,
    /// Use a local regtest chain (requires --endpoint).
    #[arg(long, global = true, conflicts_with = "testnet")]
    regtest: bool,
    /// lightwalletd/Zaino endpoint(s); defaults to public zec.rocks nodes.
    #[arg(long, global = true)]
    endpoint: Vec<String>,
}

#[derive(Args, Clone)]
struct TxSource {
    /// Transaction id (display order hex). Fetched from the endpoint unless --raw-tx-file is given.
    #[arg(long)]
    txid: Option<String>,
    /// Raw transaction hex file (offline mode).
    #[arg(long)]
    raw_tx_file: Option<PathBuf>,
}

#[derive(Subcommand)]
// Parsed once per process; boxing the larger `Issue` variant would only add noise.
#[allow(clippy::large_enum_variant)]
enum Cmd {
    /// Generate an issuer signing key (ed25519) and print the public key.
    Keygen {
        /// Where to write the 32-byte secret key (hex). Created with mode 0600.
        #[arg(long, default_value = "issuer.key")]
        out: PathBuf,
    },
    /// List the shielded outputs of a transaction.
    Inspect {
        #[command(flatten)]
        net: NetArgs,
        #[command(flatten)]
        tx: TxSource,
    },
    /// Issue receipts for every output the viewing key can open.
    Issue {
        #[command(flatten)]
        net: NetArgs,
        #[command(flatten)]
        tx: TxSource,
        /// Unified full viewing key (uview1… / uviewtest1…).
        #[arg(long, conflicts_with = "ovk")]
        ufvk: Option<String>,
        /// Read the unified full viewing key from a file (keeps it off the process list).
        #[arg(long, conflicts_with_all = ["ufvk", "ovk"])]
        ufvk_file: Option<PathBuf>,
        /// Bare Orchard/Ironwood outgoing viewing key, 32 bytes hex.
        #[arg(long)]
        ovk: Option<String>,
        /// Label stored (and signed) in every receipt, e.g. "INV-2026-042 | 150.00 USD @ 1518.81".
        #[arg(long, default_value = "")]
        label: String,
        /// Verifier-supplied challenge (UTF-8) to bind into the receipts.
        #[arg(long)]
        challenge: Option<String>,
        /// Issuer secret key file from `keygen`; receipts are unsigned without it.
        #[arg(long)]
        key_file: Option<PathBuf>,
        /// Key id published in the issuer's well-known file.
        #[arg(long)]
        key_id: Option<String>,
        /// Also issue receipts for change outputs (outputs paying one of the issuer's own addresses).
        #[arg(long)]
        include_change: bool,
        /// Only issue for outputs paying one of these addresses (repeatable). Matching is by
        /// shielded receiver, so any unified address containing the paid receiver matches.
        #[arg(long = "only-to", value_name = "ADDRESS")]
        only_to: Vec<String>,
        /// Site that serves the receipt page; each receipt's link is `<host>/r#<payload>`. No
        /// default: the page that host serves can read the fragment, so only a host you control
        /// is safe. Without it receipts are still issued, with `"url": null`.
        #[arg(long)]
        host: Option<String>,
        /// Write one JSON file per receipt into this directory.
        #[arg(long)]
        out_dir: Option<PathBuf>,
    },
    /// Verify a receipt (JSON, URL, or base64url payload; `-` reads stdin).
    Verify {
        #[command(flatten)]
        net: NetArgs,
        /// Receipt input.
        receipt: String,
        /// Expected challenge (UTF-8) if the receipt was issued with one.
        #[arg(long)]
        challenge: Option<String>,
        /// Raw transaction hex file (offline mode).
        #[arg(long)]
        raw_tx_file: Option<PathBuf>,
        /// Fail if the receipt is unsigned.
        #[arg(long)]
        require_signature: bool,
    },
    /// Combine receipt files into an audit pack.
    Pack {
        #[arg(long)]
        title: String,
        /// Declared total in zatoshi (informational).
        #[arg(long, default_value_t = 0)]
        declared_total_zat: u64,
        /// Receipt JSON files.
        files: Vec<PathBuf>,
    },
    /// Verify every receipt in an audit pack and report the recovered total (a lower bound).
    VerifyPack {
        #[command(flatten)]
        net: NetArgs,
        pack: PathBuf,
        #[arg(long)]
        require_signature: bool,
        /// Directory containing `<txid>.hex` raw transactions (offline mode).
        #[arg(long)]
        raw_tx_dir: Option<PathBuf>,
        /// Expected challenge bound into the receipts (UTF-8), if any.
        #[arg(long)]
        challenge: Option<String>,
    },
    /// Find recent transactions with Ironwood actions (for fixtures and demos).
    FindIronwood {
        #[command(flatten)]
        net: NetArgs,
        /// How many blocks back from the tip to scan.
        #[arg(long, default_value_t = 20)]
        blocks: u64,
    },
}

#[tokio::main]
async fn main() -> ExitCode {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive("info".parse().expect("static")),
        )
        .with_writer(std::io::stderr)
        .init();
    match run().await {
        Ok(code) => code,
        Err(e) => {
            eprintln!("error: {e:#}");
            ExitCode::from(3)
        }
    }
}

async fn run() -> anyhow::Result<ExitCode> {
    let cli = match Cli::try_parse() {
        Ok(c) => c,
        Err(e) => {
            // clap exits 2 by default; keep 2 reserved for "pending" (PRD R7).
            let _ = e.print();
            return Ok(ExitCode::from(if e.use_stderr() { 3 } else { 0 }));
        }
    };
    match cli.cmd {
        Cmd::Keygen { out } => {
            let key = SigningKey::generate(&mut OsRng);
            write_secret(&out, &hex::encode(key.to_bytes()))?;
            println!(
                "{}",
                json!({"issuer_pubkey": hex::encode(key.verifying_key().to_bytes()), "key_file": out})
            );
            Ok(ExitCode::SUCCESS)
        }
        Cmd::Inspect { net, tx } => {
            let (bytes, height) = load_tx(&net, &tx).await?;
            let parsed = zeceipt_core::parse_transaction(&bytes)?;
            let outputs = zeceipt_core::enumerate_outputs(&parsed)
                .into_iter()
                .map(|o| json!({"pool": o.pool.as_str(), "index": o.index}))
                .collect::<Vec<_>>();
            println!(
                "{}",
                serde_json::to_string_pretty(&json!({
                    "txid": zeceipt_core::txid_hex(&parsed),
                    "version": format!("{:?}", parsed.version()),
                    "height": height,
                    "outputs": outputs,
                }))?
            );
            Ok(ExitCode::SUCCESS)
        }
        Cmd::Issue {
            net,
            tx,
            ufvk,
            ufvk_file,
            ovk,
            label,
            challenge,
            key_file,
            key_id,
            include_change,
            only_to,
            host,
            out_dir,
        } => {
            let network = network_of(&net);
            // Each allow-list entry keeps its own receivers so every receipt can report which
            // entries it pays (`matched_only_to`); callers match receipts to payees with it.
            let mut allowed: Vec<(&str, Vec<zeceipt_core::ShieldedReceiver>)> = Vec::new();
            for a in &only_to {
                let rs = zeceipt_core::shielded_receivers(a.trim(), network)
                    .map_err(|e| anyhow!("--only-to {a}: {e}"))?;
                if rs.is_empty() {
                    return Err(anyhow!("--only-to {a}: address has no shielded receiver"));
                }
                allowed.push((a.as_str(), rs));
            }
            let ufvk = match (ufvk, ufvk_file) {
                (Some(u), _) => Some(u),
                (None, Some(p)) => Some(
                    std::fs::read_to_string(&p)
                        .with_context(|| format!("reading --ufvk-file {}", p.display()))?,
                ),
                (None, None) => None,
            };
            let keys = match (ufvk, ovk) {
                (Some(u), _) => OutgoingKeys::from_ufvk(network, u.trim())?,
                (None, Some(o)) => {
                    let b = hex::decode(o.trim()).context("ovk must be hex")?;
                    let arr: [u8; 32] =
                        b.try_into().map_err(|_| anyhow!("ovk must be 32 bytes"))?;
                    OutgoingKeys::from_orchard_ovk(network, arr)
                }
                (None, None) => return Err(anyhow!("one of --ufvk or --ovk is required")),
            };
            let signer = match key_file {
                Some(p) => Some(read_secret(&p)?),
                None => None,
            };
            let (bytes, height) = load_tx(&net, &tx).await?;
            let parsed = zeceipt_core::parse_transaction(&bytes)?;
            let opts = IssueOptions {
                label,
                challenge: challenge.as_deref().map(str::as_bytes),
                key_id,
                include_change,
                signer: signer.as_ref(),
            };
            if !include_change && !keys.can_detect_change() {
                eprintln!(
                    "warning: a bare OVK cannot recognise change outputs; every opened output is issued (pass --ufvk to exclude change)"
                );
            }
            let mut receipts = zeceipt_core::issue(&parsed, &keys, &opts)?;
            let mut skipped = 0usize;
            let mut matched: Vec<Vec<&str>> = vec![Vec::new(); receipts.len()];
            if !only_to.is_empty() {
                let before = receipts.len();
                let mut kept = Vec::with_capacity(before);
                matched.clear();
                for (r, rec) in receipts {
                    let mut hits = Vec::new();
                    for (a, rs) in &allowed {
                        if zeceipt_core::pays_any(&rec, rs, network)? && !hits.contains(a) {
                            hits.push(*a);
                        }
                    }
                    if !hits.is_empty() {
                        kept.push((r, rec));
                        matched.push(hits);
                    }
                }
                skipped = before - kept.len();
                receipts = kept;
            }
            if receipts.is_empty() {
                eprintln!(
                    "no outputs of {} are opened by the given viewing key",
                    zeceipt_core::txid_hex(&parsed)
                );
                return Ok(ExitCode::from(1));
            }
            if let Some(dir) = &out_dir {
                std::fs::create_dir_all(dir)?;
            }
            if host.is_none() {
                eprintln!(
                    "no --host: receipts carry no link; pass --host with the site you control that serves the receipt page"
                );
            }
            let mut items = Vec::new();
            for ((r, rec), hits) in receipts.into_iter().zip(matched) {
                if let Some(dir) = &out_dir {
                    let path = dir.join(format!(
                        "{}-{}-{}.json",
                        &r.txid[..16],
                        r.pool.as_str(),
                        r.output_index
                    ));
                    std::fs::write(&path, r.to_json()?)?;
                }
                items.push(json!({
                    "receipt": r,
                    "url": host.as_deref().map(|h| r.to_url(h)).transpose()?,
                    "recovered": recovered_json(&rec, keys.can_detect_change()),
                    "matched_only_to": hits,
                }));
            }
            println!(
                "{}",
                serde_json::to_string_pretty(
                    &json!({"height": height, "receipts": items, "skipped_not_in_allow_list": skipped})
                )?
            );
            Ok(ExitCode::SUCCESS)
        }
        Cmd::Verify {
            net,
            receipt,
            challenge,
            raw_tx_file,
            require_signature,
        } => {
            let input = if receipt == "-" {
                let mut s = String::new();
                std::io::Read::read_to_string(&mut std::io::stdin(), &mut s)?;
                s
            } else if std::path::Path::new(&receipt).is_file() {
                std::fs::read_to_string(&receipt).with_context(|| format!("read {receipt}"))?
            } else {
                receipt
            };
            let r = match Receipt::parse(&input) {
                Ok(r) => r,
                Err(e) => {
                    println!(
                        "{}",
                        json!({"valid": false, "error": e.to_string(), "stage": "parse"})
                    );
                    return Ok(ExitCode::from(1));
                }
            };
            // An explicit --testnet is the operator's context; an unsigned receipt
            // cannot be trusted to name its own network, so contradictions are rejected.
            if (net.testnet || net.regtest) && matches!(r.network, Network::Main) {
                println!(
                    "{}",
                    json!({"valid": false, "error": "receipt says network=main but --testnet was given", "stage": "network"})
                );
                return Ok(ExitCode::from(1));
            }
            let net = NetArgs {
                testnet: matches!(r.network, Network::Test) || net.testnet,
                regtest: matches!(r.network, Network::Regtest) || net.regtest,
                endpoint: net.endpoint,
            };
            let src = TxSource {
                txid: Some(r.txid.clone()),
                raw_tx_file,
            };
            let (bytes, height) = match load_tx(&net, &src).await {
                Ok(v) => v,
                Err(e) => {
                    if is_pending(&e) {
                        println!(
                            "{}",
                            json!({"valid": null, "status": "pending", "error": e.to_string()})
                        );
                        return Ok(ExitCode::from(2));
                    }
                    return Err(e);
                }
            };
            let parsed = zeceipt_core::parse_transaction(&bytes)?;
            let expected = challenge.as_deref().unwrap_or("").as_bytes();
            match zeceipt_core::verify(&r, &parsed, expected, require_signature) {
                Ok(v) => {
                    println!(
                        "{}",
                        serde_json::to_string_pretty(&json!({
                            "valid": true,
                            "txid": v.txid,
                            "height": height,
                            "pool": v.recovered.pool.as_str(),
                            "output_index": v.recovered.index,
                            "recipient": v.recovered.recipient,
                            "value_zat": v.recovered.value_zat,
                            "value_zec": format_zec(v.recovered.value_zat),
                            "memo": memo_json(&v.recovered.memo),
                            "label": r.label,
                            "issuer_pubkey": v.issuer_pubkey,
                            "challenge_checked": v.challenge_checked,
                            "proves": "this transaction pays the shown value to the shown recipient with the shown memo; the issuer knew this output's OCK",
                            "does_not_prove": "who is presenting this receipt; anything about other outputs, transactions or balances",
                        }))?
                    );
                    Ok(ExitCode::SUCCESS)
                }
                Err(e) => {
                    println!(
                        "{}",
                        json!({"valid": false, "error": e.to_string(), "stage": stage(&e)})
                    );
                    Ok(ExitCode::from(1))
                }
            }
        }
        Cmd::Pack {
            title,
            declared_total_zat,
            files,
        } => {
            let mut receipts = Vec::new();
            for f in files {
                let s =
                    std::fs::read_to_string(&f).with_context(|| format!("read {}", f.display()))?;
                receipts.push(Receipt::parse(&s)?);
            }
            println!(
                "{}",
                AuditPack::new(title, receipts, declared_total_zat).to_json()?
            );
            Ok(ExitCode::SUCCESS)
        }
        Cmd::VerifyPack {
            net,
            pack,
            require_signature,
            raw_tx_dir,
            challenge,
        } => {
            let expected = challenge.unwrap_or_default();
            let p = AuditPack::from_json(&std::fs::read_to_string(&pack)?)?;
            let mut total = 0u64;
            let mut rows = Vec::new();
            let mut all_ok = true;
            for r in &p.receipts {
                let net = NetArgs {
                    testnet: matches!(r.network, Network::Test) || net.testnet,
                    regtest: matches!(r.network, Network::Regtest) || net.regtest,
                    endpoint: net.endpoint.clone(),
                };
                let raw_tx_file = raw_tx_dir
                    .as_ref()
                    .map(|d| d.join(format!("{}.hex", r.txid)));
                let src = TxSource {
                    txid: Some(r.txid.clone()),
                    raw_tx_file,
                };
                let outcome = match load_tx(&net, &src).await {
                    Ok((bytes, _)) => match zeceipt_core::parse_transaction(&bytes).and_then(|tx| {
                        zeceipt_core::verify(r, &tx, expected.as_bytes(), require_signature)
                    }) {
                        Ok(v) => {
                            total += v.recovered.value_zat;
                            json!({"txid": r.txid, "index": r.output_index, "valid": true, "recipient": v.recovered.recipient, "value_zat": v.recovered.value_zat, "label": r.label})
                        }
                        Err(e) => {
                            all_ok = false;
                            json!({"txid": r.txid, "index": r.output_index, "valid": false, "error": e.to_string()})
                        }
                    },
                    Err(e) => {
                        all_ok = false;
                        json!({"txid": r.txid, "index": r.output_index, "valid": false, "error": e.to_string()})
                    }
                };
                rows.push(outcome);
            }
            println!(
                "{}",
                serde_json::to_string_pretty(&json!({
                    "title": p.title,
                    "all_valid": all_ok,
                    "declared_total_zat": p.declared_total_zat,
                    "verified_total_zat": total,
                    "note": "verified total is a lower bound: receipts prove these payments exist, not that no others do",
                    "receipts": rows,
                }))?
            );
            Ok(if all_ok {
                ExitCode::SUCCESS
            } else {
                ExitCode::from(1)
            })
        }
        Cmd::FindIronwood { net, blocks } => {
            let mut client = connect(&net).await?;
            let tip = client.latest_height().await?;
            let start = tip.saturating_sub(blocks);
            let found = client.find_ironwood_txs(start, tip).await?;
            println!(
                "{}",
                serde_json::to_string_pretty(&json!({
                    "endpoint": client.endpoint(),
                    "tip": tip,
                    "scanned": [start, tip],
                    "transactions": found.iter().map(|(h, t)| json!({"height": h, "txid": t})).collect::<Vec<_>>(),
                }))?
            );
            Ok(ExitCode::SUCCESS)
        }
    }
}

fn network_of(net: &NetArgs) -> Network {
    if net.regtest {
        Network::Regtest
    } else if net.testnet {
        Network::Test
    } else {
        Network::Main
    }
}

async fn connect(net: &NetArgs) -> anyhow::Result<Client> {
    if net.regtest && net.endpoint.is_empty() {
        return Err(anyhow!(
            "--regtest requires --endpoint (e.g. http://127.0.0.1:8137)"
        ));
    }
    let eps: Vec<&str> = if net.endpoint.is_empty() {
        zeceipt_lwd::default_endpoints(net.testnet).to_vec()
    } else {
        net.endpoint.iter().map(String::as_str).collect()
    };
    Ok(Client::connect_any(&eps).await?)
}

/// Returns (raw tx bytes, mined height if known).
async fn load_tx(net: &NetArgs, src: &TxSource) -> anyhow::Result<(Vec<u8>, Option<u64>)> {
    if let Some(p) = &src.raw_tx_file {
        let s = std::fs::read_to_string(p).with_context(|| format!("read {}", p.display()))?;
        return Ok((
            hex::decode(s.trim()).context("raw tx file must be hex")?,
            None,
        ));
    }
    let txid = src
        .txid
        .as_ref()
        .ok_or_else(|| anyhow!("--txid or --raw-tx-file is required"))?;
    let mut client = connect(net).await?;
    let raw = client.get_transaction(txid.trim()).await?;
    Ok((raw.bytes, raw.height))
}

fn is_pending(e: &anyhow::Error) -> bool {
    matches!(e.downcast_ref::<LwdError>(), Some(LwdError::NotFound(_)))
}

fn stage(e: &CoreError) -> &'static str {
    match e {
        CoreError::TxidMismatch { .. } => "txid",
        CoreError::Types(TypesError::SignatureInvalid) | CoreError::Types(TypesError::Unsigned) => {
            "signature"
        }
        CoreError::Types(TypesError::ChallengeMismatch) => "challenge",
        CoreError::OutputIndexOutOfRange { .. } | CoreError::NoBundle(_) => "output",
        CoreError::RecoveryFailed { .. } => "recovery",
        _ => "other",
    }
}

fn recovered_json(rec: &zeceipt_core::Recovered, change_known: bool) -> serde_json::Value {
    json!({
        "pool": rec.pool.as_str(),
        "index": rec.index,
        "recipient": rec.recipient,
        "value_zat": rec.value_zat,
        "value_zec": format_zec(rec.value_zat),
        "memo": memo_json(&rec.memo),
        // `null` when the issuer key cannot recognise change (bare OVK): unknown is not "no".
        "is_change": if change_known { json!(rec.is_change) } else { serde_json::Value::Null },
    })
}

fn memo_json(m: &zeceipt_core::MemoView) -> serde_json::Value {
    match m {
        zeceipt_core::MemoView::Empty => json!({"kind": "empty"}),
        zeceipt_core::MemoView::Text(t) => json!({"kind": "text", "text": t}),
        zeceipt_core::MemoView::Bytes(h) => json!({"kind": "bytes", "hex": h}),
    }
}

fn format_zec(zat: u64) -> String {
    format!("{}.{:08}", zat / 100_000_000, zat % 100_000_000)
}

fn write_secret(path: &PathBuf, hex_key: &str) -> anyhow::Result<()> {
    use std::io::Write;
    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let mut f = opts
        .open(path)
        .with_context(|| format!("create {}", path.display()))?;
    writeln!(f, "{hex_key}")?;
    Ok(())
}

fn read_secret(path: &PathBuf) -> anyhow::Result<SigningKey> {
    let s = std::fs::read_to_string(path).with_context(|| format!("read {}", path.display()))?;
    let b = hex::decode(s.trim()).context("key file must be hex")?;
    let arr: [u8; 32] = b
        .try_into()
        .map_err(|_| anyhow!("key file must contain 32 bytes"))?;
    Ok(SigningKey::from_bytes(&arr))
}
