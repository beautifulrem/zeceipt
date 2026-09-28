#!/usr/bin/env python3
"""Source guards run in CI (NFR-1 / REQ-CLI-6 and NFR-6).

1. No key-material vocabulary in non-test library/binary code (crates, `apps/console/lib/**/*.ts`, `apps/console/db/**/*.ts` and the console app: `app/**/*.ts(x)`, `instrumentation.ts`, `proxy.ts`, `next.config.ts`; the browser verifier's `packages/verify/src/*.js` and the receipt page's `packages/verify/r/*.js`), nor in any `scripts/**/*.py|*.sh` code line unless the file carries the header marker
   `# key-material-allowed: regtest-only harness` in its first three lines AND that line is tagged
   `# key-material-allowed` (currently only the Zkool regtest tracer, two lines):
   whole words `seed`, `mnemonic`, `spending` (case-insensitive) in `crates/*/src/**/*.rs`,
   ignoring line comments (whole-line or trailing), `/* */` block comments and everything after `#[cfg(test)]`. Integration tests and examples
   are excluded (they may build keys for fixtures).
   Zcash spending-key construction is matched as well, by identifier (`SpendingKey`, `ExtendedSpendingKey`,
   `UnifiedSpendingKey`, `spending_key`/`spendingKey`, `from_seed`), in the same crate, console and verifier code (slice
   G1: a word list alone passes a renamed variable). One file is exempt from this identifier rule, by name:
   `crates/zeceipt-core/src/synthetic.rs`, test support that builds throwaway keys for synthetic fixtures, compiled
   only with the `synthetic` feature; the guard fails if `lib.rs` stops gating it behind that feature.
2. No log macro line (`trace!/debug!/info!/warn!/error!`) mentions `ock`, `ovk` or `memo` as a
   whole word, in any crate source (tests included).
Exit 1 on a hit; prints each offending line.
"""
import re
import sys
from pathlib import Path

repo = Path(__file__).resolve().parent.parent
hits = []
key_re = re.compile(r"\b(seed|mnemonic|spending)\b", re.I)
spend_re = re.compile(r"\b(?:unified|extended)?spending_?key\b|\bfrom_seed\b", re.I)
SYNTHETIC = repo / "crates" / "zeceipt-core" / "src" / "synthetic.rs"
if not re.search(r'#\[cfg\(feature = "synthetic"\)\]\s*pub mod synthetic;', (repo / "crates" / "zeceipt-core" / "src" / "lib.rs").read_text(encoding="utf-8")):
    print("crates/zeceipt-core/src/lib.rs: the synthetic module is no longer behind `#[cfg(feature = \"synthetic\")]`, so its exemption no longer holds")
    sys.exit(1)
