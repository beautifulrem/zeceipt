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
- every 👤 leaf is in the Asks table; 11_plan.md §3 columns match WBS owners; every pd-bearing leaf is scheduled in §3; per window each owner ≤ 0.75 pd/day counting {budget}/{buffer} tokens (which must total Must 6 and Buffer) and leaf dates lie inside their window; §1 person-days equal WBS leaf sums; §1 Total/done/open/slack and the per-owner loads recomputed; every pd-bearing leaf is kept or dropped in §1.1 and the Solo column in 01 §4–§6 agrees; no Must leaf in the last two windows, every window holding a submission deliverable or process step names a fallback; NFRs carry a Solo value too; 'reduced' cells must cite a kept leaf; a 'dropped' requirement may not be named on (or traced in §8 to) a kept or ✅ leaf; a 'kept' cell may not carry a qualifier (only/without/no); W rows need no leaf; no two requirements share three consecutive normalised words of obligation text; capability sentences in 04/05/07 cite a requirement id; the §0 Must-set list is sorted; every buffer figure in §1.1 and RSK-19 equals the solo Buffer row and the reserve total equals buffer + below-the-line cuts; solo kept prices equal WBS prices unless marked reduced (and lower); solo rows, scaling, kept total and Buffer = Capacity − Kept recomputed; baseline and per-owner capacities derived from the stated date range; every cited REQ/NFR id exists and non-Must ids in the policy docs are marked planned/cut; every §3 body row parses as a window; status cells cite existing leaves
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
prio = dict(re.findall(r"^\| (REQ-[A-Z]+-\d+) \| ([MSCW]) \|", req_defs, re.M))  # requirement priorities (NFRs seeded later)
matrix_rows = re.findall(r"^\| ((?:REQ|NFR)-[A-Z0-9-]+) \| (\S+) \| ([\d.]+|—) \| (.*) \|$", matrix, re.M)
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
    if leaf == "—":
        if prio.get(rid) != "W":
            errors.append(f"01_requirements.md: {rid} has no WBS leaf in §8 but is not priority W")
        continue
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

# owner letters and person-days per leaf
owner_of, pd_of = {}, {}
for m in leaf_re.finditer(wbs):
    num, rest = m.groups()
    om = re.search(r"^(?:[✅🟡⬜👤❌]\s*)+([A-Z]{1,2}(?:/[A-Z]{1,2})?) —", rest)
    if om:
        owner_of[num] = om.group(1)
    pm = re.search(r"(\d+(?:\.\d+)?) pd", rest)
    if pm:
        pd_of[num] = float(pm.group(1))

# every 👤 leaf appears in the Asks table
asks = wbs.split("## Asks of the user")[1].split("## Roll-up")[0] if "## Asks of the user" in wbs else ""
for num, owner in owner_of.items():
    line = re.search(rf"^- {re.escape(num)} (.*)$", wbs, re.M).group(1)
    if "👤" in line[:12] and not re.search(rf"\| {re.escape(num)} \|", asks):
        errors.append(f"00_wbs.md: 👤 leaf {num} missing from the Asks of the user table")

# 11_plan.md §3 columns agree with WBS owner letters
plan = files.get("11_plan.md", "")
sched = plan.split("## 3.")[1].split("## 4.")[0] if "## 3." in plan else ""
for row in re.findall(r"^\| [^|]+ \| ([^|]*) \| ([^|]*) \| [^|]*\|$", sched, re.M):
    rcell, tcell = row
    for num in re.findall(r"\b(\d\.\d\.\d\.\d)\b", rcell):
        if owner_of.get(num) not in ("R",):
            errors.append(f"11_plan.md §3: leaf {num} in the R column is owned by {owner_of.get(num)}")
    for num in re.findall(r"\b(\d\.\d\.\d\.\d)\b", tcell):
        if owner_of.get(num) not in ("T", "PM", "U", "PM/U"):
            errors.append(f"11_plan.md §3: leaf {num} in the T/PM column is owned by {owner_of.get(num)}")

