#!/usr/bin/env python3
# key-material-allowed: regtest-only harness — reads a throwaway regtest mnemonic from a file outside the
# repository to drive a local Zkool wallet backend; never used with mainnet or testnet keys (NFR-1 carve-out).
"""Tracer bullet for the Zkool GraphQL execution backend on the local regtest chain (WBS 3.3.5.4, REQ-CON-7).

Regtest-only harness. It restores the issuer account in a local `zkool_graphql` server (loopback only,
never through a proxy) from a mnemonic file, then runs the whole flow and prints a transcript:
  1. currentHeight
  2. restore the issuer account from the mnemonic file (never printed) — or reuse --issuer-id
  3. create N recipient accounts, read their unified addresses
  4. sync the issuer, print its balance
  5. pay N recipients with N memos in one transaction (srcPools = Ironwood)
  6. wait for the tx to be mined (polls the issuer's confirmed transactions)
  7. sync each recipient and print the shielded note it received (`notes { value pool memo }`);
     exit 1 unless every recipient sees exactly the expected memo and amount

Nothing here touches Zeceipt; receipts are issued afterwards with the `zeceipt` CLI (see PROOF §5b).

Usage (the opener bypasses any system proxy by design, so no NO_PROXY is needed):
  python3 scripts/zkool_regtest_tracer.py --mnemonic-file /path/outside/repo \
      --graphql http://127.0.0.1:9000/graphql --recipients 3 --memo-prefix INV-R-00 --memo-start 2 \
      --amounts 1.01,1.02,1.03 [--use-internal|--no-use-internal] [--issuer-id N]

`--use-internal` (default on) restores the issuer with Zkool's `useInternal: true`; on this chain the
zcash-devtool wallet shielded its coinbase and sent change at the internal scope, so without it the
balance reads 0 (PROOF §5b).
"""
import argparse
import json
import sys
import time
import urllib.parse
import urllib.request

POOL_TRANSPARENT, POOL_SAPLING, POOL_ORCHARD, POOL_IRONWOOD = 1, 2, 4, 8


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Refuse redirects: a misconfigured or hostile local server must not be able to bounce the restore POST elsewhere."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: D401
        return None


# Loopback-only, proxy-less, redirect-refusing opener: the restore payload never leaves 127.0.0.1.
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect())


