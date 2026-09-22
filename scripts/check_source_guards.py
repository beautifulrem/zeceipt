#!/usr/bin/env python3
"""Source guards run in CI (NFR-1 / REQ-CLI-6 and NFR-6).

1. No key-material vocabulary in non-test library/binary code, nor in any `scripts/**/*.py|*.sh` code line unless the file carries the header marker
   `# key-material-allowed: regtest-only harness` in its first three lines AND that line is tagged
   `# key-material-allowed` (currently only the Zkool regtest tracer, two lines):
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
py_files = [p for p in sorted((repo / "scripts").rglob("*")) if p.suffix in (".py", ".sh") and p.name != "check_source_guards.py"]
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
print(f"source guards: {len(files)} crate files + {py_scanned} scripts scanned (carve-out files: {carve_outs})")
if hits:
    print("\n".join(hits))
    sys.exit(1)
print("source guards passed")
