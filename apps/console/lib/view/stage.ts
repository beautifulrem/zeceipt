// The batch list's stage (slice F4, review F round 1: a treasurer scans the list for where each batch is). Read from
// the console's own records only, so the list never asks the wallet; it never says "confirmed": depth is on the batch
// page, from the chain.
import type { Tone } from "./status.ts";

export interface StageFacts {
  voided: boolean;
  submitted: boolean;
  receipts: number;
  items: number;
}

export function batchStage(f: StageFacts): { label: string; tone: Tone } {
  if (f.voided) return { label: "Voided", tone: "neutral" };
  if (f.receipts > 0) return f.receipts >= f.items ? { label: "Receipts issued", tone: "success" } : { label: `Receipts ${f.receipts} of ${f.items}`, tone: "warning" };
  if (f.submitted) return { label: "Sent", tone: "info" };
  return { label: "Draft", tone: "neutral" };
}
