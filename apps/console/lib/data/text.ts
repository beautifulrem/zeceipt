// Plain text for console fields (slice B1; shared since slice H1): well-formed (no lone surrogates) and no C0
// control characters or DEL. NUL in particular makes SQLite's length() stop early, so a schema CHECK would
// disagree with this rule. Lengths are Unicode code points, as SQLite's length() counts them.
export function isPlainText(s: string, min: number, max: number, checkWellFormed = true): boolean {
  const n = [...s].length;
  return n >= min && n <= max && (!checkWellFormed || s.isWellFormed()) && !/[\u0000-\u001f\u007f]/.test(s);
}
