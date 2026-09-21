//! Minimal lightwalletd / Zaino gRPC client for Zeceipt.
//!
//! The only crate in the workspace that opens network sockets. Provides the
//! three calls the CLI needs: fetch a raw transaction by txid, read the chain
//! tip, and scan a block range for transactions with Ironwood actions.

#![forbid(unsafe_code)]

use tonic::transport::{Channel, ClientTlsConfig, Endpoint};
use zcash_client_backend::proto::service::compact_tx_streamer_client::CompactTxStreamerClient;
use zcash_client_backend::proto::service::{BlockId, BlockRange, ChainSpec, TxFilter};

/// Public mainnet endpoints, tried in order.
pub const MAINNET_ENDPOINTS: &[&str] = &[
    "https://zec.rocks:443",
    "https://na.zec.rocks:443",
    "https://eu.zec.rocks:443",
    "https://zec-node.cakewallet.com:443",
];

/// Public testnet endpoints, tried in order.
pub const TESTNET_ENDPOINTS: &[&str] = &["https://testnet.zec.rocks:443"];

#[derive(Debug, thiserror::Error)]
pub enum LwdError {
    #[error("invalid endpoint {0}: {1}")]
    Endpoint(String, String),
    #[error("could not connect to {0}: {1}")]
    Connect(String, String),
    #[error("rpc {rpc} failed on {endpoint}: {status}")]
    Rpc {
        endpoint: String,
        rpc: &'static str,
        status: String,
    },
    #[error("transaction {0} not found")]
    NotFound(String),
    #[error("txid must be 64 hex characters")]
    BadTxid,
    #[error("all endpoints failed; last error: {0}")]
    AllFailed(String),
}

/// A raw transaction as returned by the indexer.
#[derive(Debug, Clone)]
pub struct RawTx {
    pub bytes: Vec<u8>,
    /// Mined height, or `None` when the transaction is still in the mempool.
    pub height: Option<u64>,
}

/// Connected client bound to one endpoint.
pub struct Client {
    endpoint: String,
    inner: CompactTxStreamerClient<Channel>,
}

impl Client {
    /// Connect to a single endpoint (`https://host:port`).
    pub async fn connect(endpoint: &str) -> Result<Self, LwdError> {
        let ep = Endpoint::from_shared(endpoint.to_string())
            .map_err(|e| LwdError::Endpoint(endpoint.into(), e.to_string()))?
            .tls_config(ClientTlsConfig::new().with_webpki_roots())
            .map_err(|e| LwdError::Endpoint(endpoint.into(), e.to_string()))?
            .connect_timeout(std::time::Duration::from_secs(15))
            .timeout(std::time::Duration::from_secs(60));
        let channel = ep
            .connect()
            .await
            .map_err(|e| LwdError::Connect(endpoint.into(), e.to_string()))?;
        tracing::debug!(endpoint, "connected");
        Ok(Client {
            endpoint: endpoint.to_string(),
            inner: CompactTxStreamerClient::new(channel),
        })
    }

    /// Try each endpoint in order and return the first that connects.
    pub async fn connect_any(endpoints: &[&str]) -> Result<Self, LwdError> {
        let mut last = String::from("no endpoints given");
        for ep in endpoints {
            match Self::connect(ep).await {
                Ok(c) => return Ok(c),
                Err(e) => {
                    tracing::warn!(endpoint = *ep, error = %e, "endpoint failed, trying next");
                    last = e.to_string();
                }
            }
        }
        Err(LwdError::AllFailed(last))
    }

    pub fn endpoint(&self) -> &str {
        &self.endpoint
    }

    /// Fetch a transaction by its display-order hex txid.
    pub async fn get_transaction(&mut self, txid_hex: &str) -> Result<RawTx, LwdError> {
        let mut hash = hex::decode(txid_hex).map_err(|_| LwdError::BadTxid)?;
        if hash.len() != 32 {
            return Err(LwdError::BadTxid);
        }
        // lightwalletd expects the internal byte order.
        hash.reverse();
        let resp = self
            .inner
            .get_transaction(TxFilter {
                block: None,
                index: 0,
                hash,
            })
            .await;
        match resp {
            Ok(r) => {
                let r = r.into_inner();
                if r.data.is_empty() {
                    return Err(LwdError::NotFound(txid_hex.into()));
                }
                // lightwalletd encodes "mempool" as u64::MAX / -1 sentinels.
                let height = if r.height == 0 || r.height == u64::MAX || r.height == (-1i64) as u64 {
                    None
                } else {
                    Some(r.height)
                };
                Ok(RawTx { bytes: r.data, height })
            }
            Err(status) if status.code() == tonic::Code::NotFound => {
                Err(LwdError::NotFound(txid_hex.into()))
            }
            Err(status) => {
                let msg = status.message().to_ascii_lowercase();
                if msg.contains("not found") || msg.contains("no such") {
                    return Err(LwdError::NotFound(txid_hex.into()));
                }
                Err(LwdError::Rpc {
                    endpoint: self.endpoint.clone(),
                    rpc: "GetTransaction",
                    status: status.to_string(),
                })
            }
        }
    }

    /// Current chain tip height.
    pub async fn latest_height(&mut self) -> Result<u64, LwdError> {
        let r = self
            .inner
            .get_latest_block(ChainSpec {})
            .await
            .map_err(|s| LwdError::Rpc {
                endpoint: self.endpoint.clone(),
                rpc: "GetLatestBlock",
                status: s.to_string(),
            })?;
        Ok(r.into_inner().height)
    }

    /// Scan `[start, end]` and return (height, txid hex) of every transaction
    /// that has at least one Ironwood action. Useful to pick fixtures and for
    /// verifiers that prefer not to query a specific txid.
    pub async fn find_ironwood_txs(&mut self, start: u64, end: u64) -> Result<Vec<(u64, String)>, LwdError> {
        let range = BlockRange {
            start: Some(BlockId { height: start, hash: vec![] }),
            end: Some(BlockId { height: end, hash: vec![] }),
            pool_types: vec![],
        };
        let mut stream = self
            .inner
            .get_block_range(range)
            .await
            .map_err(|s| LwdError::Rpc {
                endpoint: self.endpoint.clone(),
                rpc: "GetBlockRange",
                status: s.to_string(),
            })?
            .into_inner();
        let mut out = Vec::new();
        while let Some(block) = stream.message().await.map_err(|s| LwdError::Rpc {
            endpoint: self.endpoint.clone(),
            rpc: "GetBlockRange",
            status: s.to_string(),
        })? {
            for tx in block.vtx {
                if !tx.ironwood_actions.is_empty() {
                    let mut id = tx.txid.clone();
                    id.reverse();
                    out.push((block.height, hex::encode(id)));
                }
            }
        }
        Ok(out)
    }
}

/// Endpoint list for a network.
pub fn default_endpoints(testnet: bool) -> &'static [&'static str] {
    if testnet {
        TESTNET_ENDPOINTS
    } else {
        MAINNET_ENDPOINTS
    }
}
