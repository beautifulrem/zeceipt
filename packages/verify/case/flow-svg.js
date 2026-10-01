// The funds-flow diagram on the case page (FE02): a left-to-right Sankey of the whole case, drawn as SVG with
// createElementNS and presentation attributes only (the page's CSP allows no style attribute). The geometry is a hand
// port of mempool.space's transaction bowtie (tx-bowtie-graph.component.ts: strand widths proportional to value with a
// 2px floor, cubic Béziers with straight lead-ins, arrow-shaped connectors), laid out in layers:
// - one column per transaction, oldest first, each a 6px node as tall as the value through it;
// - sources at the column before the transaction they fund: an origin's transparent funders, an undisclosed shielded
//   sender (hatched), notes no claim traces back to an origin and value from undisclosed notes (amber, dashed);
// - each note from the transaction that made it to the one that spent it, passing below the columns it skips;
// - outputs at the column after their transaction: payments (transparent ones blue, the one to the reviewer's
//   assigned deposit address green), and notes the holder still holds.
// Colour encodes one thing: what kind of value a strand carries. Every strand carries a data-key (note:n1,
// addr:<address>, pay:<id>), so hovering it lights up the same note in the table and the transactions (case/ui.js).
// The Transactions tab lists the same flows, step by step: it is this figure's text alternative and its printout's
// companion.
import { heightText, zecString, valueParts } from "../r/view.js";

const NS = "http://www.w3.org/2000/svg";
const NODE_W = 6;
const MIN_W = 2; // mempool's minWeight
const MAX_W = 56; // the thickest strand, in px
const GAP = 14;
const TERM_H = 30; // room for a terminal's two-line label
const TOP = 52; // room for a node's three-line label above it

const svgEl = (tag, attrs = {}, text) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) e.setAttribute(k, String(v));
  if (text !== undefined) e.textContent = text;
  return e;
};
const shortTx = (t) => (t ? `${t.slice(0, 8)}…${t.slice(-4)}` : "");
const shortAddr = (a) => (a && a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a ?? "");
const amountText = (zat, network) => {
  if (zat === null || zat === undefined) return "•••••";
  const { major } = valueParts(zecString(zat));
  return `${major} ${network === "main" ? "ZEC" : "TAZ"}`;
};

