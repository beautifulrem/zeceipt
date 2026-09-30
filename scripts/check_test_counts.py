#!/usr/bin/env python3
"""The test counts the docs state must be the counts the suites have (PM round 1, D15: the README said 524 and 459
while CI ran 530 and 465, and nothing noticed).

Counted from source, always:
- Rust: every `#[test]` / `#[tokio::test]` under crates/ (CI runs them all, with the synthetic feature).
- The receipt page's Chrome e2e: every top-level `test(` in packages/verify/test/page.e2e.mjs.

Counted from a run, when given (CI passes its logs):
- --console-log FILE: the output of `node --test test/*.test.ts` in apps/console ("ℹ tests N", "ℹ pass N", "ℹ skipped N").
- --app-e2e-log FILE: the output of `node --test test/app.e2e.test.ts` ("ℹ tests N").
Without a log, the docs must still agree with one another.

Checked: the README's badge and command comments, 09_submission_checklist.md's description and rubric row, and
00_wbs.md 3.4.2.1. Exit 1 on any disagreement.
"""
import argparse
import re
import sys
from pathlib import Path

repo = Path(__file__).resolve().parent.parent
errors = []


def read(rel):
    return (repo / rel).read_text(encoding="utf-8")


def node_summary(path, key):
    m = re.search(rf"^ℹ {key} (\d+)$", Path(path).read_text(encoding="utf-8"), re.M)
    if not m:
        sys.exit(f"check_test_counts: no 'ℹ {key} N' line in {path}")
    return int(m.group(1))


def find(rel, pattern, text=None):
    text = read(rel) if text is None else text
    found = re.findall(pattern, text)
    if not found:
        errors.append(f"{rel}: no match for {pattern!r}")
    return found


ap = argparse.ArgumentParser()
ap.add_argument("--console-log")
ap.add_argument("--app-e2e-log")
args = ap.parse_args()

rust = sum(len(re.findall(r"#\[(?:tokio::)?test(?:\([^)]*\))?\]", p.read_text(encoding="utf-8")))
           for p in (repo / "crates").rglob("*.rs"))
page = len(re.findall(r"^test\(", read("packages/verify/test/page.e2e.mjs"), re.M))

# What the docs say.
readme = read("README.md")
said = {
    "README badge alt": find("README.md", r'alt="(\d+) tests"', readme),
    "README badge": find("README.md", r"badge/tests-(\d+)-", readme),
    "README Rust": find("README.md", r"# (\d+) tests, including the official", readme),
}
console_line = find("README.md", r"# (\d+) console tests: (\d+) run by default, (\d+) opt-in", readme)
checklist = read("docs/product/09_submission_checklist.md")
cl = find("docs/product/09_submission_checklist.md", r"(\d+) (?:automated )?tests \((\d+) Rust, (\d+) TypeScript\)", checklist)
wbs = find("docs/product/00_wbs.md", r"3\.4\.2\.1 ✅ R — (\d+) Rust tests \+ (\d+) TypeScript console tests")
wbs_app = find("docs/product/00_wbs.md", r"3\.4\.2\.1 ✅ R —.*?the (\d+) build-and-serve tests")
wbs_page = find("docs/product/00_wbs.md", r"3\.4\.2\.1 ✅ R —.*?the public receipt page's (\d+) Chrome tests")
if errors:
    print("\n".join(errors))
    sys.exit(1)

total_c, run_c, optin_c = (int(x) for x in console_line[0])
if total_c != run_c + optin_c:
    errors.append(f"README: {total_c} console tests is not {run_c} run + {optin_c} opt-in")
if args.console_log:
    got = (node_summary(args.console_log, "tests"), node_summary(args.console_log, "pass"), node_summary(args.console_log, "skipped"))
    if got != (total_c, run_c, optin_c):
        errors.append(f"README says {total_c} console tests ({run_c} run, {optin_c} opt-in); the run had {got[0]} ({got[1]} passed, {got[2]} skipped)")
if args.app_e2e_log:
    got = node_summary(args.app_e2e_log, "tests")
    if int(wbs_app[0]) != got:
        errors.append(f"00_wbs.md 3.4.2.1 says {wbs_app[0]} build-and-serve tests; the run had {got}")

default_total = rust + run_c
for where, values in said.items():
    for v in values:
        want = rust if where == "README Rust" else default_total
        if int(v) != want:
            errors.append(f"{where}: {v}, expected {want}")
for t, r, ts in cl:
    if (int(t), int(r), int(ts)) != (default_total, rust, run_c):
        errors.append(f"09_submission_checklist.md: '{t} tests ({r} Rust, {ts} TypeScript)', expected {default_total} ({rust} Rust, {run_c} TypeScript)")
for r, ts in wbs:
    if (int(r), int(ts)) != (rust, run_c):
        errors.append(f"00_wbs.md 3.4.2.1: {r} Rust + {ts} TypeScript, expected {rust} + {run_c}")
if int(wbs_page[0]) != page:
    errors.append(f"00_wbs.md 3.4.2.1: {wbs_page[0]} receipt-page Chrome tests, expected {page}")

if errors:
    print("\n".join(errors))
    sys.exit(1)
print(f"test counts consistent: {rust} Rust + {run_c} console = {default_total} by default; {page} receipt-page e2e")
