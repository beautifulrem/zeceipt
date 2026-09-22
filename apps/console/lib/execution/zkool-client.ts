// Minimal typed client for the Zkool GraphQL server (hhanh00/zkool2, `zkool_graphql`).
// Two failure classes are kept distinct:
//   ZkoolGraphqlError   — the server answered with `errors`. For `pay` this does NOT prove nothing was
//                         sent: Zkool also reports a failed gRPC send (after the node may have the tx) this
//                         way. `ZkoolBackend` treats only known pre-build refusals as "nothing sent".
//   ZkoolTransportError — no usable answer (network error, timeout, non-2xx, redirect): outcome unknown.

import { zatToDecimal } from "./money.ts";

export class ZkoolGraphqlError extends Error {
  readonly messages: string[];
  constructor(messages: string[]) {
    super(messages.join("; "));
    this.name = "ZkoolGraphqlError";
    this.messages = messages;
  }
}

export class ZkoolTransportError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ZkoolTransportError";
  }
}

export const POOL = { transparent: 1, sapling: 2, orchard: 4, ironwood: 8 } as const;

export interface ZkoolClientOptions {
  /** e.g. http://127.0.0.1:9000/graphql */
  url: string;
  /** Zkool has no authentication; only loopback is allowed unless explicitly overridden. */
  allowRemote?: boolean;
  timeoutMs?: number;
  /** `pay` builds and proves a transaction; give it longer. */
  payTimeoutMs?: number;
  fetch?: typeof fetch;
}

export interface ZkoolOutput { pool: number; vout: number; value: string; address: string | null; memo: string | null }
export interface ZkoolTx { txid: string; height: number; value: string; fee: string; outputs: ZkoolOutput[] }
export interface ZkoolBalance { height: number | null; ironwood: string; orchard: string; sapling: string; transparent: string; total: string }
export interface ZkoolRecipient { address: string; zat: bigint; memo: string }

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

export class ZkoolClient {
  readonly url: string;
  private readonly timeoutMs: number;
  private readonly payTimeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: ZkoolClientOptions) {
    const u = new URL(opts.url);
    if (!opts.allowRemote && !LOOPBACK.has(u.hostname)) {
      throw new Error(`refusing non-loopback Zkool endpoint ${u.hostname}: the server has no authentication (pass allowRemote to override)`);
    }
    this.url = u.toString();
    this.timeoutMs = opts.timeoutMs ?? 60_000;
    this.payTimeoutMs = opts.payTimeoutMs ?? 300_000;
    this.fetchImpl = opts.fetch ?? fetch;
  }

  async request<T>(query: string, variables: Record<string, unknown> = {}, timeoutMs = this.timeoutMs): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(this.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query, variables }),
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      throw new ZkoolTransportError(`request to ${this.url} failed: ${(e as Error).message}`, { cause: e });
    }
    if (!res.ok) throw new ZkoolTransportError(`HTTP ${res.status} from ${this.url}`);
    let body: { data?: T; errors?: { message: string }[] };
    try {
      body = await res.json();
    } catch (e) {
      throw new ZkoolTransportError(`invalid JSON from ${this.url}`, { cause: e });
    }
    if (body.errors?.length) throw new ZkoolGraphqlError(body.errors.map((e) => e.message));
    if (body.data === undefined) throw new ZkoolTransportError(`no data in response from ${this.url}`);
    return body.data;
  }

  async currentHeight(): Promise<number> {
    return (await this.request<{ currentHeight: number }>("{ currentHeight }")).currentHeight;
  }

  async sync(account: number): Promise<number> {
    return (await this.request<{ synchronizeAccount: number }>(
      "mutation($id: Int!) { synchronizeAccount(idAccount: $id, fast: false) }",
      { id: account },
    )).synchronizeAccount;
  }

  async balance(account: number): Promise<ZkoolBalance> {
    return (await this.request<{ balanceByAccount: ZkoolBalance }>(
      "query($id: Int!) { balanceByAccount(idAccount: $id) { height transparent sapling orchard ironwood total } }",
      { id: account },
    )).balanceByAccount;
  }

  /** Build, sign and broadcast one transaction paying every recipient. Returns the txid. */
  async pay(account: number, recipients: ZkoolRecipient[], srcPools: number): Promise<string> {
    return (await this.request<{ pay: string }>(
      "mutation($id: Int!, $pay: Payment!) { pay(idAccount: $id, payment: $pay) }",
      {
        id: account,
        pay: {
          recipients: recipients.map((r) => ({ address: r.address, amount: zatToDecimal(r.zat), memo: r.memo })),
          srcPools,
        },
      },
      this.payTimeoutMs,
    )).pay;
  }

  /** Mined transactions of the account at or above `sinceHeight`, with their outputs (sender view). */
  async transactions(account: number, sinceHeight = 0): Promise<ZkoolTx[]> {
    return (await this.request<{ transactionsByAccount: ZkoolTx[] }>(
      "query($id: Int!, $h: Int!) { transactionsByAccount(idAccount: $id, height: $h) { txid height value fee outputs { pool vout value address memo } } }",
      { id: account, h: sinceHeight },
    )).transactionsByAccount;
  }
}
