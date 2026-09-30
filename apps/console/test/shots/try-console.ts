// Try the payout console in a browser with no chain, no wallet and no network (judge round 1, D17): the design
// gallery's state (test/helpers/demo-console.ts) left running. A fake wallet stands in for Zkool, so "Pay" pays it,
// and a local ticker quotes ZEC at $1,600. Receipts on the "October contributors" batch were issued by the real CLI from
// the committed regtest transaction.
// Run from apps/console after `cargo build` (repo root) and `npm run build`: `npm run try`. Ctrl-C stops it and deletes
// its database.
import { startDemoConsole } from "../helpers/demo-console.ts";

const demo = await startDemoConsole();
const url = `http://${demo.self}`;
console.log(`
The console is running at ${url} (loopback only; fake wallet, local rate, throwaway database).

  The batches:                            ${url}/
  A paid batch with its receipts issued:  ${url}/batches/${demo.ids.issued}
  A draft with a locked rate (approve it, then pay the fake wallet):
                                          ${url}/batches/${demo.ids.draft}
  USD payables to turn into a batch:      ${url}/payables

Ctrl-C to stop.`);
let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  await demo.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
await new Promise(() => {});
