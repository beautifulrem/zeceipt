// Review G1d: de-emphasised amount digits must still be readable text. For a small payment (2,500 zat →
// 0.000|02500) the lighter run is the whole amount, so it must meet WCAG 2.x 1.4.3's 4.5:1 on white.
// The colours are read from the Tailwind theme the app ships (v4 defines them in OKLCH) and converted to sRGB.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const theme = readFileSync(createRequire(import.meta.url).resolve("tailwindcss/theme.css"), "utf8");

/** OKLCH (Björn Ottosson's OKLab, CSS Color 4) → sRGB 0..1, clipped. */
function oklchToSrgb(L: number, C: number, hDeg: number): number[] {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  return lin.map((x) => Math.min(1, Math.max(0, x))).map((x) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055));
}
function contrastOnWhite(shade: string, hue = "slate"): number {
  const m = new RegExp(`--color-${hue}-${shade}:\\s*oklch\\(([\\d.]+)%\\s+([\\d.]+)\\s+([\\d.]+)\\)`).exec(theme);
  assert.ok(m, `${hue}-${shade} in the shipped theme`);
  const rgb = oklchToSrgb(Number(m[1]) / 100, Number(m[2]), Number(m[3]));
  const lum = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 1.05 / (0.2126 * lum[0] + 0.7152 * lum[1] + 0.0722 * lum[2] + 0.05);
}

test("the lighter digits of an amount meet 4.5:1 on white (WCAG 1.4.3), in the palette the app ships", () => {
  const src = readFileSync(join(import.meta.dirname, "..", "app", "components", "amount.tsx"), "utf8");
  const shades = [...src.matchAll(/text-slate-(\d{3})/g)].map((m) => m[1]);
  assert.ok(shades.length > 0, "the component styles its minor digits");
  for (const s of shades) assert.ok(contrastOnWhite(s) >= 4.5, `slate-${s} is ${contrastOnWhite(s).toFixed(2)}:1`);
  assert.ok(contrastOnWhite("400") < 4.5, `negative control: slate-400 (the first choice) is ${contrastOnWhite("400").toFixed(2)}:1`);
});

test("the recipients page's duplicate flag (amber text) meets 4.5:1 on white (slice H2)", () => {
  const src = readFileSync(join(import.meta.dirname, "..", "app", "recipients", "page.tsx"), "utf8");
  const shades = [...src.matchAll(/text-amber-(\d{3})/g)].map((m) => m[1]);
  assert.ok(shades.length > 0, "the flag is styled");
  for (const s of shades) assert.ok(contrastOnWhite(s, "amber") >= 4.5, `amber-${s} is ${contrastOnWhite(s, "amber").toFixed(2)}:1`);
});

test("the void page's warning button (white on rose) meets 4.5:1 (slice H5d)", () => {
  const src = readFileSync(join(import.meta.dirname, "..", "app", "batches", "[id]", "void", "void-form.tsx"), "utf8");
  const shades = [...src.matchAll(/bg-rose-(\d{3})/g)].map((m) => m[1]);
  assert.ok(shades.length > 0, "the warning button is styled");
  for (const s of shades) assert.ok(contrastOnWhite(s, "rose") >= 4.5, `white on rose-${s} is ${contrastOnWhite(s, "rose").toFixed(2)}:1`);
});
