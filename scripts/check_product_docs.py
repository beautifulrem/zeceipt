#!/usr/bin/env python3
"""Consistency checks for docs/product/.

- every [Rn] cited anywhere resolves to a row in 10_research_log.md, and every row is cited
- every requirement id (REQ-*/NFR-*) is unique and appears in the §8 traceability matrix
- §8 leaf numbers exist in 00_wbs.md; ⬜ rows never cite PROOF as evidence
- every test name cited in 01_requirements.md / 00_wbs.md exists under crates/
- every level-4 WBS leaf carries a status glyph; every task heading has leaves
- the WBS roll-up table (incl. Total) matches the counted leaves
- every REQ id referenced from the WBS exists
- every `NN_file.md` §n reference points at an existing section
Exit 1 on any failure.
"""
import re
import subprocess
import sys
from pathlib import Path

repo = Path(__file__).resolve().parent.parent
root = repo / "docs" / "product"
files = {p.name: p.read_text(encoding="utf-8") for p in sorted(root.glob("*.md"))}
errors = []

# [Rn] references, both directions
log = files.get("10_research_log.md", "")
defined = set(re.findall(r"^\| (R\d+) \|", log, re.M))
cited = set()
for name, text in files.items():
    for ref in set(re.findall(r"\[(R\d+)\]", text)):
        cited.add(ref)
        if ref not in defined:
            errors.append(f"{name}: unresolved reference [{ref}]")
for ref in sorted(defined - cited, key=lambda r: int(r[1:])):
    errors.append(f"10_research_log.md: {ref} is defined but never cited")

# requirement ids (definition tables only)
req_text = files.get("01_requirements.md", "")
req_defs, _, matrix = req_text.partition("## 8. Traceability")
ids = re.findall(r"^\| ((?:REQ|NFR)-[A-Z0-9-]+)", req_defs, re.M)
for d in sorted({i for i in ids if ids.count(i) > 1}):
    errors.append(f"01_requirements.md: duplicate id {d}")
id_set = set(ids)
matrix_rows = re.findall(r"^\| ((?:REQ|NFR)-[A-Z0-9-]+) \| (\S+) \| ([\d.]+) \| (.*) \|$", matrix, re.M)
matrix_ids = [r[0] for r in matrix_rows]
for i in ids:
    if i not in matrix_ids:
        errors.append(f"01_requirements.md: {i} missing from traceability matrix")
for i in matrix_ids:
    if i not in id_set:
        errors.append(f"01_requirements.md: matrix row {i} has no definition")

# WBS leaves
wbs = files.get("00_wbs.md", "")
leaf_re = re.compile(r"^- (\d+\.\d+\.\d+\.\d+) (.*)$", re.M)
glyphs = ("✅", "🟡", "⬜", "👤", "❌")
counts = {}
leaf_ids = set()
for m in leaf_re.finditer(wbs):
    num, rest = m.groups()
    leaf_ids.add(num)
    phase = num.split(".")[0]
    head = rest[:12]
    if not any(g in head for g in glyphs):
        errors.append(f"00_wbs.md: leaf {num} has no status glyph")
    c = counts.setdefault(phase, {"leaves": 0, "✅": 0, "🟡": 0, "⬜": 0, "👤": 0})
    c["leaves"] += 1
    for g in ("👤", "✅", "🟡", "⬜"):
        if g in head:
            c[g] += 1
            break
    for ref in re.findall(r"REQ-[A-Z]+-\d+", rest):
        if ref not in id_set:
            errors.append(f"00_wbs.md: leaf {num} references unknown {ref}")

# matrix leaf numbers and PROOF rule
for rid, status, leaf, evidence in matrix_rows:
    if leaf not in leaf_ids:
        errors.append(f"01_requirements.md: {rid} cites WBS leaf {leaf} which does not exist")
    if status == "⬜" and "PROOF" in evidence:
        errors.append(f"01_requirements.md: {rid} is ⬜ but cites PROOF as evidence")

# roll-up table
for phase, c in counts.items():
    row = re.search(rf"^\| {phase} [^|]*\| (\d+) \| (\d+) \| (\d+) \| (\d+) \| (\d+)", wbs, re.M)
    if not row:
        errors.append(f"00_wbs.md: roll-up row for phase {phase} missing")
        continue
    got = tuple(int(x) for x in row.groups())
    want = (c["leaves"], c["✅"], c["🟡"], c["⬜"], c["👤"])
    if got != want:
        errors.append(f"00_wbs.md: roll-up for phase {phase} says {got}, counted {want}")
total = re.search(r"^\| \*\*Total\*\* \| (\d+) \| (\d+) \| (\d+) \| (\d+) \| (\d+)", wbs, re.M)
want_total = tuple(sum(c[k] for c in counts.values()) for k in ("leaves", "✅", "🟡", "⬜", "👤"))
if not total:
    errors.append("00_wbs.md: Total row missing")
elif tuple(int(x) for x in total.groups()) != want_total:
    errors.append(f"00_wbs.md: Total row says {total.groups()}, counted {want_total}")

# depth: every task heading (####) must have at least one level-4 leaf under it
for m in re.finditer(r"^#### (\d+\.\d+\.\d+) .*$", wbs, re.M):
    task = m.group(1)
    if not re.search(rf"^- {re.escape(task)}\.\d+ ", wbs, re.M):
        errors.append(f"00_wbs.md: task {task} has no level-4 leaves")

# cited test names exist under crates/
crate_src = ""
for p in (repo / "crates").rglob("*.rs"):
    crate_src += p.read_text(encoding="utf-8")
test_names = set()
for text in (req_text, wbs):
    for name in re.findall(r"`([a-z][a-z0-9_]{12,})`", text):
        if re.search(r"(test|round_trip|verif|exit|match|fixture|vector|pack|stage)", name) and not name.endswith("_zat"):
            test_names.add(name)
for name in sorted(test_names):
    if not re.search(rf"fn {re.escape(name)}\b", crate_src):
        errors.append(f"cited test `{name}` not found under crates/")

# doc section references like `05_data_model_api.md` §3 or `05` §3
short = {n.split("_")[0]: n for n in files}
for name, text in files.items():
    for doc, sec in re.findall(r"`(\d\d(?:_[a-z_]+\.md)?)` §(\d+)", text):
        target = files.get(doc) if doc.endswith(".md") else files.get(short.get(doc, ""))
        if target is None:
            errors.append(f"{name}: reference to unknown doc {doc}")
        elif not re.search(rf"^## {sec}\.", target, re.M):
            errors.append(f"{name}: {doc} §{sec} does not exist")

print(f"leaves per phase: { {k: v['leaves'] for k, v in counts.items()} }; tests checked: {len(test_names)}")
if errors:
    print("\n".join(errors))
    sys.exit(1)
print("product docs consistent")
