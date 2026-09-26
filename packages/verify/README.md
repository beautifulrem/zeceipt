# @zeceipt/verify

Verify Zeceipt receipts locally, in the browser or in Node. A Zeceipt receipt discloses one output of a shielded Zcash transaction (Ironwood, Orchard or Sapling) by its Outgoing Cipher Key: given the receipt and the transaction, this package recovers that output's recipient, amount and memo, and checks the receipt's optional ed25519 signature and challenge. It needs no viewing key, and verifying needs no network. The verifier is the project's Rust code compiled to WebAssembly.

The receipt format is specified in [`spec/receipt-v0.md`](https://github.com/zeceipt/zeceipt/blob/master/spec/receipt-v0.md).

## What a valid result proves

As the verifier's own `proves` and `does_not_prove` fields say (spec §4):

- **Proves:** this transaction pays the shown value to the shown recipient with the shown memo; whoever produced this receipt knew this output's OCK, as does anyone holding an earlier receipt for it; a signature attributes the receipt to a key, not the OCK to the sender.
- **Does not prove:** who is presenting this receipt; anything about other outputs, transactions or balances.

To know a receipt was made for you, send the issuer a random challenge and pass it to `verifyReceipt`.

## Install

```bash
npm install @zeceipt/verify
```

No dependencies. ES modules only.

## Use

In a browser, `initVerifier()` fetches the WASM file next to the module:

```js
import { initVerifier, parseReceipt, verifyReceipt, fetchRawTx } from "@zeceipt/verify";

await initVerifier();
const receipt = location.hash.slice(1);     // a receipt link's fragment; a JSON receipt works too
const { network, txid } = parseReceipt(receipt);
const tx = await fetchRawTx(txid, network);  // asks a public node; or load the raw transaction from a file
const result = verifyReceipt(receipt, tx.hex, { requireSignature: true });
if (result.valid) console.log(result.value_zec, result.recipient, result.memo);
else console.log(result.stage, result.error);
```

In Node, pass the WASM bytes (Node's `fetch` cannot read a `file:` URL):

```js
import { readFile } from "node:fs/promises";
import { initVerifier, verifyReceipt } from "@zeceipt/verify";

await initVerifier(await readFile(new URL(import.meta.resolve("@zeceipt/verify/pkg/zeceipt_wasm_bg.wasm"))));
const result = verifyReceipt(receiptJson, rawTxHex);
```

## API

| Export | What it does |
|---|---|
| `initVerifier(wasm?)` | Loads the verifier once and returns its version. `wasm`: a URL, a `Response`, bytes or a `WebAssembly.Module`. |
| `verifyReceipt(receipt, rawTxHex, { challenge?, requireSignature? })` | Verifies a receipt against the raw transaction. Returns `valid`, and the recovered `recipient`, `value_zat`, `value_zec` and `memo`, or the failing `stage` and `error`, plus `proves` and `does_not_prove`. |
| `parseReceipt(input)` | Parses a receipt from JSON, a receipt link or its base64url payload. |
| `checkSignature(receipt)` | Checks only the issuer signature (no transaction needed). |
| `fetchRawTx(txid, network?, endpoints?)` | Fetches one raw transaction over gRPC-web, with the node's view of where it is (`mined` at a height, `mempool`, or `fork`). |
| `chainStatus(height)` | That view, from lightwalletd's height field. |
| `GRPC_WEB_ENDPOINTS` | The default public gRPC-web endpoints for mainnet and testnet (none for regtest). |
| `issuerClaim(receipt)` | The domain a signed key id claims (spec §7), without any request. |
| `checkIssuerBinding(receipt, { fetchImpl?, timeoutMs? })` | Looks up that domain's `/.well-known/zeceipt.json` and reports `confirmed`, `not_listed` or `unknown`. It never changes whether a receipt is valid. |
| `MAX_WELL_KNOWN_BYTES` | The most of that file read: 64 KiB. |

Types are in `src/index.d.ts`.

## Requests

The package makes a request only when you call one of these:
- `fetchRawTx`, which tells the node which transaction you looked up;
- `checkIssuerBinding`, which tells the claimed domain that one of its receipts is being checked.

`checkIssuerBinding` uses HTTPS only, follows no redirects, sends no credentials or referrer, and reads at most 64 KiB. In a browser, the browser's own limits apply (CORS, the page's policy, private network access). In Node they don't, and the package cannot see which address a domain resolves to. **On a server that checks receipts it did not make, pass a `fetchImpl` that refuses private addresses**, or use the CLI's `zeceipt verify --check-issuer`, which refuses them.

## License

MIT