/** The graph: columns of items (nodes, pass-throughs, terminals) and the edges between them. */
export function flowModel(steps) {
  const edges = [];
  const N = steps.length;
  const col = (i) => i + 1; // step i sits in column i + 1; column 0 holds the first sources
  const creator = new Map();
  steps.forEach((s, i) => { for (const n of s.created) creator.set(n.id, i); });
  const noteOf = (id) => { for (const s of steps) { const n = [...s.created, ...s.spent].find((x) => x.id === id); if (n) return n; } return { id }; };
  steps.forEach((s, i) => {
    // An origin's funding: its transparent funders, an undisclosed shielded sender, or notes this dossier discloses.
    for (const f of s.funding) {
      const got = s.created.find((n) => n.id === f.note)?.value_zat ?? null;
      const fd = f.funding;
      if (!fd) { edges.push({ kind: "gap", from: { source: true, col: col(i) - 1 }, to: { step: i }, value: got, key: `note:${f.note}`, label: "Funding not established", sub: amountText(got, s.network) }); continue; }
      if (fd.from_disclosed?.length) {
        for (const id of fd.from_disclosed) {
          const c = creator.get(id);
          const v = noteOf(id).value_zat ?? null;
          if (c !== undefined && c < i) edges.push({ kind: "note", from: { step: c }, to: { step: i }, value: v, key: `note:${id}`, title: `${id} · ${amountText(v, s.network)}` });
          else edges.push({ kind: "gap", from: { source: true, col: col(i) - 1 }, to: { step: i }, value: v, key: `note:${id}`, label: `${id}, not traced`, sub: amountText(v, s.network) });
        }
        continue;
      }
      const inputs = fd.transparent_inputs ?? [];
      if (inputs.length) {
        const byAddr = new Map();
        for (const t of inputs) {
          const k = t.address ?? "unknown address";
          const e = byAddr.get(k) ?? { value: 0, valued: true, returned: false };
          if (t.value_zat == null) e.valued = false; else e.value += t.value_zat;
          if (t.paid_in_claim != null) e.returned = true;
          byAddr.set(k, e);
        }
        const total = [...byAddr.values()].reduce((a, e) => a + e.value, 0);
        for (const [addr, e] of byAddr) {
          const share = got != null && total > 0 && e.valued ? Math.round((got * e.value) / total) : got;
          edges.push({ kind: "transparent", from: { source: true, col: col(i) - 1 }, to: { step: i }, value: share, key: `addr:${addr}`, label: e.returned ? `${shortAddr(addr)}, returned` : shortAddr(addr), sub: e.valued ? `${amountText(e.value, s.network)} in` : "value not known", title: `${addr}: ${e.valued ? amountText(e.value, s.network) : "value not known"} of transparent inputs; ${amountText(got, s.network)} reached the holder` });
        }
      } else {
        edges.push({ kind: "hatch", from: { source: true, col: col(i) - 1 }, to: { step: i }, value: got, key: `note:${f.note}`, label: "Undisclosed sender", sub: amountText(got, s.network), title: `Shielded funds of a sender the dossier does not disclose: ${amountText(got, s.network)}` });
      }
    }
    // Notes spent here: from the transaction that made them, or, when none in the dossier did, untraced.
    for (const n of s.spent) {
      const c = creator.get(n.id);
      if (c !== undefined && c < i) edges.push({ kind: n.untraced ? "gap" : "note", from: { step: c }, to: { step: i }, value: n.value_zat ?? null, key: `note:${n.id}`, title: `${n.id} · ${amountText(n.value_zat, s.network)}${n.untraced ? " · not traced to an origin" : ""}` });
      else edges.push({ kind: "gap", from: { source: true, col: col(i) - 1 }, to: { step: i }, value: n.value_zat ?? null, key: `note:${n.id}`, label: `${n.id}, not traced`, sub: amountText(n.value_zat, s.network), title: `${n.id} is not traced back to an origin` });
    }
    if (s.undisclosed_zat > 0) edges.push({ kind: "gap", from: { source: true, col: col(i) - 1 }, to: { step: i }, value: s.undisclosed_zat, key: null, label: "Undisclosed notes", sub: `≥ ${amountText(s.undisclosed_zat, s.network)}`, title: `At least ${amountText(s.undisclosed_zat, s.network)} from notes the dossier does not disclose` });
    // Out: payments, and notes no later transaction here spends (the holder's still).
    for (const p of s.payments) {
      edges.push({ kind: p.assigned ? "assigned" : p.transparent ? "transparent" : "note", from: { step: i }, to: { sink: true, col: col(i) + 1 }, value: p.value_zat ?? null, key: p.recipient ? `addr:${p.recipient}` : `pay:${p.id}`, label: p.transparent ? `${p.id} → ${shortAddr(p.recipient ?? "")}` : `${p.id}, paid`, sub: amountText(p.value_zat, s.network), title: `${p.transparent ? "Transparent payment" : "Payment"} ${p.id}: ${amountText(p.value_zat, s.network)}${p.recipient ? ` to ${p.recipient}` : ""}${p.assigned ? ", your deposit address" : ""}` });
    }
    for (const n of s.created) {
      const spentLater = steps.some((t, j) => j > i && (t.spent.some((x) => x.id === n.id) || t.funding.some((f) => f.funding?.from_disclosed?.includes(n.id))));
      if (!spentLater) edges.push({ kind: n.untraced || n.unexplained ? "gap" : "note", from: { step: i }, to: { sink: true, col: col(i) + 1 }, value: n.value_zat ?? null, key: `note:${n.id}`, label: `${n.id}${n.reply ? ", reply" : ""}, held`, sub: amountText(n.value_zat, s.network), title: `${n.id}: ${amountText(n.value_zat, s.network)}${n.reply ? ", the control's reply note" : ""}, not spent in this dossier` });
    }
  });
  return { edges, columns: N + 2 };
}

