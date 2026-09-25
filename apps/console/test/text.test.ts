// The shared text rules (slice H7; R78): invisible characters and other spaces, as H3 refuses them in references.
import { test } from "node:test";
import assert from "node:assert/strict";
import { hasInvisible, hasOtherSpace } from "../lib/data/text.ts";

const INVISIBLE = ["\u200b", "\u200d", "\u2066", "\u2069", "\u00ad", "\u202e", "\u200c", "\ufeff", "\u061c", "\u2060", "\ufe0f", "\u3164", "\u0085", "\u0080", "\u009b", "\u2800", "\u0000", "\u0007"];
const OTHER_SPACES = ["\u00a0", "\u2003", "\u3000", "\u2028", "\t"];

test("every lookalike from review H3 is invisible; other spaces are caught by their own rule; ordinary text passes both", () => {
  for (const c of INVISIBLE) assert.equal(hasInvisible(`INV${c}1`), true, JSON.stringify(c));
  for (const c of OTHER_SPACES) assert.equal(hasOtherSpace(`INV${c}1`), true, JSON.stringify(c));
  for (const s of ["INV 1 (September)", "Café ☕", "فاتورة-١", "請求書-7", "emoji 🦓", "Jean Dupont"]) {
    assert.equal(hasInvisible(s) || hasOtherSpace(s), false, s);
  }
});