# 11_plan.md §1 rows that cite "WBS x.y[.z]" must equal the sum of leaf person-days
budget = plan.split("## 1.")[1].split("### 1.1")[0] if "## 1." in plan else ""
for name, wbs_cell, pd_cell in re.findall(r"^\| ([^|]+) \| WBS ([^|]+) \| ([\d.]+) \|", budget, re.M):
    prefixes = [x.strip() for x in wbs_cell.split(",")]
    total_pd = sum(v for k, v in pd_of.items() if any(k == p or k.startswith(p + ".") for p in prefixes))
    if abs(total_pd - float(pd_cell)) > 1e-6:
        errors.append(f"11_plan.md §1: '{name.strip()}' says {pd_cell} pd but WBS leaves {prefixes} sum to {total_pd}")

# slack line: capacity − (Total − Σ pd of ✅ rows) must equal the stated slack; Total must equal Σ rows
rows_pd = re.findall(r"^\| (?!\*\*Total)([^|]+) \| [^|]* \| (\d+(?:\.\d+)?) \| [^|]* \| ([^|]*) \|$", budget, re.M)
tot_m = re.search(r"^\| \*\*Total\*\* \| \| \*\*(\d+(?:\.\d+)?)\*\* \| \| .*?\*\*(\d+(?:\.\d+)?)\*\* → open \*\*(\d+(?:\.\d+)?)\*\* vs capacity \*\*(\d+(?:\.\d+)?)\*\*.*?slack \*\*(\d+(?:\.\d+)?)\*\*", budget, re.M)
if not tot_m:
    errors.append("11_plan.md §1: Total row with done/open/capacity/slack not found")
else:
    total_s, done_s, open_s, cap_s, slack_s = (float(x) for x in tot_m.groups())
    sum_rows = sum(float(v) for _, v, _ in rows_pd)
    sum_done = sum(float(v) for _, v, st in rows_pd if st.strip().startswith("✅"))
    if abs(sum_rows - total_s) > 1e-6:
        errors.append(f"11_plan.md §1: Total says {total_s} but rows sum to {sum_rows}")
    if abs(sum_done - done_s) > 1e-6 or abs(total_s - done_s - open_s) > 1e-6 or abs(cap_s - open_s - slack_s) > 1e-6:
        errors.append(f"11_plan.md §1: done/open/slack inconsistent: done rows {sum_done}, stated done {done_s}, open {open_s}, capacity {cap_s}, slack {slack_s}")

# every pd-bearing leaf appears in a §3 schedule row
sched_leaves = set(re.findall(r"\b(\d\.\d\.\d\.\d)\b", sched))
for num in sorted(pd_of):
    if num not in sched_leaves:
        errors.append(f"11_plan.md §3: leaf {num} carries person-days but is in no schedule row")

# per-owner load sentence equals the sum of the Owner-column splits over open (non-✅) rows
load = {"R": 0.0, "T": 0.0}
for name, wbs_cell, pd_cell, owner_cell, status in re.findall(r"^\| (?!\*\*Total)([^|]+) \| ([^|]*) \| (\d+(?:\.\d+)?) \| ([^|]*) \| ([^|]*) \|$", budget, re.M):
    if status.strip().startswith("✅"):
        continue
    if re.search(r"\b(R|T|PM|U)/(R|T|PM|U)\b", owner_cell) and "PM/U" not in owner_cell:
        errors.append(f"11_plan.md §1: ambiguous owner cell '{owner_cell.strip()}' in row '{name.strip()}'")
    parts = re.findall(r"\b(R|T|PM)\b(?:/U)?\s*(\d+(?:\.\d+)?)?", owner_cell)
    if not parts:
        continue
    if all(v == "" for _, v in parts):
        load["R" if parts[0][0] == "R" else "T"] += float(pd_cell)
    else:
        for o, v in parts:
            load["R" if o == "R" else "T"] += float(v or 0)
stated = re.search(r"\*\*R = (\d+(?:\.\d+)?)\*\*.*?\*\*T/PM = (\d+(?:\.\d+)?)\*\*", plan, re.S)
if not stated:
    errors.append("11_plan.md §1: per-owner load sentence (**R = x** … **T/PM = y**) not found")
