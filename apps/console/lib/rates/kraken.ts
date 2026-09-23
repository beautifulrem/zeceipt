// ZEC/USD quote from Kraken's public Ticker (slice G1a; REQ-CON-4, NFR-8; research R70).
//
// One source, as 07 §2 decides. The quote keeps the bid, the ask and the last trade exactly as Kraken sent
// them. `rate` is the bid: BTCPay Server's Kraken provider reads the same fields, and BTCPay uses the bid even
// to turn a fiat refund into crypto, so a payee converted at the bid gets at least the USD amount at the price
// they could sell at. `fetchedAt` is our clock when the answer arrived (the ticker carries no timestamp).
//
// It fails closed: any network, HTTP, format or market problem throws RateUnavailableError. There is no cache
// and no default rate. zecpay's silent fallback to its last value or 35.0 (R46) is exactly what this refuses.

import { ExecutionError } from "../execution/types.ts";
import { compareDecimal, isPositiveDecimal } from "./decimal.ts";

export const KRAKEN_TICKER_URL = "https://api.kraken.com/0/public/Ticker?pair=ZECUSD";
/** Kraken's own key for ZEC/USD in Ticker results (BTCPay maps the same name). */
export const KRAKEN_ZEC_USD_PAIR = "XZECZUSD";

export interface RateQuote {
  source: "kraken";
  pair: typeof KRAKEN_ZEC_USD_PAIR;
  /** USD per ZEC, decimal strings exactly as the source sent them. */
  bid: string;
  ask: string;
  last: string;
  /** The rate used to convert: the bid. */
  rate: string;
  /** ISO 8601 UTC, our clock, when the answer arrived. */
  fetchedAt: string;
}

export type RateFailure = "network" | "http" | "too_large" | "json" | "source_error" | "pair_missing" | "bad_price" | "crossed_book";

/** A ticker answer is well under 1 KiB; anything past this cap is not a ticker (review G1a round 1). */
export const MAX_QUOTE_BYTES = 64 * 1024;

/** Code `rate_unavailable`, like the console's other domain errors (ExecutionError), so HTTP mapping stays uniform. */
export class RateUnavailableError extends ExecutionError {
  readonly reason: RateFailure;
  constructor(reason: RateFailure, message: string, options?: { cause?: unknown }) {
    super("rate_unavailable", `ZEC/USD rate unavailable (${reason}): ${message}`);
    this.reason = reason;
    if (options?.cause !== undefined) Object.defineProperty(this, "cause", { value: options.cause, enumerable: false });
  }
}

/** Read at most MAX_QUOTE_BYTES of the body, then parse it as JSON. */
async function boundedJson(res: Response): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (res.body) {
    const reader = res.body.getReader();
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read(); // a dropped connection or the timeout firing mid-body lands here
      } catch (e) {
        throw new RateUnavailableError("network", `reading the answer failed: ${(e as Error).message}`, { cause: e });
      }
      const { done, value } = chunk;
      if (done) break;
      size += value.byteLength;
      if (size > MAX_QUOTE_BYTES) {
        await reader.cancel();
        throw new RateUnavailableError("too_large", `the answer exceeds ${MAX_QUOTE_BYTES} bytes`);
      }
      chunks.push(value);
    }
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (e) {
    throw new RateUnavailableError("json", "the answer is not JSON", { cause: e });
  }
}

export interface QuoteOptions {
  fetch?: typeof fetch;
  now?: () => Date;
  url?: string;
  timeoutMs?: number;
}

const first = (v: unknown): unknown => (Array.isArray(v) ? v[0] : undefined);

export async function fetchZecUsdQuote(opts: QuoteOptions = {}): Promise<RateQuote> {
  const url = opts.url ?? KRAKEN_TICKER_URL;
  const fetchImpl = opts.fetch ?? fetch;
  let res: Response;
  try {
    res = await fetchImpl(url, { headers: { accept: "application/json" }, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000) });
  } catch (e) {
    throw new RateUnavailableError("network", `request to ${new URL(url).host} failed: ${(e as Error).message}`, { cause: e });
  }
  if (!res.ok) throw new RateUnavailableError("http", `HTTP ${res.status} from ${new URL(url).host}`);
  const body = (await boundedJson(res)) as { error?: unknown; result?: Record<string, Record<string, unknown>> } | null;
  if (body === null || typeof body !== "object") throw new RateUnavailableError("json", "the answer is not a JSON object");
  if (Array.isArray(body.error) && body.error.length > 0) throw new RateUnavailableError("source_error", body.error.map(String).join("; "));
  const t = body.result?.[KRAKEN_ZEC_USD_PAIR];
  if (!t || typeof t !== "object") throw new RateUnavailableError("pair_missing", `no ${KRAKEN_ZEC_USD_PAIR} in the answer`);
  const bid = first(t.b);
  const ask = first(t.a);
  const last = first(t.c);
  for (const [name, v] of [["bid", bid], ["ask", ask], ["last", last]] as const) {
    if (typeof v !== "string" || !isPositiveDecimal(v)) throw new RateUnavailableError("bad_price", `${name} is not a positive decimal`);
  }
  if (compareDecimal(bid as string, ask as string) > 0) throw new RateUnavailableError("crossed_book", `bid ${bid} is above ask ${ask}`);
  const fetchedAt = (opts.now ?? (() => new Date()))().toISOString();
  return { source: "kraken", pair: KRAKEN_ZEC_USD_PAIR, bid: bid as string, ask: ask as string, last: last as string, rate: bid as string, fetchedAt };
}
