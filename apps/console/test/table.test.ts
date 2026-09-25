// Table spacing (slice M1): GOV.UK Frontend's table rule (R93), in one class that every table in the app uses.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { TABLE_CLASS } from "../lib/view/table.ts";

test("TABLE_CLASS carries GOV.UK's cell padding: 10 px vertical, 20 px right, none after the last column", () => {
  const classes = TABLE_CLASS.split(" ");
  for (const c of ["w-full", "text-left", "[&_th]:py-2.5", "[&_td]:py-2.5", "[&_th]:pr-5", "[&_td]:pr-5", "[&_th:last-child]:pr-0", "[&_td:last-child]:pr-0"]) {
    assert.ok(classes.includes(c), c);
  }
});

test("every data table in the app uses TABLE_CLASS; a form grid (inputs in cells, own padding) is marked data-form-grid", () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith(".tsx")) files.push(p);
    }
  };
  walk(join(import.meta.dirname, "../app"));
  let data = 0;
  let grids = 0;
  for (const f of files) {
    for (const m of readFileSync(f, "utf8").matchAll(/<table\b[^>]*>/g)) {
      if (m[0].includes("data-form-grid")) grids++;
      else {
        data++;
        assert.ok(m[0].includes("className={TABLE_CLASS}"), `${f}: ${m[0]}`);
      }
    }
  }
  assert.equal(data, 4, "the batch list, the batch items, recipients, payables");
  assert.equal(grids, 1, "the new-batch form's line grid");
});