log_re = re.compile(r"\b(trace|debug|info|warn|error)!\s*\(")
secret_re = re.compile(r"\b(ock|ovk|memo)\b", re.I)
files = sorted((repo / "crates").glob("*/src/**/*.rs"))
# Regtest-only harness scripts are scanned too; a file may opt out only with an explicit, justified marker line.
ALLOW_MARK = "# key-material-allowed: regtest-only harness"
py_files = [p for p in sorted((repo / "scripts").rglob("*")) if p.suffix in (".py", ".sh") and p.name != "check_source_guards.py"]
# The console's TypeScript library, database layer and Next.js app ship in the product: scanned like crate code
# (no carve-out possible). The app: route handlers and pages under app/, plus the root instrumentation, proxy and config.
console = repo / "apps" / "console"
ts_files = sorted([
    *(console / "lib").rglob("*.ts"),
    *(console / "db").rglob("*.ts"),
    *(p for p in (console / "app").rglob("*") if p.suffix in (".ts", ".tsx")),
    *(p for p in (console / "instrumentation.ts", console / "proxy.ts", console / "next.config.ts") if p.exists()),
])
# The browser verifier's hand-written JavaScript ships too: the npm wrapper and the public receipt page.
# Same rules as the console (the wasm-pack output in pkg/ is generated and not scanned).
verify_pkg = repo / "packages" / "verify"
web_files = sorted([*(verify_pkg / "src").glob("*.js"), *(verify_pkg / "r").glob("*.js")])
for path in files:
    text = path.read_text(encoding="utf-8")
    non_test = text.split("#[cfg(test)]")[0]
    in_block = False
    for i, line in enumerate(non_test.splitlines(), 1):
        code = line
        if in_block:
            if "*/" in code:
                code = code.split("*/", 1)[1]
                in_block = False
            else:
                continue
        while "/*" in code:  # strip /* ... */ spans, possibly unterminated on this line
            head, _, tail = code.partition("/*")
            if "*/" in tail:
                code = head + tail.split("*/", 1)[1]
            else:
                code, in_block = head, True
        code = re.sub(r'"(?:[^"\\]|\\.)*"', '""', code)  # blank string literals so a // inside a URL is not a comment
        code = code.split("//", 1)[0]  # drop trailing // comments (also skips whole-line //, /// and //!)
        if key_re.search(code):
            hits.append(f"{path.relative_to(repo)}:{i}: key-material term: {line.strip()}")
        if path != SYNTHETIC and spend_re.search(code):
            hits.append(f"{path.relative_to(repo)}:{i}: spending-key construction: {line.strip()}")
    for i, line in enumerate(text.splitlines(), 1):
        if log_re.search(line) and secret_re.search(line):
            hits.append(f"{path.relative_to(repo)}:{i}: log line mentions ock/ovk/memo: {line.strip()}")
for path in [*ts_files, *web_files]:
    text = path.read_text(encoding="utf-8")
    for i, line in enumerate(text.splitlines(), 1):
        code = re.sub(r"'(?:[^'\\]|\\.)*'|\"(?:[^\"\\]|\\.)*\"|`(?:[^`\\]|\\.)*`", '""', line).split("//", 1)[0]
        if line.strip().startswith(("//", "*", "/*")):
            continue
        if key_re.search(code):
            hits.append(f"{path.relative_to(repo)}:{i}: key-material term in shipped code: {line.strip()}")
        if spend_re.search(code):
            hits.append(f"{path.relative_to(repo)}:{i}: spending-key construction in shipped code: {line.strip()}")
        if log_re.search(code) or re.search(r"console\.(log|info|warn|error|debug)\(", code):
            if secret_re.search(code):
                hits.append(f"{path.relative_to(repo)}:{i}: log line mentions ock/ovk/memo: {line.strip()}")
py_scanned = 0
carve_outs = 0
for path in py_files:
    text = path.read_text(encoding="utf-8")
    carved = any(ln.strip().startswith(ALLOW_MARK) for ln in text.splitlines()[:3])
    py_scanned += 1
    carve_outs += 1 if carved else 0
    in_doc = False
    for i, line in enumerate(text.splitlines(), 1):
        stripped = line.strip()
        if stripped.count('"""') % 2 == 1:
            in_doc = not in_doc
            continue
        if in_doc or stripped.startswith("#"):
            continue  # docstrings and comments may describe the mechanism
        code = re.sub(r"'(?:[^'\\]|\\.)*'|\"(?:[^\"\\]|\\.)*\"", '""', line)  # blank string literals
        code, _, tail = code.partition("#")
        if key_re.search(code):
            # per-line carve-out: the file must carry the header marker AND the line must be tagged
            if carved and "key-material-allowed" in tail:
                continue
            hits.append(f"{path.relative_to(repo)}:{i}: key-material term in a script line without a per-line `# key-material-allowed` tag: {line.strip()}")
print(f"source guards: {len(files)} crate files + {len(ts_files)} console lib/db/app files + {len(web_files)} browser verifier files + {py_scanned} scripts scanned (carve-out files: {carve_outs}; feature-gated exemption: 1)")
if hits:
    print("\n".join(hits))
    sys.exit(1)
print("source guards passed")
