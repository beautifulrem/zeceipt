// In-process fake of the Zkool GraphQL endpoints the backend uses. It models one issuing account with an
// Ironwood balance, a mempool that `mine()` confirms, transaction expiry (tip at build + 40, as Zkool
// builds them), the account's scanned height separately from the node tip (Zkool's `synchronizeAccount`
// returns the tip without scanning while another sync holds its lock: `syncBusy`), and failure switches.

import { createServer, type Server } from "node:http";
import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import { verifyZkoolToken, type ZkoolClaims } from "../../lib/execution/zkool-token.ts";
import { checkUnifiedAddress, TYPECODE } from "../../lib/execution/address.ts";
import { ua } from "./ua-encoder.ts";

/**
 * The address Zkool reports for an output it recovered with the OVK: an Orchard-only unified address rebuilt from the
 * note (zkool2 `memo.rs`: `UnifiedAddress::from_receivers(Some(address), None, None)`), never the address that was
 * paid (review S5 round 1: the fake used to echo the paid string, which hid a matching bug).
 */
export function zkoolStoredAddress(address: string): string {
  const hrp = address.slice(0, address.lastIndexOf("1"));
  const network = hrp === "u" ? "main" : hrp === "utest" ? "test" : "regtest";
  const r = checkUnifiedAddress(address, network);
  const orchard = r.ok ? r.receivers.find((x) => x.typecode === TYPECODE.orchard) : undefined;
  return orchard ? ua(hrp, [[TYPECODE.orchard, orchard.data.length, ...orchard.data]]) : address;
}

export interface FakeTx { txid: string; height: number; expiry: number; recipients: { address: string; amount: string; memo: string }[] }

/**
 * Next pay behaviour:
 *   ok                  — broadcast, answer the txid
 *   refused             — Zkool pre-build refusal ("Not enough funds, …"); nothing built
 *   grpc-error-sent     — tx reaches the mempool, then Zkool answers a GraphQL error (failed gRPC reply)
 *   grpc-error-unsent   — GraphQL gRPC-style error, nothing reached the node
 *   node-rejected       — the node rejects; Zkool answers the rejection text in place of a txid
 *   drop-after-broadcast — tx reaches the mempool, the HTTP connection dies
 *   hang                — tx reaches the mempool, no answer ever
 */
export type PayMode = "ok" | "refused" | "grpc-error-sent" | "grpc-error-unsent" | "node-rejected" | "drop-after-broadcast" | "hang";

const GRPC_ERROR = 'status: Unavailable, message: "error trying to connect: tcp connect error", details: [], metadata: MetadataMap { headers: {} }';

export class FakeZkool {
  server!: Server;
  url = "";
  height = 100;
  /** Height the issuer account is scanned to; `synchronizeAccount` raises it to `height` unless `syncBusy`. */
  scanned = 100;
  syncBusy = false;
  /** Make `currentHeight` fail (the expiry-bound request after a pay). */
  failCurrentHeight = false;
  ironwoodZat = 1_000_000_000n; // 10 ZEC
  payCalls = 0;
  /** Every GraphQL request answered (slice I2b: a skipped batch must cost the wallet nothing). */
  requests = 0;
  mempool: FakeTx[] = [];
  mined: FakeTx[] = [];
  nextPay: PayMode = "ok";
  payDelayMs = 0;
  /** Set by `requireTokens`: the ES256 public key Zkool was started with (`--jwt-public-key-file`). */
  publicKeyPem?: string;
  /** The last `authorization` header received (slice S3). */
  lastAuthorization?: string;

  /**
   * Check tokens as zkool_graphql does with `--jwt-public-key-file` (slice S3, measured 2026-09-25): no token or an
   * invalid or expired one → HTTP 500 "Unhandled rejection: AuthError" before any GraphQL runs; a valid token for
   * another account → the GraphQL error "Unauthorized" on that account's operations; `pay` also needs `write`.
   */
  requireTokens(publicKeyPem: string): this {
    this.publicKeyPem = publicKeyPem;
    return this;
  }