def gql(url, query, variables=None, quiet=False, redact=False):
    body = json.dumps({"query": query, "variables": variables or {}}).encode()
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
    with OPENER.open(req, timeout=600) as r:
        out = json.loads(r.read())
    if not quiet:
        shown = json.dumps(out, ensure_ascii=False)
        print(f"$ gql {query.strip().splitlines()[0][:70]}…\n{shown[:1200]}{'…' if len(shown) > 1200 else ''}\n")
    if "errors" in out:
        msg = "[redacted: error text may echo the input]" if redact else out["errors"]
        raise SystemExit(f"GraphQL error: {msg}")
    return out["data"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--graphql", default="http://127.0.0.1:9000/graphql")
    ap.add_argument("--mnemonic-file", required=True)  # key-material-allowed: throwaway regtest phrase, file outside the repo
    ap.add_argument("--issuer-id", type=int, default=None, help="reuse an existing issuer account id instead of restoring")
    ap.add_argument("--use-internal", action=argparse.BooleanOptionalAction, default=True,
                    help="restore the issuer with Zkool's useInternal flag (needed for notes at the internal scope)")
    ap.add_argument("--recipients", type=int, default=3)
    ap.add_argument("--memo-prefix", default="INV-R-00")
    ap.add_argument("--memo-start", type=int, default=2)
    ap.add_argument("--amounts", default="1.01,1.02,1.03")
    ap.add_argument("--birth", type=int, default=1)
    ap.add_argument("--wait", type=int, default=600, help="seconds to wait for mining")
    a = ap.parse_args()
    url = a.graphql
    host = urllib.parse.urlparse(url).hostname
    if host not in ("127.0.0.1", "localhost", "::1"):
        raise SystemExit(f"refusing to send wallet material to a non-loopback host: {host}")
    t_start = time.time()

    h0 = gql(url, "{ currentHeight }")["currentHeight"]
    print(f"[tracer] node height at start: {h0}\n")

    if a.issuer_id is None:
        phrase = open(a.mnemonic_file).read().strip()  # key-material-allowed: read once, posted to loopback only, deleted below
        issuer = gql(url, "mutation($new: NewAccount!) { createAccount(newAccount: $new) }",
                     {"new": {"name": "issuer-regtest", "key": phrase, "passphrase": "", "aindex": 0, "birth": a.birth,
                              "pools": POOL_TRANSPARENT | POOL_SAPLING | POOL_ORCHARD | POOL_IRONWOOD,
                              "useInternal": a.use_internal}},
                     quiet=True, redact=True)["createAccount"]
        del phrase
        print(f"$ gql mutation createAccount(issuer from file, key redacted, useInternal={str(a.use_internal).lower()}) -> id {issuer}\n")
    else:
        issuer = a.issuer_id

    addrs = gql(url, "query($id: Int!) { addressByAccount(idAccount: $id) { transparent sapling orchard ironwood ua } }", {"id": issuer})["addressByAccount"]
    print(f"[tracer] issuer UA: {addrs.get('ua')}\n")

    recips = []
    amounts = a.amounts.split(",")
    for i in range(a.recipients):
        rid = gql(url, "mutation($new: NewAccount!) { createAccount(newAccount: $new) }",
                  {"new": {"name": f"recipient-{i+1}", "key": "", "passphrase": "", "aindex": 0, "birth": h0,
                           "pools": POOL_IRONWOOD, "useInternal": False}})["createAccount"]
        ra = gql(url, "query($id: Int!) { addressByAccount(idAccount: $id) { ua ironwood orchard } }", {"id": rid})["addressByAccount"]
        recips.append({"id": rid, "address": ra.get("ua") or ra.get("ironwood") or ra.get("orchard"), "amount": amounts[i % len(amounts)],
                       "memo": f"{a.memo_prefix}{a.memo_start + i}"})

    t0 = time.time()
    gql(url, "mutation($id: Int!) { synchronizeAccount(idAccount: $id, fast: false) }", {"id": issuer})
    print(f"[tracer] issuer sync took {time.time()-t0:.1f}s\n")
    bal = gql(url, "query($id: Int!) { balanceByAccount(idAccount: $id) { height transparent sapling orchard ironwood total } }", {"id": issuer})["balanceByAccount"]
    print(f"[tracer] issuer balance: {bal}\n")
    if float(bal["ironwood"]) <= 0:
        raise SystemExit("issuer has no Ironwood balance — restore with --use-internal on this chain (see PROOF §5b)")

    payment = {"recipients": [{"address": r["address"], "amount": r["amount"], "memo": r["memo"]} for r in recips],
               "srcPools": POOL_IRONWOOD, "confirmations": 1}
    t1 = time.time()
    txid = gql(url, "mutation($id: Int!, $pay: Payment!) { pay(idAccount: $id, payment: $pay) }", {"id": issuer, "pay": payment})["pay"]
    print(f"[tracer] pay returned txid {txid} in {time.time()-t1:.1f}s\n")

    mined_height = None
    deadline = time.time() + a.wait
    while time.time() < deadline:
        time.sleep(10)
        gql(url, "mutation($id: Int!) { synchronizeAccount(idAccount: $id, fast: false) }", {"id": issuer}, quiet=True)
        txs = gql(url, "query($id: Int!) { transactionsByAccount(idAccount: $id, height: 0) { txid height } }", {"id": issuer}, quiet=True)["transactionsByAccount"]
        hit = [t for t in txs if t["txid"] == txid and t.get("height")]
        if hit:
            mined_height = hit[0]["height"]
            break
    print(f"[tracer] mined at height {mined_height} ({time.time()-t1:.0f}s after pay)\n")
    if mined_height is None:
        raise SystemExit("transaction was not mined within --wait seconds")

    failures = 0
    for r in recips:
        gql(url, "mutation($id: Int!) { synchronizeAccount(idAccount: $id, fast: false) }", {"id": r["id"]}, quiet=True)
        txs = gql(url, "query($id: Int!) { transactionsByAccount(idAccount: $id, height: 0) { txid height value notes { value pool memo } } }", {"id": r["id"]}, quiet=True)["transactionsByAccount"]
        mine = [t for t in txs if t["txid"] == txid]
        notes = [n for t in mine for n in t["notes"]]
        ok = len(notes) == 1 and notes[0]["memo"] == r["memo"] and float(notes[0]["value"]) == float(r["amount"])
        failures += 0 if ok else 1
        print(f"[tracer] recipient {r['id']} {r['address']} expected {r['amount']} {r['memo']!r} -> {'OK' if ok else 'MISMATCH'}: {json.dumps(mine, ensure_ascii=False)}\n")

    print(json.dumps({"txid": txid, "mined_height": mined_height, "issuer": issuer, "use_internal": a.use_internal,
                      "recipients": [{"id": r["id"], "address": r["address"], "amount": r["amount"], "memo": r["memo"]} for r in recips],
                      "recipient_memo_failures": failures, "elapsed_s": round(time.time() - t_start, 1)}, indent=2))
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
