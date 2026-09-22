#!/usr/bin/env python3
"""Tracer bullet for the Zkool GraphQL execution backend on the local regtest chain (WBS 3.3.5.4, REQ-CON-7).

Runs the whole flow against a `zkool_graphql` server and prints a verbatim transcript:
  1. currentHeight
  2. restore the issuer account from a mnemonic file (never printed, never in the repo)
  3. create N recipient accounts, read their unified addresses
  4. sync the issuer, print its balance
  5. pay N recipients with N memos in one transaction (srcPools = Ironwood)
  6. wait for the tx to be mined (polls the node height and the issuer's transactions)
  7. sync each recipient and print the note/memo it sees

Nothing here touches Zeceipt; receipts are issued afterwards with the `zeceipt` CLI (see PROOF §5b).

Usage:
  python3 scripts/zkool_regtest_tracer.py --mnemonic-file /path/outside/repo --graphql http://127.0.0.1:9000/graphql \
      --recipients 3 --memo-prefix INV-R-00 --memo-start 2 --amounts 1.01,1.02,1.03 [--issuer-id 1]
"""
import argparse
import json
import sys
import time
import urllib.request

POOL_TRANSPARENT, POOL_SAPLING, POOL_ORCHARD, POOL_IRONWOOD = 1, 2, 4, 8


def gql(url, query, variables=None, quiet=False):
    body = json.dumps({"query": query, "variables": variables or {}}).encode()
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=600) as r:
        out = json.loads(r.read())
    if not quiet:
        shown = json.dumps(out, ensure_ascii=False)
        print(f"$ gql {query.strip().splitlines()[0][:70]}…\n{shown[:1200]}{'…' if len(shown) > 1200 else ''}\n")
    if "errors" in out:
        raise SystemExit(f"GraphQL error: {out['errors']}")
    return out["data"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--graphql", default="http://127.0.0.1:9000/graphql")
    ap.add_argument("--mnemonic-file", required=True)
    ap.add_argument("--issuer-id", type=int, default=None, help="reuse an existing issuer account id instead of restoring")
    ap.add_argument("--recipients", type=int, default=3)
    ap.add_argument("--memo-prefix", default="INV-R-00")
    ap.add_argument("--memo-start", type=int, default=2)
    ap.add_argument("--amounts", default="1.01,1.02,1.03")
    ap.add_argument("--birth", type=int, default=1)
    ap.add_argument("--wait", type=int, default=600, help="seconds to wait for mining")
    a = ap.parse_args()
    url = a.graphql
    t_start = time.time()

    h0 = gql(url, "{ currentHeight }")["currentHeight"]
    print(f"[tracer] node height at start: {h0}\n")

    if a.issuer_id is None:
        mnemonic = open(a.mnemonic_file).read().strip()
        # direct call so the mnemonic is never echoed into the transcript
        body = {"query": "mutation($new: NewAccount!) { createAccount(newAccount: $new) }",
                "variables": {"new": {"name": "issuer-regtest", "key": mnemonic, "passphrase": "", "aindex": 0, "birth": a.birth,
                                      "pools": POOL_TRANSPARENT | POOL_SAPLING | POOL_ORCHARD | POOL_IRONWOOD, "useInternal": False}}}
        req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=120) as r:
            out = json.loads(r.read())
        if "errors" in out:
            raise SystemExit(f"createAccount(issuer) error: {out['errors']}")
        issuer = out["data"]["createAccount"]
        print(f"$ gql mutation createAccount(issuer from mnemonic file, key redacted) -> id {issuer}\n")
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

    payment = {"recipients": [{"address": r["address"], "amount": r["amount"], "memo": r["memo"]} for r in recips],
               "srcPools": POOL_IRONWOOD, "confirmations": 1}
    t1 = time.time()
    txid = gql(url, "mutation($id: Int!, $pay: Payment!) { pay(idAccount: $id, payment: $pay) }", {"id": issuer, "pay": payment})["pay"]
    print(f"[tracer] pay returned txid {txid} in {time.time()-t1:.1f}s\n")

    # wait for mining: poll node height, then the issuer's confirmed transactions
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

    for r in recips:
        gql(url, "mutation($id: Int!) { synchronizeAccount(idAccount: $id, fast: false) }", {"id": r["id"]}, quiet=True)
        b = gql(url, "query($id: Int!) { balanceByAccount(idAccount: $id) { total } }", {"id": r["id"]}, quiet=True)["balanceByAccount"]
        txs = gql(url, "query($id: Int!) { transactionsByAccount(idAccount: $id, height: 0) { txid height outputs { pool vout value address memo } } }", {"id": r["id"]}, quiet=True)["transactionsByAccount"]
        print(f"[tracer] recipient {r['id']} ({r['address'][:20]}…) balance {b['total']} expected {r['amount']} memo {r['memo']!r}: {json.dumps(txs, ensure_ascii=False)[:600]}\n")

    print(json.dumps({"txid": txid, "mined_height": mined_height, "issuer": issuer,
                      "recipients": [{"id": r["id"], "address": r["address"], "amount": r["amount"], "memo": r["memo"]} for r in recips],
                      "elapsed_s": round(time.time() - t_start, 1)}, indent=2))


if __name__ == "__main__":
    main()
