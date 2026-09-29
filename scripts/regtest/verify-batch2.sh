#!/bin/bash
# Capture: verification matrix for the three Zkool-batch receipts (PROOF §5b). Needs ARTIFACT_DIR with receipts-batch2/,
# tx-48db254a.hex and rawdir/ (raw tx named <txid>.hex); creates the two tampered copies itself. No key material.
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
Z="${ZECEIPT_BIN:-$ROOT/target/release/zeceipt}"
ARTIFACT_DIR="${ARTIFACT_DIR:-$(cd "$(dirname "$0")/../../.." && pwd)/raw/tools/regtest}"
ENDPOINT="${ENDPOINT:-http://127.0.0.1:8137}"
cd "$ARTIFACT_DIR" || exit 2
python3 - <<'PY'
import json, base64
r = json.load(open('receipts-batch2/48db254a361e9676-ironwood-2.json'))
ock = bytearray(base64.urlsafe_b64decode(r['ock'] + '==')); ock[0] ^= 1
r['ock'] = base64.urlsafe_b64encode(bytes(ock)).decode().rstrip('=')
json.dump(r, open('/tmp/tampered-2.json', 'w'))
r = json.load(open('receipts-batch2/48db254a361e9676-ironwood-2.json')); r.pop('signature'); r.pop('issuer_pubkey', None)
ock = bytearray(base64.urlsafe_b64decode(r['ock'] + '==')); ock[5] ^= 0x40
r['ock'] = base64.urlsafe_b64encode(bytes(ock)).decode().rstrip('=')
json.dump(r, open('/tmp/tampered-2-unsigned.json', 'w'))
PY
for i in 1 2 3; do
  f=receipts-batch2/48db254a361e9676-ironwood-$i.json
  echo "\$ zeceipt verify --regtest --endpoint $ENDPOINT $f --challenge auditor-nonce-12 --require-signature"
  $Z verify --regtest --endpoint "$ENDPOINT" $f --challenge auditor-nonce-12 --require-signature; echo "exit=$?"
  echo "\$ zeceipt verify --regtest --raw-tx-file tx-48db254a.hex $f --challenge auditor-nonce-12 --require-signature   (offline)"
  $Z verify --regtest --raw-tx-file tx-48db254a.hex $f --challenge auditor-nonce-12 --require-signature > /tmp/v.json; rc=$?; python3 -c "import json; d=json.load(open('/tmp/v.json')); print(json.dumps({k:d[k] for k in ('valid','output_index','value_zec','memo','recipient')}))"; echo "exit=$rc"
done
echo "\$ zeceipt verify --regtest --raw-tx-file tx-48db254a.hex /tmp/tampered-2.json --challenge auditor-nonce-12 --require-signature   (signed receipt, one ock byte flipped)"
$Z verify --regtest --raw-tx-file tx-48db254a.hex /tmp/tampered-2.json --challenge auditor-nonce-12 --require-signature; echo "exit=$?"
echo "\$ zeceipt verify --regtest --raw-tx-file tx-48db254a.hex /tmp/tampered-2-unsigned.json --challenge auditor-nonce-12   (unsigned copy, ock byte flipped, signature not required)"
$Z verify --regtest --raw-tx-file tx-48db254a.hex /tmp/tampered-2-unsigned.json --challenge auditor-nonce-12; echo "exit=$?"
echo "\$ zeceipt verify --regtest --raw-tx-file tx-48db254a.hex receipts-batch2/48db254a361e9676-ironwood-1.json --challenge auditor-nonce-13 --require-signature   (wrong challenge)"
$Z verify --regtest --raw-tx-file tx-48db254a.hex receipts-batch2/48db254a361e9676-ironwood-1.json --challenge auditor-nonce-13 --require-signature; echo "exit=$?"
echo "\$ zeceipt pack --title 'batch 2026-09-22' receipts-batch2/*.json > pack-batch2.json"
$Z pack --title "batch 2026-09-22" receipts-batch2/48db254a361e9676-ironwood-1.json receipts-batch2/48db254a361e9676-ironwood-2.json receipts-batch2/48db254a361e9676-ironwood-3.json > pack-batch2.json; echo "exit=$?"
echo "\$ zeceipt verify-pack --regtest pack-batch2.json --raw-tx-dir rawdir --challenge auditor-nonce-12 --require-signature"
$Z verify-pack --regtest pack-batch2.json --raw-tx-dir rawdir --challenge auditor-nonce-12 --require-signature > /tmp/p.json; rc=$?; python3 -c "import json; d=json.load(open('/tmp/p.json')); print(json.dumps({k:v for k,v in d.items() if k!='receipts'}, indent=1))"; echo "exit=$rc"
