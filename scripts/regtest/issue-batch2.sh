#!/bin/bash
# Capture: issue receipts for the Zkool batch tx (PROOF §5b). No key material: the UFVK is a committed regtest viewing key,
# the issuer signing key lives in ARTIFACT_DIR (outside the repo). Output is the transcript quoted in PROOF.
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ZECEIPT_BIN="${ZECEIPT_BIN:-$ROOT/target/release/zeceipt}"
ARTIFACT_DIR="${ARTIFACT_DIR:-$(cd "$(dirname "$0")/../../.." && pwd)/raw/tools/regtest}"
ENDPOINT="${ENDPOINT:-http://127.0.0.1:8137}"
TXID="${TXID:-48db254a361e9676b90d4864505bd536de9bc6952c46aeea087ec213fdac47b2}"
cd "$ROOT" || exit 2
rm -rf "$ARTIFACT_DIR/receipts-batch2"
echo "\$ zeceipt issue --regtest --endpoint $ENDPOINT --ufvk \$(cat fixtures/regtest-issuer-ufvk.txt) --txid $TXID --label 'batch 2026-09-22 | INV-R-002..004 | 1.01/1.02/1.03 REG' --challenge auditor-nonce-12 --key-file \$ARTIFACT_DIR/issuer.key --key-id 2026-09 --out-dir \$ARTIFACT_DIR/receipts-batch2   (run from the repo root; ARTIFACT_DIR holds the signing key and receives the receipts)"
"$ZECEIPT_BIN" issue --regtest --endpoint "$ENDPOINT" --ufvk "$(cat "$ROOT/fixtures/regtest-issuer-ufvk.txt")" --txid "$TXID" --label "batch 2026-09-22 | INV-R-002..004 | 1.01/1.02/1.03 REG" --challenge auditor-nonce-12 --key-file "$ARTIFACT_DIR/issuer.key" --key-id 2026-09 --out-dir "$ARTIFACT_DIR/receipts-batch2"
echo "exit=$?"
echo "\$ ls \$ARTIFACT_DIR/receipts-batch2"; ls "$ARTIFACT_DIR/receipts-batch2"