  async start(): Promise<this> {
    this.server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", async () => {
        const { query, variables } = JSON.parse(body);
        this.requests++;
        const reply = (data: unknown) => {
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(data));
        };
        this.lastAuthorization = req.headers.authorization;
        let claims: ZkoolClaims | undefined;
        if (this.publicKeyPem) {
          const token = req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7).trim() : undefined;
          claims = token ? verifyZkoolToken(token, this.publicKeyPem) : undefined;
          if (!claims) {
            res.statusCode = 500;
            return res.end("Unhandled rejection: AuthError");
          }
        }
        // zkool2 `check_auth`: admin (sub 0) or the token's own account, with write when asked.
        const denied = (write: boolean) => claims !== undefined && claims.sub !== 0 && (claims.sub !== variables?.id || (write && !claims.write));
        const unauthorized = { data: null, errors: [{ message: "Unauthorized" }] };
        try {
          if (query.includes("currentHeight")) {
            if (this.failCurrentHeight) return reply({ data: null, errors: [{ message: "status: Unavailable, message: \"lwd down\"" }] });
            return reply({ data: { currentHeight: this.height } });
          }
          if (query.includes("synchronizeAccount")) {
            if (denied(false)) return reply(unauthorized);
            if (!this.syncBusy) this.scanned = this.height;
            return reply({ data: { synchronizeAccount: this.height } });
          }
          if (query.includes("balanceByAccount")) {
            if (denied(false)) return reply(unauthorized);
            const z = this.ironwoodZat;
            const dec = `${z / 100000000n}.${(z % 100000000n).toString().padStart(8, "0")}`;
            return reply({ data: { balanceByAccount: { height: this.scanned, transparent: "0", sapling: "0", orchard: "0", ironwood: dec, total: dec } } });
          }
          if (query.includes("transactionsByAccount")) {
            if (denied(false)) return reply(unauthorized);
            const since = variables.h ?? 0;
            return reply({
              data: {
                transactionsByAccount: this.mined.filter((t) => t.height >= since && t.height <= this.scanned).map((t) => ({
                  txid: t.txid,
                  height: t.height,
                  value: "-0",
                  fee: "0.00020000",
                  outputs: t.recipients.map((r, i) => ({ pool: 3, vout: i, value: r.amount, address: zkoolStoredAddress(r.address), memo: r.memo })),
                })),
              },
            });
          }
          if (query.includes("pay(")) {
            if (denied(true)) return reply(unauthorized);
            this.payCalls++;
            const mode = this.nextPay;
            this.nextPay = "ok";
            if (this.payDelayMs) await new Promise((r) => setTimeout(r, this.payDelayMs));
            if (mode === "refused") return reply({ data: null, errors: [{ message: "Not enough funds, 1.5 more ZEC required" }] });
            if (mode === "grpc-error-unsent") return reply({ data: null, errors: [{ message: GRPC_ERROR }] });
            if (mode === "node-rejected") return reply({ data: { pay: "transaction was rejected: bad-txns-sapling-duplicate-nullifier" } });
            const txid = createHash("sha256").update(`${this.payCalls}:${JSON.stringify(variables)}`).digest("hex");
            const tx: FakeTx = { txid, height: 0, expiry: this.height + 40, recipients: variables.pay.recipients };
            this.mempool.push(tx);
            if (mode === "grpc-error-sent") return reply({ data: null, errors: [{ message: GRPC_ERROR }] });
            if (mode === "drop-after-broadcast") return res.destroy();
            if (mode === "hang") return; // never answer
            return reply({ data: { pay: txid } });
          }
          reply({ errors: [{ message: `fake: unsupported query ${query.slice(0, 40)}` }] });
        } catch (e) {
          reply({ errors: [{ message: String(e) }] });
        }
      });
    });
    await new Promise<void>((r) => this.server.listen(0, "127.0.0.1", r));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}/graphql`;
    return this;
  }

  /** Mine every unexpired mempool transaction into the next block, then add `extra` empty blocks. */
  mine(extra = 0) {
    this.height += 1;
    for (const t of this.mempool) if (t.expiry >= this.height) this.mined.push({ ...t, height: this.height });
    this.mempool = [];
    this.height += extra;
  }

  /** Add `n` blocks that do not include the mempool (as if the tx never propagated); expired txs drop out. */
  advance(n: number) {
    this.height += n;
    this.mempool = this.mempool.filter((t) => t.expiry >= this.height);
  }

  /** Forget the mempool (the node lost the transactions). */
  drop() {
    this.mempool = [];
  }

  async stop() {
    this.server.closeAllConnections();
    await new Promise<void>((r) => this.server.close(() => r()));
  }
}