else:
    r_s, t_s = float(stated.group(1)), float(stated.group(2))
    if abs(load["R"] - r_s) > 1e-6 or abs(load["T"] - t_s) > 1e-6:
        errors.append(f"11_plan.md §1: per-owner load says R {r_s} / T-PM {t_s} but Owner splits sum to R {load['R']} / T-PM {load['T']}")

# calendar levelling: per window, Σ leaf pd per owner ≤ 0.75 × days; leaf WBS dates lie inside the window listing them
import datetime as _dt
def _d(md):  # "MM-DD" → date in 2026
    m, d = md.split("-")
    return _dt.date(2026, int(m), int(d))
cut_day_one = {}  # leaf → pd freed on day one (whole leaf or a reduction)
cut_tbl = plan.split("## 2.")[1].split("## 3.")[0] if "## 2." in plan else ""
for cut, frees, note in re.findall(r"^\| \d+ \| ([^|]*) \| [^|]* \| (\d+(?:\.\d+)?) \| ([^|]*) \|$", cut_tbl, re.M):
    if "applied on day one" in note:
        for n in re.findall(r"\b(\d\.\d\.\d\.\d)\b", cut):
            cut_day_one[n] = float(frees)
leaf_dates = {}
for m in leaf_re.finditer(wbs):
    num, rest = m.groups()
    dm = re.search(r"pd, (\d{4}-\d{2}-\d{2})(?: → (\d{2}-\d{2}))?", rest)
    if dm:
        a = _dt.date.fromisoformat(dm.group(1))
        b = _d(dm.group(2)) if dm.group(2) else a
        leaf_dates[num] = (a, b)
windows = 0
for wm in re.finditer(r"^\s*\| (\d{2}-\d{2})(?: → (\d{2}-\d{2}))? \| ([^|]*) \| ([^|]*) \| [^|]*\|$", sched, re.M):
    w0 = _d(wm.group(1)); w1 = _d(wm.group(2)) if wm.group(2) else w0
    days = (w1 - w0).days + 1
    windows += 1
    for col, cell in (("R", wm.group(3)), ("T/PM", wm.group(4))):
        live = re.sub(r"\[[^\]]*\]", "", cell)  # bracketed = cut / restored-only
        nums = re.findall(r"\b(\d\.\d\.\d\.\d)\b", live)
        load_w = sum(max(pd_of.get(n, 0.0) - cut_day_one.get(n, 0.0), 0.0) for n in nums)
        load_w += sum(float(x) for x in re.findall(r"\{(?:budget|buffer) (\d+(?:\.\d+)?)\}", live))
        if load_w > 0.75 * days + 1e-6:
            errors.append(f"11_plan.md §3: window {wm.group(1)}{' → ' + wm.group(2) if wm.group(2) else ''} {col} load {load_w} pd exceeds {0.75 * days} pd")
        for n in re.findall(r"\b(\d\.\d\.\d\.\d)\b", cell):
            if n in leaf_dates:
                a, b = leaf_dates[n]
                if a < w0 or b > w1:
                    errors.append(f"00_wbs.md: leaf {n} dated {a} → {b} but listed in window {w0} → {w1}")
sched_tbl = sched.split("| Window |")[1] if "| Window |" in sched else ""
body_rows = [ln for ln in sched_tbl.splitlines()[2:] if ln.strip().startswith("|")]  # skip header line remainder + separator
if windows != len(body_rows):
    errors.append(f"11_plan.md §3: {len(body_rows)} table body rows but only {windows} parsed as windows (a malformed date or cell separator hides a row from the checks)")
if windows == 0:
    errors.append("11_plan.md §3: no dated windows found")
