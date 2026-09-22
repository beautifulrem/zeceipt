#!/usr/bin/env python3
"""Consistency checks for docs/product/.

- every [Rn] cited anywhere resolves to a row in 10_research_log.md
- every requirement id (REQ-*/NFR-*) is unique
- every level-4 WBS leaf carries a status glyph
- the WBS roll-up table matches the counted leaves
- every REQ id referenced from the WBS exists
Exit 1 on any failure.
"""
import re
import sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent / "docs" / "product"
files = {p.name: p.read_text(encoding="utf-8") for p in sorted(root.glob("*.md"))}
errors = []

# [Rn] references
log = files.get("10_research_log.md", "")
defined = set(re.findall(r"^\| (R\d+) \|", log, re.M))
for name, text in files.items():
    for ref in set(re.findall(r"\[(R\d+)\]", text)):
        if ref not in defined:
            errors.append(f"{name}: unresolved reference [{ref}]")

# requirement ids
req_text = files.get("01_requirements.md", "")
req_defs = req_text.split("## 8. Traceability")[0]  # definition tables only
ids = re.findall(r"^\| ((?:REQ|NFR)-[A-Z0-9-]+)", req_defs, re.M)
# traceability: every defined id must be mentioned in the matrix (directly or via a range "REQ-X-1 … -4")
matrix = req_text.split("## 8. Traceability")[1] if "## 8. Traceability" in req_text else ""
def covered(i):
    if i in matrix:
        return True
    prefix, num = i.rsplit("-", 1)
    for a, b in re.findall(rf"{re.escape(prefix)}-(\d+) … -(\d+)", matrix):
        if int(a) <= int(num) <= int(b):
            return True
    for m in re.finditer(rf"{re.escape(prefix)}-(\d+)((?:, -\d+)+)", matrix):
        if num in [m.group(1)] + [x.strip("- ") for x in m.group(2).split(",") if x.strip()]:
            return True
    return False
for i in ids:
    if not covered(i):
        errors.append(f"01_requirements.md: {i} missing from traceability matrix")
dupes = {i for i in ids if ids.count(i) > 1}
for d in sorted(dupes):
    errors.append(f"01_requirements.md: duplicate id {d}")
id_set = set(ids)

# WBS leaves
wbs = files.get("00_wbs.md", "")
leaf_re = re.compile(r"^- (\d+\.\d+\.\d+\.\d+) (.*)$", re.M)
glyphs = ("✅", "🟡", "⬜", "👤", "❌")
counts = {}
for m in leaf_re.finditer(wbs):
    num, rest = m.groups()
    phase = num.split(".")[0]
    if not any(g in rest[:12] for g in glyphs):
        errors.append(f"00_wbs.md: leaf {num} has no status glyph")
    c = counts.setdefault(phase, {"leaves": 0, "✅": 0, "🟡": 0, "⬜": 0, "👤": 0})
    c["leaves"] += 1
    head = rest[:12]
    if "👤" in head:
        c["👤"] += 1
    elif "✅" in head:
        c["✅"] += 1
    elif "🟡" in head:
        c["🟡"] += 1
    elif "⬜" in head:
        c["⬜"] += 1
    for ref in re.findall(r"REQ-[A-Z]+-\d+", rest):
        if ref not in id_set:
            errors.append(f"00_wbs.md: leaf {num} references unknown {ref}")

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

# depth: every task heading (####) must have at least one level-4 leaf under it
for m in re.finditer(r"^#### (\d+\.\d+\.\d+) .*$", wbs, re.M):
    task = m.group(1)
    if not re.search(rf"^- {re.escape(task)}\.\d+ ", wbs, re.M):
        errors.append(f"00_wbs.md: task {task} has no level-4 leaves")

print(f"leaves per phase: { {k: v['leaves'] for k, v in counts.items()} }")
if errors:
    print("\n".join(errors))
    sys.exit(1)
print("product docs consistent")