/** Render the diagram into `container` (replacing it), at the container's width or wider (it then scrolls). */
export function renderFlowGraph(container, steps, { network = "test", minColumnGap = 100 } = {}) {
  if (!steps?.length) { container.replaceChildren(); return null; }
  for (const s of steps) s.network = network;
  const { edges, columns } = flowModel(steps);
  const N = steps.length;
  const maxThrough = Math.max(1, ...steps.map((s, i) => Math.max(
    edges.filter((e) => e.to.step === i).reduce((a, e) => a + (e.value ?? 0), 0),
    edges.filter((e) => e.from.step === i).reduce((a, e) => a + (e.value ?? 0), 0))));
  const width = (v) => (v === null || v === undefined ? 8 : Math.min(MAX_W, Math.max(MIN_W, (MAX_W * v) / maxThrough)));
  for (const e of edges) e.w = width(e.value);

  // Column contents: the transaction's node, the strands passing it, the outputs ending here, the sources starting here.
  const cols = Array.from({ length: columns }, () => ({ node: null, pass: [], sinks: [], sources: [] }));
  const colOf = (end) => (end.step !== undefined ? end.step + 1 : end.col);
  steps.forEach((s, i) => { cols[i + 1].node = { step: s, i, ins: [], outs: [] }; });
  for (const e of edges) {
    const a = colOf(e.from), b = colOf(e.to);
    e.cols = [a, b];
    if (e.from.source) cols[a].sources.push(e);
    if (e.to.sink) cols[b].sinks.push(e);
    if (e.from.step !== undefined) cols[a].node.outs.push(e);
    if (e.to.step !== undefined) cols[b].node.ins.push(e);
    e.pass = [];
    for (let c = a + 1; c < b; c++) { const p = { e, col: c }; cols[c].pass.push(p); e.pass.push(p); }
  }
  // Vertical positions: each column stacks its items from the top.
  for (const [c, col] of cols.entries()) {
    let y = TOP;
    if (col.node) {
      const ins = col.node.ins.reduce((a, e) => a + e.w, 0), outs = col.node.outs.reduce((a, e) => a + e.w, 0);
      col.node.h = Math.max(ins, outs, 10);
      col.node.y = y;
      y += col.node.h + GAP + 4;
    }
    if (!col.node) y += 10;
    for (const e of col.sinks) { e.endY = y + Math.max(e.w, 4) / 2; y += Math.max(e.w, TERM_H) + GAP; }
    for (const p of col.pass.sort((a, b) => a.e.cols[1] - b.e.cols[1])) { p.y = y + p.e.w / 2; y += p.e.w + GAP; }
    for (const e of col.sources) { e.startY = y + e.w / 2; y += Math.max(e.w, TERM_H) + GAP; }
    col.bottom = y;
  }
  // Ports on each node: in-strands stacked by where they come from, out-strands by where they go.
  const srcY = (e) => (e.from.source ? e.startY : e.pass.length ? e.pass[e.pass.length - 1].y : (cols[e.cols[0]].node?.y ?? 0) + (e.outY ?? 0) / 1000);
  const dstY = (e) => (e.pass.length ? e.pass[0].y : e.to.sink ? e.endY : (cols[e.cols[1]].node?.y ?? 0));
  for (const col of cols) {
    if (!col.node) continue;
    let y = col.node.y + (col.node.h - col.node.ins.reduce((a, e) => a + e.w, 0)) / 2;
    for (const e of col.node.ins.sort((a, b) => srcY(a) - srcY(b))) { e.inY = y + e.w / 2; y += e.w; }
    y = col.node.y + (col.node.h - col.node.outs.reduce((a, e) => a + e.w, 0)) / 2;
    for (const e of col.node.outs.sort((a, b) => dstY(a) - dstY(b))) { e.outY = y + e.w / 2; y += e.w; }
  }

  // Horizontal positions: room on the left for the first sources' labels, and on the right for the last outputs'.
  const available = Math.max(320, container.clientWidth || 720);
  const left = 120, right = 132;
  const gap = Math.max(minColumnGap, (available - left - right) / (columns - 1));
  const X = (c) => left + c * gap;
  const W = Math.ceil(X(columns - 1) + right);
  const H = Math.ceil(Math.max(...cols.map((c) => c.bottom)) + 4);

  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img", "aria-labelledby": "fg-title fg-desc" });
  svg.append(svgEl("title", { id: "fg-title" }, "Funds flow"));
  const ins = edges.filter((e) => e.from.source).map((e) => `${e.label} ${e.sub ?? ""}`.trim());
  const outs = edges.filter((e) => e.to.sink).map((e) => `${e.label} ${e.sub ?? ""}`.trim());
  svg.append(svgEl("desc", { id: "fg-desc" }, `${N} transaction${N === 1 ? "" : "s"}, oldest first. In: ${ins.join("; ") || "none"}. Out: ${outs.join("; ") || "none"}. The Transactions tab lists each one.`));
  const defs = svgEl("defs");
  const hatch = svgEl("pattern", { id: "fg-hatch", width: 6, height: 6, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" });
  hatch.append(svgEl("line", { x1: 0, y1: 0, x2: 0, y2: 6, class: "fg-hatch-line" }));
  defs.append(hatch);
  svg.append(defs);
  const gLinks = svgEl("g"), gNodes = svgEl("g"), gText = svgEl("g");
  svg.append(gLinks, gNodes, gText);

  // mempool's makePath: a straight lead-in, a cubic Bézier between two heights, a straight lead-out.
  const seg = (x1, y1, x2, y2) => {
    const lead = Math.min(10, (x2 - x1) / 6);
    const a = x1 + lead, b = x2 - lead, m = (a + b) / 2;
    return `L ${a} ${y1} C ${m} ${y1}, ${m} ${y2}, ${b} ${y2} L ${x2} ${y2}`;
  };
  const tip = (w) => Math.min(9, Math.max(5, w * 0.6));
  for (const e of edges) {
    const [a, b] = e.cols;
    const startX = e.from.source ? X(a) : X(a) + NODE_W;
    const startY = e.from.source ? e.startY : e.outY;
    const endX = e.to.sink ? X(b) - tip(e.w) : X(b);
    const endY = e.to.sink ? e.endY : e.inY;
    let d = `M ${startX} ${startY}`;
    let x = startX, y = startY;
    for (const p of e.pass) { d += ` ${seg(x, y, X(p.col), p.y)} L ${X(p.col) + NODE_W} ${p.y}`; x = X(p.col) + NODE_W; y = p.y; }
    d += ` ${seg(x, y, endX, endY)}`;
    const path = svgEl("path", { d, class: `fg-link k-${e.kind}`, "stroke-width": e.w.toFixed(2), "data-key": e.key ?? undefined });
    if (e.title) path.append(svgEl("title", {}, e.title));
    gLinks.append(path);
    if (e.to.sink) {
      // mempool's connector: an arrow as tall as the strand (at least 8px), its tip on the column.
      const hh = Math.max(e.w, 8) / 2;
      gLinks.append(svgEl("path", { d: `M ${endX - 0.5} ${endY - hh} L ${X(b)} ${endY} L ${endX - 0.5} ${endY + hh} Z`, class: `fg-end k-${e.kind}`, "data-key": e.key ?? undefined }));
      const tx = X(b) + 8;
      gText.append(svgEl("text", { x: tx, y: endY - 2, class: "fg-mono" }, e.label));
      gText.append(svgEl("text", { x: tx, y: endY + 12, class: "fg-amt" }, e.sub ?? ""));
    }
    if (e.from.source) {
      gText.append(svgEl("text", { x: X(a) - 8, y: e.startY - 2, "text-anchor": "end", class: e.kind === "transparent" ? "fg-mono" : undefined }, e.label));
      gText.append(svgEl("text", { x: X(a) - 8, y: e.startY + 12, "text-anchor": "end", class: "fg-amt" }, e.sub ?? ""));
    }
  }
  for (const col of cols) {
    if (!col.node) continue;
    const { step: s } = col.node;
    const x = X(steps.indexOf(s) + 1);
    const r = svgEl("rect", { x, y: col.node.y, width: NODE_W, height: col.node.h, rx: 1, class: "fg-node", "data-key": `tx:${s.txid}` });
    r.append(svgEl("title", {}, `Step ${s.number}: ${s.title}. Transaction ${s.txid}${s.height != null ? `, height ${heightText(s.height)}` : ""}`));
    gNodes.append(r);
    gText.append(svgEl("text", { x, y: col.node.y - 33, class: "fg-step" }, `Step ${s.number}`));
    gText.append(svgEl("text", { x, y: col.node.y - 20, class: "fg-mono" }, shortTx(s.txid)));
    gText.append(svgEl("text", { x, y: col.node.y - 7 }, s.height != null ? heightText(s.height) : "height unknown"));
  }
  container.replaceChildren(svg);
  return svg;
}