tok_buffer = sum(float(x) for x in re.findall(r"\{buffer (\d+(?:\.\d+)?)\}", sched))
tok_budget = sum(float(x) for x in re.findall(r"\{budget (\d+(?:\.\d+)?)\}", sched))
buf_row = re.search(r"^\| Buffer \| [^|]* \| (\d+(?:\.\d+)?) \|", budget, re.M)
m6_row = re.search(r"^\| Must 6 [^|]* \| [^|]* \| (\d+(?:\.\d+)?) \|", budget, re.M)
if not buf_row or abs(tok_buffer - float(buf_row.group(1))) > 1e-6:
    errors.append(f"11_plan.md §3: {{buffer}} tokens sum to {tok_buffer}, Buffer row says {buf_row.group(1) if buf_row else '?'}")
if not m6_row or abs(tok_budget - float(m6_row.group(1))) > 1e-6:
    errors.append(f"11_plan.md §3: {{budget}} tokens sum to {tok_budget}, Must 6 row says {m6_row.group(1) if m6_row else '?'}")

# solo branch: every pd-bearing leaf is listed in §1.1 (kept table or dropped list)
solo = plan.split("### 1.1")[1].split("## 2.")[0] if "### 1.1" in plan else ""
solo_leaves = set(re.findall(r"\b(\d\.\d\.\d\.\d)\b", solo))
for num in sorted(pd_of):
    if num not in solo_leaves:
        errors.append(f"11_plan.md §1.1: leaf {num} carries person-days but is neither kept nor dropped in the solo branch")

# priorities: leaf → REQ ids → priority; Must leaves never in the last two windows; form deliverables there need a fallback
solo_col = dict(re.findall(r"^\| (REQ-[A-Z]+-\d+) \| [MSCW] \|.*\| ([a-z]+)[^|]*\|$", req_defs, re.M))
solo_col.update(dict(re.findall(r"^\| (NFR-\d+) [^|]*\|.*\| ([a-z]+)[^|]*\|$", req_defs, re.M)))
for n in re.findall(r"^\| (NFR-\d+) ", req_defs, re.M):
    prio.setdefault(n, "N")
leaf_reqs = {}
for m in leaf_re.finditer(wbs):
    num, rest = m.groups()
    ids_here = re.findall(r"\b(?:REQ-[A-Z]+|NFR)-\d+\b", rest)
    if ids_here:
        leaf_reqs[num] = ids_here
win_list = re.findall(r"^\s*\| (\d{2}-\d{2})(?: → (\d{2}-\d{2}))? \| ([^|]*) \| ([^|]*) \| ([^|]*)\|$", sched, re.M)
for idx, (w0, w1, rc, tc, ms) in enumerate(win_list):
    live = re.sub(r"\[[^\]]*\]", "", rc + " " + tc)
    for n in re.findall(r"\b(\d\.\d\.\d\.\d)\b", live):
        if idx >= len(win_list) - 2 and any(prio.get(r) == "M" for r in leaf_reqs.get(n, [])):
            errors.append(f"11_plan.md §3: Must-priority leaf {n} sits in one of the last two windows ({w0})")
        if re.match(r"5\.1\.[12]\.|5\.2\.1\.", n) and "fallback" not in ms.lower():
            errors.append(f"11_plan.md §3: submission deliverable {n} in window {w0} without a named fallback in the Milestone cell")

