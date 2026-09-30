# zeceipt dossier service: `zeceipt dossier serve` in a container, for a compliance back office.
# API: docs/api/dossier-service.md (OpenAPI: docs/api/dossier-service.openapi.json).
#
#   docker build -t zeceipt .
#   docker run --rm -p 127.0.0.1:8787:8787 zeceipt                                  # public zec.rocks nodes
#   docker run --rm -p 127.0.0.1:8787:8787 zeceipt --endpoint https://your-node:443 # your own lightwalletd / Zaino
#
# Each dossier's own "network" field picks mainnet or testnet; do not pass --testnet unless every dossier is testnet
# (it forces testnet for all of them).
#
# The service has no TLS and no authentication of its own. Inside the container it listens on 0.0.0.0 (hence
# --allow-remote); do not publish the port beyond loopback or a private network. Front it with a reverse proxy that
# terminates TLS and authenticates callers (mTLS, an API gateway, or your SSO proxy). The dossiers it receives disclose
# note openings and the holder's nk: treat request bodies and reports as case-file material.

# Build stage: only Cargo.toml, Cargo.lock and crates/ are sent to the builder (BuildKit transfers what COPY names).
FROM rust:1.96-bookworm AS build
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY crates crates
RUN cargo build --release --locked -p zeceipt-cli \
 && install -D -m 0755 target/release/zeceipt /out/zeceipt

# Run stage: glibc and nothing else, as an unprivileged user. Node TLS roots are compiled in (webpki-roots).
FROM gcr.io/distroless/cc-debian12:nonroot
COPY --from=build /out/zeceipt /usr/local/bin/zeceipt
EXPOSE 8787
ENTRYPOINT ["/usr/local/bin/zeceipt", "dossier", "serve", "--allow-remote", "--listen", "0.0.0.0:8787"]
# Extra arguments are appended: --endpoint <url> (repeatable), or --raw-tx-dir /txs with a mounted
# directory of <txid>.hex files for an air-gapped service.
CMD []
