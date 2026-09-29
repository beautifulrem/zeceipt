// Contrast of the design tokens (slice F4; review G1d's rule, generalised). Every pair of a text colour and a background
// it is drawn on must meet WCAG 2.x 1.4.3's 4.5:1, in both colour schemes. The tokens are read from the stylesheet the
// console ships (app/globals.css), so a token change that breaks a pair fails here. The lighter digits of an amount are
// `text-muted` (review G1d: for a small payment they are the whole amount), placeholders are `subtle`, badge and callout
// text is the tone on its soft background, button text sits on its fill, and the focus ring and input borders (non-text) meet 3:1.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(import.meta.dirname, "..", "app", "globals.css"), "utf8");

function block(selectorRe: RegExp): Record<string, string> {
  const m = selectorRe.exec(css);
  assert.ok(m, `token block ${selectorRe}`);
  const out: Record<string, string> = {};
  for (const [, k, v] of m[1].matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi)) out[k] = v;
  return out;
}
const light = block(/:root\s*\{([^}]*)\}/);
const dark = { ...light, ...block(/prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([^}]*)\}/) };

const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
export const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

// [text token, background token]; a literal colour is written as-is (the accent button's dark text).
const PAIRS: [string, string][] = [
  ...["canvas", "surface", "surface-2"].flatMap((bg) => ["fg", "muted"].map((t) => [t, bg] as [string, string])),
  ["subtle", "surface"],
  ["primary-fg", "primary"],
  ["accent-fg", "accent"],
  ["accent-fg", "accent-hover"],
  ["on-danger", "danger-solid"],
  ...(["success", "warning", "danger", "info"] as const).flatMap((t) => [[t, `${t}-soft`], [t, "surface"]] as [string, string][]),
  ["accent-strong", "accent-soft"],
  ["accent-strong", "surface"],
  ["fg", "accent-soft"],
];

for (const [name, theme] of [["light", light], ["dark", dark]] as const) {
  test(`every text/background token pair meets 4.5:1 in the ${name} scheme (WCAG 1.4.3)`, () => {
    const failures: string[] = [];
    for (const [t, bg] of PAIRS) {
      const fgHex = t.startsWith("#") ? t : theme[t];
      const bgHex = theme[bg];
      assert.ok(fgHex && bgHex, `${t} on ${bg} defined`);
      const r = ratio(fgHex, bgHex);
      if (r < 4.5) failures.push(`${t} ${fgHex} on ${bg} ${bgHex}: ${r.toFixed(2)}:1`);
    }
    assert.deepEqual(failures, []);
  });
}

// Non-text contrast (WCAG 2.2 1.4.11, 3:1; review F round 1): the focus ring and the input borders, on every surface
// they sit on, and the status dots.
const NON_TEXT: [string, string][] = [
  ...["canvas", "surface", "surface-2"].flatMap((bg) => [["ring", bg], ["input-line", bg]] as [string, string][]),
  // The status dots on the receipt page and the demo (ready and checked: success; error: danger; loading: subtle),
  // on the canvas they sit on (review F round 6). Pill and badge tones are text on their soft fills, checked above.
  ["success", "canvas"], ["danger", "canvas"], ["subtle", "canvas"],
];

// The scroll shadow's darkest edge (a translucent token) composited on the surface it shades, at 3:1 (review F round 7).
function shade(theme: string): string {
  const m = new RegExp(`${theme === "light" ? "^:root" : "prefers-color-scheme: dark\\)\\s*\\{\\s*:root"}\\s*\\{[^}]*--scroll-shade:\\s*rgb\\((\\d+) (\\d+) (\\d+) / ([\\d.]+)\\)`, "m").exec(css);
  assert.ok(m, `--scroll-shade in the ${theme} block`);
  const [r, g, b, a] = m.slice(1).map(Number);
  const bg = (theme === "light" ? light : dark).surface;
  const mix = [r, g, b].map((c, i) => Math.round(c * a + parseInt(bg.slice(1 + 2 * i, 3 + 2 * i), 16) * (1 - a)));
  return `#${mix.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}
for (const name of ["light", "dark"]) {
  test(`the scroll shadow's edge meets 3:1 on the surface in the ${name} scheme (WCAG 1.4.11)`, () => {
    const t = name === "light" ? light : dark;
    const edge = shade(name);
    assert.ok(ratio(edge, t.surface) >= 3, `${edge} on ${t.surface}: ${ratio(edge, t.surface).toFixed(2)}:1`);
  });
}
for (const [name, theme] of [["light", light], ["dark", dark]] as const) {
  test(`the focus ring and input borders meet 3:1 in the ${name} scheme (WCAG 1.4.11)`, () => {
    const failures = NON_TEXT.filter(([t, bg]) => ratio(theme[t], theme[bg]) < 3).map(([t, bg]) => `${t} ${theme[t]} on ${bg} ${theme[bg]}: ${ratio(theme[t], theme[bg]).toFixed(2)}:1`);
    assert.deepEqual(failures, []);
    assert.ok(ratio("#e9a21b", "#ffffff") < 3, "negative control: the first light ring (#e9a21b) fails 3:1 on white");
  });
}

test("the amount's lighter digits use the checked muted token (review G1d)", () => {
  const src = readFileSync(join(import.meta.dirname, "..", "app", "components", "amount.tsx"), "utf8");
  assert.match(src, /className="amount-zeros"/);
  assert.match(css, /\.amount-zeros \{[^}]*color: var\(--muted\);/, "the shared rule draws them in the checked muted token");
  assert.ok(ratio("#8a8f9b", "#ffffff") < 4.5, "negative control: the first placeholder grey fails 4.5:1 on white");
});

test("the recipients page's flags use the checked warning token (slice H2)", () => {
  const src = readFileSync(join(import.meta.dirname, "..", "app", "recipients", "page.tsx"), "utf8");
  assert.ok([...src.matchAll(/text-warning/g)].length >= 2, "the duplicate and disclosure flags are warning text");
  assert.ok(!/text-(amber|slate|rose|sky|emerald)-\d{3}/.test(src), "no raw palette colour outside the tokens");
});