# solo column in 01 §4–§6 agrees with the §1.1 kept/dropped lists
solo_kept_tbl = solo.split("Dropped in the solo branch")[0] if solo else ""
solo_dropped = solo.split("Dropped in the solo branch")[1] if "Dropped in the solo branch" in solo else ""
kept_ids = set(re.findall(r"\b(\d\.\d\.\d\.\d)\b", solo_kept_tbl))
dropped_ids = set(re.findall(r"\b(\d\.\d\.\d\.\d)\b", solo_dropped))
solo_cells = dict(re.findall(r"^\| ((?:REQ-[A-Z]+|NFR)-\d+)[^|]*\|.*\| ((?:kept|reduced|dropped)[^|]*)\|$", req_defs, re.M))
done_ids = {m.group(1) for m in leaf_re.finditer(wbs) if "✅" in m.group(2)[:12]}
kept_ids |= done_ids  # delivered work cannot be dropped by a branch
for rid, val in solo_col.items():
    cell = solo_cells.get(rid, "")
    cited = re.findall(r"\b(\d\.\d\.\d\.\d)\b", cell)
    if val == "reduced":
        kept_cited = [n for n in cited if n in kept_ids]
        if not kept_cited:
            errors.append(f"01_requirements.md: {rid} is 'reduced' but its Solo cell cites no kept leaf (cite the leaf that carries the surviving obligation)")
    for n in cited:
        if val == "dropped" and n in kept_ids:
            errors.append(f"01_requirements.md: {rid} is 'dropped' but cites kept leaf {n}")
    if val == "kept" and re.search(r"\b(only|without|no)\b", cell):
        errors.append(f"01_requirements.md: {rid} is 'kept' with a qualifier ('{cell.strip()}'); a partial obligation must be 'reduced' or the requirement split")
    leaves_of = [n for n, rs in leaf_reqs.items() if rid in rs]
    # the §8 traceability leaf counts as a leaf of the requirement even if the WBS line does not name the id
    for mrid, _st, mleaf, _ev in matrix_rows:
        if mrid == rid and mleaf not in leaves_of:
            leaves_of.append(mleaf)
    leaves_of = [n for n in leaves_of if n != "—"]
    if not leaves_of:
        if prio.get(rid) == "W":
            if val != "dropped":
                errors.append(f"01_requirements.md: {rid} is priority W but Solo says '{val}'")
            continue
        errors.append(f"01_requirements.md: {rid} has no WBS leaf naming it and no §8 leaf; the Solo value cannot be cross-checked")
        continue
    any_kept = any(n in kept_ids for n in leaves_of)
    all_dropped = all(n in dropped_ids and n not in kept_ids for n in leaves_of)
    if all_dropped and val != "dropped":
        errors.append(f"01_requirements.md: {rid} says solo '{val}' but all its leaves {leaves_of} are dropped in §1.1")
    if any_kept and val == "dropped":
        errors.append(f"01_requirements.md: {rid} says solo 'dropped' but a leaf of it {leaves_of} is kept in §1.1")
for rid, pr in prio.items():
    if rid not in solo_col:
        errors.append(f"01_requirements.md: requirement {rid} lacks a Solo column value")
    elif solo_col[rid] not in ("kept", "reduced", "dropped"):
        errors.append(f"01_requirements.md: {rid} Solo column value '{solo_col[rid]}' is not kept/reduced/dropped")

# no two requirements may state the same obligation (shared 5-word shingle in the Requirement text)
req_text_of = dict(re.findall(r"^\| ((?:REQ-[A-Z]+|NFR)-\d+)[^|]*\| (?:[MSCW] \| )?([^|]*)\|", req_defs, re.M))
stop = {"the","a","an","and","or","of","to","for","with","per","in","on","from","by","is","are","as","at","that","this","its","it","one","each","all"}
synonyms = {"annual": "yearly", "calendar-year": "yearly", "calendaryear": "yearly", "year": "yearly", "export": "exports", "exported": "exports",
            "recipients": "recipient", "totals": "total"}
shingles = {}
for rid, txt in req_text_of.items():
    words = [synonyms.get(w, w) for w in re.findall(r"[a-z0-9-]+", txt.lower())]
    words = [w for w in words if w and w not in stop]
    for k in range(len(words) - 2):
        tri = words[k:k + 3]
        if all(w in {"ironwood", "orchard", "sapling", "v4", "v5", "v6", "kraken", "coingecko", "quickbooks", "xero", "openzcash"} for w in tri):
            continue  # shared enumerations of pools/sources/formats are not shared obligations
        sh = " ".join(tri)
        if sh in shingles and shingles[sh] != rid:
            errors.append(f"01_requirements.md: {rid} and {shingles[sh]} share the obligation text '{sh}'")
        shingles.setdefault(sh, rid)

