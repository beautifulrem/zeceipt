// The payment mode, shown apart from the lifecycle (KB lesson: Hyperway keeps the payment mode separate
// from the job lifecycle), and the access boundary on the first screen (KB lesson: Cobo puts authorisation
// and risk boundaries first). Text only; nothing secret (the same facts are in `configSummary`).

import type { ConsoleConfig } from "../config/env.ts";

export interface PaymentMode {
  custody: string;
  wallet: string;
  network: string;
  confirmations: string;
}

export function paymentMode(config: ConsoleConfig): PaymentMode {
  const network = { main: "Mainnet", test: "Testnet", regtest: "Regtest (local test chain)" }[config.network];
  return config.custody.mode === "hot"
    ? {
        custody: "Hot wallet: the seed lives only in Zkool; this console holds a viewing key",
        wallet: `Zkool, account ${config.custody.zkool.account}`,
        network,
        confirmations: `${config.confirmations} confirmations before receipts`,
      }
    : {
        custody: "External signer: this console never pays or tracks payments",
        wallet: "None (external signer)",
        network,
        confirmations: `${config.confirmations} confirmations before receipts`,
      };
}

export const ACCESS_NOTICE = "Loopback only, no sign-in yet: anyone on this machine can use this console.";
