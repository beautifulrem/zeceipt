// In-process fake of the Zkool GraphQL endpoints the backend uses. It models one issuing account with an
// Ironwood balance, a mempool that `mine()` confirms, and switches to inject failures.

import { createServer, type Server } from "node:http";
import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";

export interface FakeTx { txid: string; height: number; recipients: { address: string; amount: string; memo: string }[] }

export class FakeZkool {
  server!: Server;
  url = "";
  height = 100;
  ironwoodZat = 1_000_000_000n; // 10 ZEC
  payCalls = 0;
  mempool: FakeTx[] = [];
  mined: FakeTx[] = [];
  /** Next pay: "ok" | "graphql-error" | "drop-after-broadcast" (tx is created, response never arrives) | "hang". */
  nextPay: "ok" | "graphql-error" | "drop-after-broadcast" | "hang" = "ok";
  payDelayMs = 0;

  async start(): Promise<this> {
    this.server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", async () => {
        const { query, variables } = JSON.parse(body);
        const reply = (data: unknown) => {
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(data));
        };
        try {
          if (query.includes("currentHeight")) return reply({ data: { currentHeight: this.height } });
          if (query.includes("synchronizeAccount")) return reply({ data: { synchronizeAccount: this.height } });
          if (query.includes("balanceByAccount")) {
            const z = this.ironwoodZat;
            const dec = `${z / 100000000n}.${(z % 100000000n).toString().padStart(8, "0")}`;
            return reply({ data: { balanceByAccount: { height: this.height, transparent: "0", sapling: "0", orchard: "0", ironwood: dec, total: dec } } });
          }
          if (query.includes("transactionsByAccount")) {
            const since = variables.h ?? 0;
            return reply({
              data: {
                transactionsByAccount: this.mined.filter((t) => t.height >= since).map((t) => ({
                  txid: t.txid,
                  height: t.height,
                  value: "-0",
                  fee: "0.00020000",
                  outputs: t.recipients.map((r, i) => ({ pool: 3, vout: i, value: r.amount, address: r.address, memo: r.memo })),
                })),
              },
            });
          }
          if (query.includes("pay(")) {
            this.payCalls++;
            const mode = this.nextPay;
            this.nextPay = "ok";
            if (this.payDelayMs) await new Promise((r) => setTimeout(r, this.payDelayMs));
            if (mode === "graphql-error") return reply({ data: null, errors: [{ message: "No feasible note selection found" }] });
            const txid = createHash("sha256").update(`${this.payCalls}:${JSON.stringify(variables)}`).digest("hex");
            const tx: FakeTx = { txid, height: 0, recipients: variables.pay.recipients };
            this.mempool.push(tx);
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

  /** Mine every mempool transaction into the next block, then add `extra` empty blocks. */
  mine(extra = 0) {
    this.height += 1;
    for (const t of this.mempool) this.mined.push({ ...t, height: this.height });
    this.mempool = [];
    this.height += extra;
  }

  async stop() {
    this.server.closeAllConnections();
    await new Promise<void>((r) => this.server.close(() => r()));
  }
}