# every REQ/NFR id cited in any product doc must exist; a Should/Could/Won't id cited in the policy docs (04, 05, 07) must be marked as planned/cut/dropped on that line
for name, text in files.items():
    if name in ("01_requirements.md",) or name.startswith("reviews"):
        continue
    for ln in text.splitlines():
        for rid in set(re.findall(r"\b(?:REQ-[A-Z]+|NFR)-\d+\b", ln)):
            if rid not in id_set:
                errors.append(f"{name}: cites unknown requirement {rid}")
            elif name in ("04_ux_flows.md", "05_data_model_api.md", "07_compliance_tax.md") and prio.get(rid) in ("S", "C", "W") \
                    and not re.search(r"planned|cut item|dropped|baseline only|roadmap|Should|Could|Won't", ln):
                errors.append(f"{name}: states {rid} (priority {prio.get(rid)}) as policy without marking it planned/cut: '{ln[:80]}'")

# capability prose in the policy docs must cite a requirement id (so scope changes cannot leave uncited policy behind)
cap_re = re.compile(r"\b(blocks?|locks?|records?|exports?|warns?|rejects?|derives?|issues?|persists?|stores?)\b", re.I)
for name in ("04_ux_flows.md", "05_data_model_api.md", "07_compliance_tax.md"):
    policy_text = files.get(name, "").split("## 5. Product-form observations")[0].split("## 5. Open items")[0]
    for ln in policy_text.splitlines():
        body = ln.strip()
        if not body or body.startswith("#") or body.startswith("|---") or body.startswith("| ID") or body.startswith("| Stage") or body.startswith("| Backend"):
            continue
        if cap_re.search(body) and not re.search(r"\b(?:REQ-[A-Z]+|NFR)-\d+\b", body) and not re.search(r"\[R\d+\]|spec §|PROOF|Not legal advice|Out of scope|out of scope|Zeceipt is not", body):
            errors.append(f"{name}: capability statement without a requirement id: '{body[:90]}'")

# §0 Must-set list must be sorted within each prefix
must_list = re.search(r"the Must set reduces to (.*?)\.\s+(?:Everything|REQ|NFR|Where|Every)", req_text, re.S)
if must_list:
    ids_in = re.findall(r"REQ-([A-Z]+)-(\d+)", must_list.group(1))
    by_prefix = {}
    for pre, num in ids_in:
        by_prefix.setdefault(pre, []).append(int(num))
    for pre, nums in by_prefix.items():
        if nums != sorted(nums):
            errors.append(f"01_requirements.md §0: Must-set list for REQ-{pre} is not in numeric order: {nums}")

# §1.1 buffer figures must all equal the solo kept-table Buffer row
solo_buf = re.search(r"^\| Buffer \| \| \| (\d+(?:\.\d+)?) \|", solo, re.M)
if not solo_buf:
    errors.append("11_plan.md §1.1: solo Buffer row not found")
else:
    for fig in re.findall(r"(\d+(?:\.\d+)?) (?:pd )?(?:is held as buffer|pd buffer|buffer beyond)", solo) + re.findall(r"buffer beyond (\d+(?:\.\d+)?)", solo) + re.findall(r"of which (\d+(?:\.\d+)?) is held as buffer", solo):
        if abs(float(fig) - float(solo_buf.group(1))) > 1e-6:
            errors.append(f"11_plan.md §1.1: buffer figure {fig} disagrees with the kept-table Buffer row {solo_buf.group(1)}")
    rm = re.search(r"The real reserve is that (\d+(?:\.\d+)?) pd plus the two below-the-line cuts \((\d+(?:\.\d+)?) pd scaled\) — (\d+(?:\.\d+)?) pd in total", solo)
    if not rm:
        errors.append("11_plan.md §1.1: reserve sentence not found in the expected form")
    else:
        rb, rc, rt = (float(x) for x in rm.groups())
        below = sum(float(x) for x in re.findall(r"frees (\d+(?:\.\d+)?) scaled", solo))
        if abs(rb - float(solo_buf.group(1))) > 1e-6:
            errors.append(f"11_plan.md §1.1: reserve sentence buffer {rb} disagrees with the Buffer row {solo_buf.group(1)}")
        if abs(rc - below) > 1e-6:
            errors.append(f"11_plan.md §1.1: reserve sentence says below-the-line cuts free {rc} but the listed cuts free {below}")
        if abs(rt - (rb + rc)) > 1e-6:
            errors.append(f"11_plan.md §1.1: reserve total {rt} ≠ {rb} + {rc}")
    rsk = files.get("06_risk_register.md", "")
    m19t = re.search(r"(\d+(?:\.\d+)?) pd of reserve in total", rsk)
    if rm and m19t and abs(float(m19t.group(1)) - float(rm.group(3))) > 1e-6:
        errors.append(f"06_risk_register.md: RSK-19 reserve total {m19t.group(1)} disagrees with 11_plan.md §1.1 {rm.group(3)}")
    m19 = re.search(r"with a (\d+(?:\.\d+)?) pd buffer", rsk)
    if m19 and abs(float(m19.group(1)) - float(solo_buf.group(1))) > 1e-6:
        errors.append(f"06_risk_register.md: RSK-19 buffer {m19.group(1)} disagrees with 11_plan.md §1.1 Buffer row {solo_buf.group(1)}")

