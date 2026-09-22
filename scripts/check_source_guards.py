#!/usr/bin/env python3
"""Source guards run in CI (NFR-1 / REQ-CLI-6 and NFR-6).

1. No key-material vocabulary in non-test library/binary code, nor in `scripts/*.py` unless the file carries the
   marker `# key-material-allowed: regtest-only harness` (currently only the Zkool regtest tracer):
   whole words `seed`, `mnemonic`, `spending` (case-insensitive) in `crates/*/src/**/*.rs`,
   ignoring line comments (whole-line or trailing), `/* */` block comments and everything after `#[cfg(test)]`. Integration tests and examples
   are excluded (they may build keys for fixtures).
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
log_re = re.compile(r"\b(trace|debug|info|warn|error)!\s*\(")
secret_re = re.compile(r"\b(ock|ovk|memo)\b", re.I)
files = sorted((repo / "crates").glob("*/src/**/*.rs"))
# Regtest-only harness scripts are scanned too; a file may opt out only with an explicit, justified marker line.
ALLOW_MARK = "# key-material-allowed: regtest-only harness"
py_files = [p for p in sorted((repo / "scripts").glob("*.py")) if p.name != "check_source_guards.py"]
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
    for i, line in enumerate(text.splitlines(), 1):
        if log_re.search(line) and secret_re.search(line):
            hits.append(f"{path.relative_to(repo)}:{i}: log line mentions ock/ovk/memo: {line.strip()}")
py_scanned = 0
for path in py_files:
    text = path.read_text(encoding="utf-8")
    if any(ln.strip().startswith(ALLOW_MARK) for ln in text.splitlines()[:3]):
        continue  # documented carve-out (NFR-1): the marker must be a comment in the first three lines
    py_scanned += 1
    for i, line in enumerate(text.splitlines(), 1):
        code = line.split("#", 1)[0]
        if key_re.search(code):
            hits.append(f"{path.relative_to(repo)}:{i}: key-material term in a script without the carve-out marker: {line.strip()}")
print(f"source guards: {len(files)} crate files + {py_scanned} scripts scanned ({len(py_files) - py_scanned} carve-out)")
if hits:
    print("\n".join(hits))
    sys.exit(1)
print("source guards passed")
