// Plain text for console fields (slice B1; shared since slice H1): well-formed (no lone surrogates) and no C0
// control characters or DEL. NUL in particular makes SQLite's length() stop early, so a schema CHECK would
// disagree with this rule. Lengths are Unicode code points, as SQLite's length() counts them.
export function isPlainText(s: string, min: number, max: number, checkWellFormed = true): boolean {
  const n = [...s].length;
  return n >= min && n <= max && (!checkWellFormed || s.isWellFormed()) && !/[\u0000-\u001f\u007f]/.test(s);
}

// Characters that render as nothing (UAX #44 Default_Ignorable_Code_Point: zero-width spaces and joiners, the soft
// hyphen, bidirectional controls, variation selectors, …), which UTS #55 names as a source of confusion and spoofing;
// every control character (C0, DEL and C1, such as NEL and the terminal escape CSI); and the braille blank U+2800,
// which displays as a space (slice H3, reviews H3 rounds 1–2; shared since slice H7; R78).
const INVISIBLE = /[\p{Default_Ignorable_Code_Point}\p{Cc}\u2800]/u;
// Any whitespace but the ordinary space: a no-break or em space looks like a space but is a different string.
const OTHER_SPACE = /(?! )\s/u;

/** Whether `s` holds a character that renders as nothing (or as a space while being something else). */
export function hasInvisible(s: string): boolean {
  return INVISIBLE.test(s);
}

/** Whether `s` holds whitespace other than U+0020 (for keys a person reads, such as references and memos). */
export function hasOtherSpace(s: string): boolean {
  return OTHER_SPACE.test(s);
}
