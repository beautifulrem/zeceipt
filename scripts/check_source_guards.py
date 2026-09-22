#!/usr/bin/env python3
"""Source guards run in CI (NFR-1 / REQ-CLI-6 and NFR-6).

1. No key-material vocabulary in non-test library/binary code anywhere in the workspace:
   whole words `seed`, `mnemonic`, `spending` (case-insensitive) in `crates/*/src/**/*.rs`,
   ignoring comment lines and everything after `#[cfg(test)]`. Integration tests and examples
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
for path in files:
    text = path.read_text(encoding="utf-8")
    non_test = text.split("#[cfg(test)]")[0]
    for i, line in enumerate(non_test.splitlines(), 1):
        if line.lstrip().startswith("//"):
            continue
        if key_re.search(line):
            hits.append(f"{path.relative_to(repo)}:{i}: key-material term: {line.strip()}")
    for i, line in enumerate(text.splitlines(), 1):
        if log_re.search(line) and secret_re.search(line):
            hits.append(f"{path.relative_to(repo)}:{i}: log line mentions ock/ovk/memo: {line.strip()}")
print(f"source guards: {len(files)} files scanned")
if hits:
    print("\n".join(hits))
    sys.exit(1)
print("source guards passed")
