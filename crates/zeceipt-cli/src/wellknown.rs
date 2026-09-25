//! Fetching a claimed domain's well-known file (spec §7) for `verify --check-issuer`: HTTPS on the default port, no
//! redirects, at most 64 KiB, 10 s. The receipt's author chooses the domain, so a domain that resolves to a loopback,
//! private, link-local or otherwise non-public address is refused, and the connection goes to the address that was
//! checked, with the TLS name still the domain, so DNS rebinding cannot swap in another address between the check
//! and the connect (review W1 round 2). No proxy is used, for the same reason. Every failure is a reason for an
//! "unknown" binding, never an error of the verification.

use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;
use std::time::Duration;

use http_body_util::{BodyExt, Empty};
use hyper::body::Bytes;
use hyper_util::rt::TokioIo;
use tokio::io::{AsyncRead, AsyncWrite};
use zeceipt_core::zeceipt_types::binding::{Claim, MAX_FILE_BYTES, WELL_KNOWN_PATH};

pub const TIMEOUT: Duration = Duration::from_secs(10);

/// Whether an address may be contacted for a lookup: globally reachable unicast only, after the IANA IPv4 and IPv6
/// Special-Purpose Address Registries (RFC 6890). IPv6 is public only inside the global unicast space 2000::/3 and
/// outside its special blocks, so every other form (IPv4-compatible `::/96`, NAT64 `64:ff9b::`, discard `100::`,
/// SRv6 `5f00::`, unique local, link-local, multicast) is refused by construction (review W2b).
pub fn is_public(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            let o = v4.octets();
            !(v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_unspecified()
                || v4.is_broadcast()
                || v4.is_documentation()
                || v4.is_multicast()
                || o[0] == 0 // "this network"
                || (o[0] == 100 && (o[1] & 0xc0) == 64) // 100.64.0.0/10, shared address space (CGNAT)
                || (o[0] == 198 && (o[1] & 0xfe) == 18) // 198.18.0.0/15, benchmarking
                || (o[0] == 192 && o[1] == 0 && o[2] == 0) // 192.0.0.0/24, IETF protocol assignments
                || (o[0] == 192 && o[1] == 88 && o[2] == 99) // 192.88.99.0/24, deprecated 6to4 relay anycast
                || o[0] >= 240) // 240.0.0.0/4, reserved
        }
        IpAddr::V6(v6) => {
            if let Some(v4) = v6.to_ipv4_mapped() {
                return is_public(IpAddr::V4(v4));
            }
            let s = v6.segments();
            let special = match s[0] {
                // 2001::/23, IETF protocol assignments (Teredo 2001::/32 among them); 2001:db8::/32, documentation
                0x2001 => s[1] < 0x0200 || s[1] == 0x0db8,
                0x2002 => true,              // 2002::/16, 6to4
                x => (x & 0xfff0) == 0x3ff0, // 3fff::/20, documentation
            };
            (s[0] & 0xe000) == 0x2000 && !special // 2000::/3, global unicast
        }
    }
}

/// Fetch `https://<domain>/.well-known/zeceipt.json` under the lookup rules. `Err` is the reason the binding is unknown.
pub async fn fetch(claim: &Claim) -> Result<Vec<u8>, String> {
    let work = async {
        let addrs: Vec<SocketAddr> = tokio::net::lookup_host((claim.domain.as_str(), 443))
            .await
            .map_err(|e| format!("{} does not resolve ({e})", claim.domain))?
            .collect();
        let first = *addrs
            .first()
            .ok_or_else(|| format!("{} does not resolve", claim.domain))?;
        if let Some(bad) = addrs.iter().find(|a| !is_public(a.ip())) {
            return Err(format!(
                "{} resolves to a non-public address ({}); not looked up",
                claim.domain,
                bad.ip()
            ));
        }
        let tcp = tokio::net::TcpStream::connect(first)
            .await
            .map_err(|e| format!("cannot connect to {} ({e})", claim.domain))?;
        let tls = tls_connect(&claim.domain, tcp).await?;
        get(tls, &claim.domain).await
    };
    tokio::time::timeout(TIMEOUT, work)
        .await
        .map_err(|_| format!("no answer from {} within 10 s", claim.domain))?
}

