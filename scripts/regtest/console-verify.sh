#!/bin/bash
# Capture: independent re-verification of the receipts auto-issued by the console library in the
# regtest e2e run (PROOF §5c), plus the fee Zkool recorded for the batch transaction. No key material.
# Every command is printed exactly as it runs (paths shown with $ARTIFACT_DIR, as in PROOF).
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
Z="${ZECEIPT_BIN:-$ROOT/target/release/zeceipt}"
ARTIFACT_DIR="${ARTIFACT_DIR:-$ROOT/../raw/tools/regtest}"
ENDPOINT="${ENDPOINT:-http://127.0.0.1:8137}"
GRAPHQL="${GRAPHQL:-http://127.0.0.1:9000/graphql}"
ISSUER="${ZKOOL_ISSUER:-9}"
STAMP="${STAMP:?set STAMP to the e2e run stamp, e.g. 20260922192547}"
TXID="${TXID:?set TXID to the batch txid}"
HEIGHT="${HEIGHT:?set HEIGHT to the height the batch was mined at}"
cd "$ROOT" || exit 2
for f in "$ARTIFACT_DIR/console-receipts-$STAMP"/*.json; do
  echo "\$ zeceipt verify --regtest --endpoint $ENDPOINT \$ARTIFACT_DIR/console-receipts-$STAMP/$(basename "$f") --challenge auditor-$STAMP --require-signature"
  "$Z" verify --regtest --endpoint "$ENDPOINT" "$f" --challenge "auditor-$STAMP" --require-signature > /tmp/cv.json; rc=$?
  python3 -c "import json; d=json.load(open('/tmp/cv.json')); print(json.dumps({k:d.get(k) for k in ('valid','height','output_index','value_zec','memo','recipient')}))"
  echo "exit=$rc"
done
Q="{\"query\":\"{ transactionsByAccount(idAccount: $ISSUER, height: $HEIGHT) { txid height value fee } }\"}"
echo "\$ curl --noproxy '*' -s -X POST $GRAPHQL -H 'Content-Type: application/json' -d '$Q'   (filtered to $TXID)"
curl --noproxy '*' -s -X POST "$GRAPHQL" -H 'Content-Type: application/json' -d "$Q" | python3 -c "import sys,json; print(json.dumps([t for t in json.load(sys.stdin)['data']['transactionsByAccount'] if t['txid']=='$TXID']))"
