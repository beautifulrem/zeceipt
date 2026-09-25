// The linkability warning's words (slice H6; REQ-CON-6 "wording matches spec §9"). The spec sentence is verbatim, and
// a test reads spec/receipt-v0.md so the two cannot drift. The remedy follows ZIP 316: addresses derived from one
// wallet's viewing key are designed to be unlinkable, so a fresh one costs the recipient nothing (R84).

export const LINKABILITY_SPEC = "Disclosing an OCK reveals that output's diversified address; repeated receipts to the same address are linkable. Issuers should pay each recipient at a fresh diversified address.";
// Zashi generates "a new Zcash Shielded Address each time you open the Receive screen" (ECC, Zashi 2.0.3; R84).
export const LINKABILITY_REMEDY = "To keep these payments unlinkable, ask the recipient for a fresh address from the same wallet (a new diversified address; Zashi, for one, shows a new one each time its Receive screen opens) and pay that instead.";

/** "A receipt already disclosed this address (batch "September")." */
export function disclosedText(titles: string[]): string {
  const named = titles.map((t) => `"${t}"`).join(", ");
  return `A receipt already disclosed this address (${titles.length === 1 ? "batch" : "batches"} ${named}).`;
}