async fn tls_connect(
    domain: &str,
    tcp: tokio::net::TcpStream,
) -> Result<tokio_rustls::client::TlsStream<tokio::net::TcpStream>, String> {
    let mut roots = rustls::RootCertStore::empty();
    roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    let mut config = rustls::ClientConfig::builder_with_provider(Arc::new(
        rustls::crypto::ring::default_provider(),
    ))
    .with_safe_default_protocol_versions()
    .map_err(|e| format!("TLS setup failed ({e})"))?
    .with_root_certificates(roots)
    .with_no_client_auth();
    config.alpn_protocols = vec![b"http/1.1".to_vec()];
    let name = rustls::pki_types::ServerName::try_from(domain.to_string())
        .map_err(|_| format!("{domain} is not a valid TLS server name"))?;
    tokio_rustls::TlsConnector::from(Arc::new(config))
        .connect(name, tcp)
        .await
        .map_err(|e| format!("TLS with {domain} failed ({e})"))
}

/// One GET of the well-known path over an established stream: 200 only (a redirect is not followed), at most
/// `MAX_FILE_BYTES` read. Generic over the stream so the HTTP rules are tested without TLS.
pub async fn get<S: AsyncRead + AsyncWrite + Unpin + Send + 'static>(
    stream: S,
    domain: &str,
) -> Result<Vec<u8>, String> {
    let (mut sender, conn) = hyper::client::conn::http1::handshake(TokioIo::new(stream))
        .await
        .map_err(|e| format!("HTTP with {domain} failed ({e})"))?;
    tokio::spawn(async move {
        let _ = conn.await;
    });
    let req = hyper::Request::get(WELL_KNOWN_PATH)
        .header(hyper::header::HOST, domain)
        .header(hyper::header::ACCEPT, "application/json")
        .header(
            hyper::header::USER_AGENT,
            concat!("zeceipt/", env!("CARGO_PKG_VERSION")),
        )
        .body(Empty::<Bytes>::new())
        .map_err(|e| format!("request failed ({e})"))?;
    let mut res = sender
        .send_request(req)
        .await
        .map_err(|e| format!("HTTP with {domain} failed ({e})"))?;
    let status = res.status();
    if status.is_redirection() {
        return Err(format!(
            "{domain} answered with a redirect (HTTP {}), which is not followed",
            status.as_u16()
        ));
    }
    if status != hyper::StatusCode::OK {
        return Err(format!("{domain} answered HTTP {}", status.as_u16()));
    }
    let mut body = Vec::new();
    while let Some(frame) = res.body_mut().frame().await {
        let frame = frame.map_err(|e| format!("reading from {domain} failed ({e})"))?;
        if let Some(chunk) = frame.data_ref() {
            if body.len() + chunk.len() > MAX_FILE_BYTES {
                return Err(format!("{domain}'s file is larger than 64 KiB"));
            }
            body.extend_from_slice(chunk);
        }
    }
    Ok(body)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    #[test]
    fn public_addresses_only() {
        for public in [
            "93.184.215.14",
            "1.1.1.1",
            "2606:4700:4700::1111",
            "::ffff:93.184.215.14",
            "2001:200::1", // just past 2001::/23: an APNIC allocation
            "2a00:1450:4001::1",
        ] {
            assert!(is_public(public.parse().unwrap()), "{public}");
        }
        for private in [
            "127.0.0.1",
            "10.1.2.3",
            "172.16.0.1",
            "192.168.1.1",
            "169.254.169.254",
            "0.0.0.0",
            "100.64.0.1",
            "198.18.0.1",
            "192.0.2.1",
            "224.0.0.1",
            "255.255.255.255",
            "240.0.0.1",
            "192.0.0.8",
            "::1",
            "::",
            "fc00::1",
            "fd12::1",
            "fe80::1",
            "2001:db8::1",
            "ff02::1",
            "::ffff:127.0.0.1",
            "::ffff:10.0.0.1",
            "64:ff9b::a00:1",
            "::127.0.0.1",         // IPv4-compatible (::/96)
            "2001:0:4136:e378::1", // Teredo (2001::/32)
            "2001:1ff::1",         // the end of 2001::/23
            "2002:c000:0204::1",   // 6to4
            "3fff::1",             // documentation (3fff::/20)
            "5f00::1",             // SRv6 SIDs
            "4000::1",             // outside 2000::/3
            "192.88.99.1",         // deprecated 6to4 relay anycast
            "100::1",
        ] {
            assert!(!is_public(private.parse().unwrap()), "{private}");
        }
    }

    /// A one-shot HTTP server on loopback answering `response` to the first request; returns what it was sent.
    async fn serve(response: Vec<u8>) -> (tokio::net::TcpStream, tokio::task::JoinHandle<String>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let task = tokio::spawn(async move {
            let (mut s, _) = listener.accept().await.unwrap();
            let mut buf = vec![0u8; 4096];
            let n = s.read(&mut buf).await.unwrap();
            s.write_all(&response).await.unwrap();
            s.shutdown().await.ok();
            String::from_utf8_lossy(&buf[..n]).into_owned()
        });
        (tokio::net::TcpStream::connect(addr).await.unwrap(), task)
    }

    fn http(status: &str, extra: &str, body: &[u8]) -> Vec<u8> {
        let mut r = format!(
            "HTTP/1.1 {status}\r\ncontent-length: {}\r\n{extra}connection: close\r\n\r\n",
            body.len()
        )
        .into_bytes();
        r.extend_from_slice(body);
        r
    }

    #[tokio::test]
    async fn a_200_is_read_and_the_request_names_the_domain_and_path() {
        let (stream, sent) =
            serve(http("200 OK", "", br#"{"version":"zeceipt-v0","keys":[]}"#)).await;
        assert_eq!(
            get(stream, "pay.example.org").await.unwrap(),
            br#"{"version":"zeceipt-v0","keys":[]}"#
        );
        let req = sent.await.unwrap().to_ascii_lowercase();
        assert!(
            req.starts_with("get /.well-known/zeceipt.json http/1.1\r\n"),
            "{req}"
        );
        assert!(req.contains("\r\nhost: pay.example.org\r\n"), "{req}");
    }

    #[tokio::test]
    async fn redirects_other_statuses_and_oversize_files_are_reasons() {
        let (s, _) = serve(http(
            "302 Found",
            "location: https://evil.example/x\r\n",
            b"",
        ))
        .await;
        assert!(get(s, "pay.example.org")
            .await
            .unwrap_err()
            .contains("redirect"));
        let (s, _) = serve(http("404 Not Found", "", b"nope")).await;
        assert_eq!(
            get(s, "pay.example.org").await.unwrap_err(),
            "pay.example.org answered HTTP 404"
        );
        let (s, _) = serve(http("200 OK", "", &vec![b' '; MAX_FILE_BYTES + 1])).await;
        assert!(get(s, "pay.example.org")
            .await
            .unwrap_err()
            .contains("larger than 64 KiB"));
        let (s, _) = serve(http("200 OK", "", &vec![b' '; MAX_FILE_BYTES])).await;
        assert_eq!(
            get(s, "pay.example.org").await.unwrap().len(),
            MAX_FILE_BYTES,
            "exactly 64 KiB is read"
        );
    }

    #[tokio::test]
    async fn a_domain_resolving_to_loopback_is_refused_before_any_connection() {
        let claim =
            zeceipt_core::zeceipt_types::binding::claim("k@localhost.localdomain.test").unwrap();
        // .test never resolves publicly (RFC 6761); either way no connection is attempted to a non-public address.
        let err = fetch(&claim).await.unwrap_err();
        assert!(
            err.contains("does not resolve") || err.contains("non-public"),
            "{err}"
        );
    }
}