# solo kept-table prices equal WBS leaf person-days unless marked "reduced"
parity = 0
for leaf, price, note in re.findall(r"\b(\d\.\d\.\d\.\d) \((\d+(?:\.\d+)?)( reduced)?\)", solo_kept_tbl):
    if leaf in pd_of:
        parity += 1
        if abs(float(price) - pd_of[leaf]) > 1e-6 and not note:
            errors.append(f"11_plan.md §1.1: {leaf} priced {price} in the solo branch but {pd_of[leaf]} in the WBS, without 'reduced'")
        if note and abs(float(price) - pd_of[leaf]) < 1e-6:
            errors.append(f"11_plan.md §1.1: {leaf} is marked 'reduced' but carries the WBS price {price}")
        if note and float(price) > pd_of[leaf] + 1e-6:
            errors.append(f"11_plan.md §1.1: {leaf} is marked 'reduced' but is priced {price}, above the WBS {pd_of[leaf]}")

# solo kept-table arithmetic: row sums, the 1.6× scaling, the kept total, Buffer = Capacity − Kept, and the Must 6 reduction
solo_rows = re.findall(r"^\| (?!\*\*Kept total|Buffer|\*\*Capacity|Kept \|)([^|]+)\| ([^|]*) \| (\d+(?:\.\d+)?) \| (\d+(?:\.\d+)?) \|$", solo_kept_tbl, re.M)
kt = re.search(r"^\| \*\*Kept total\*\* \| \| (\d+(?:\.\d+)?) \| \*\*(\d+(?:\.\d+)?)\*\* \|$", solo_kept_tbl, re.M)
cap = re.search(r"^\| \*\*Capacity\*\* \| \| \| \*\*(\d+(?:\.\d+)?)\*\* \|$", solo_kept_tbl, re.M)
scale = re.search(r"by (\d+(?:\.\d+)?);", solo)
if not (kt and cap and scale and solo_rows):
    errors.append("11_plan.md §1.1: kept table (rows, Kept total, Capacity) or the scaling rule could not be parsed")
else:
    k = float(scale.group(1))
    for name, cell, uns, sc in solo_rows:
        prices = [float(pr) for _, pr, _ in re.findall(r"\b(\d\.\d\.\d\.\d) \((\d+(?:\.\d+)?)( reduced)?\)", cell)]
        if prices and abs(sum(prices) - float(uns)) > 1e-6:
            errors.append(f"11_plan.md §1.1: row '{name.strip()}' says {uns} unscaled but its leaves sum to {sum(prices)}")
        if abs(float(uns) * k - float(sc)) > 1e-6:
            errors.append(f"11_plan.md §1.1: row '{name.strip()}' scaled {sc} ≠ {uns} × {k}")
        if "Must 6" in name:
            m6 = re.search(r"^\| Must 6 [^|]*\| [^|]* \| (\d+(?:\.\d+)?) \|", budget, re.M)
            if m6 and float(uns) > float(m6.group(1)) + 1e-6:
                errors.append(f"11_plan.md §1.1: Must 6 solo budget {uns} exceeds the baseline {m6.group(1)}")
    row_sum = sum(float(u) for _, _, u, _ in solo_rows)
    if abs(row_sum - float(kt.group(1))) > 1e-6:
        errors.append(f"11_plan.md §1.1: Kept total {kt.group(1)} ≠ Σ rows {row_sum}")
    if abs(float(kt.group(1)) * k - float(kt.group(2))) > 1e-6:
        errors.append(f"11_plan.md §1.1: Kept total scaled {kt.group(2)} ≠ {kt.group(1)} × {k}")
    if solo_buf and abs((float(cap.group(1)) - float(kt.group(2))) - float(solo_buf.group(1))) > 1e-6:
        errors.append(f"11_plan.md §1.1: Buffer {solo_buf.group(1)} ≠ capacity {cap.group(1)} − kept {kt.group(2)}")

