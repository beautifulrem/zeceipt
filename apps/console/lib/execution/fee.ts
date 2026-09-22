// ZIP 317 conventional fee: marginal_fee × max(grace_actions, logical_actions); Ironwood actions count
// like Orchard actions. For n recipients plus one change output an Ironwood bundle needs at least n + 1
// actions. This is an estimate for the balance check: if the wallet selects more input notes than outputs
// the real fee is higher, which is why preflight keeps a margin and the real fee is read back afterwards.

export const MARGINAL_FEE_ZAT = 5_000n;
export const GRACE_ACTIONS = 2n;

export function estimateIronwoodFeeZat(recipients: number): bigint {
  const actions = BigInt(recipients) + 1n;
  return MARGINAL_FEE_ZAT * (actions > GRACE_ACTIONS ? actions : GRACE_ACTIONS);
}