# baseline capacity constants are derived from the date range stated in the Total row, not free parameters
cap_m = re.search(r"capacity \*\*(\d+(?:\.\d+)?)\*\* \((\d{4}-\d{2}-\d{2}) → (\d{2}-\d{2}) = (\d+) days × (\d+) people × (\d+(?:\.\d+)?)", budget)
if not cap_m:
    errors.append("11_plan.md §1: Total row capacity clause not in the expected form")
else:
    c_val, d0, d1, ndays, npeople, eff = cap_m.groups()
    real_days = (_d(d1) - _dt.date.fromisoformat(d0)).days + 1
    if real_days != int(ndays):
        errors.append(f"11_plan.md §1: {d0} → {d1} is {real_days} days, not {ndays}")
    if abs(float(c_val) - int(ndays) * int(npeople) * float(eff)) > 1e-6:
        errors.append(f"11_plan.md §1: capacity {c_val} ≠ {ndays} × {npeople} × {eff}")
    per_owner = int(ndays) * float(eff)
    for m in re.finditer(r"against (\d+(?:\.\d+)?) pd capacity", plan):
        if abs(float(m.group(1)) - per_owner) > 1e-6:
            errors.append(f"11_plan.md: per-owner capacity {m.group(1)} ≠ {ndays} × {eff}")
    for m in re.finditer(r"(\d+(?:\.\d+)?) person-days(?:\*\*)? available from 09-23", files.get("06_risk_register.md", "") + plan):
        if abs(float(m.group(1)) - per_owner) > 1e-6:
            errors.append(f"RSK-19 / §1.1: solo capacity {m.group(1)} ≠ {ndays} × {eff}")
    if cap and abs(float(cap.group(1)) - per_owner) > 1e-6:
        errors.append(f"11_plan.md §1.1: solo Capacity row {cap.group(1)} ≠ {ndays} × {eff}")

# status cells in 01 §1–§7 that cite "WBS x.x.x.x" must cite existing leaves
for num in re.findall(r"WBS (\d\.\d\.\d\.\d)", req_defs):
    if num not in leaf_ids:
        errors.append(f"01_requirements.md: status cell cites WBS leaf {num} which does not exist")

sched_rows = re.findall(r"^\| [^|]+ \| ([^|]*) \| ([^|]*) \| [^|]*\|$", sched, re.M)
budget_rows = re.findall(r"^\| ([^|]+) \| WBS ([^|]+) \| ([\d.]+) \|", budget, re.M)
print(f"leaves per phase: { {k: v['leaves'] for k, v in counts.items()} }; tests checked: {len(test_names)}; "
      f"owners parsed: {len(owner_of)}; leaves with pd: {len(pd_of)}; schedule rows: {len(sched_rows)}; budget rows summed: {len(budget_rows)}; budget lines: {len(rows_pd)}; owner load R {load['R']} / T-PM {load['T']}; windows levelled: {windows}; day-one cuts: {cut_day_one}; buffer tokens {tok_buffer}; budget tokens {tok_budget}; solo-branch leaves listed: {len(solo_leaves & set(pd_of))}/{len(pd_of)}; solo column rows: {len(solo_col)}; priority map: {len(prio)}; solo prices checked: {parity}; solo rows recomputed: {len(solo_rows)}")
if errors:
    print("\n".join(errors))
    sys.exit(1)
print("product docs consistent")
