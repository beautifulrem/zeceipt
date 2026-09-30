#!/usr/bin/env bash
# Build the public static site from packages/verify (PM round 1, D08; judge round 1, D2): the receipt page (r/), the
# paste demo (demo/), and the verifier they load (src/, pkg/), with a landing page that opens the demo. Nothing is
# compiled here: the committed WASM package is published as it is, so the site runs the bytes whose sha256 the README
# states.
#
# Usage: scripts/build_site.sh OUT_DIR
#
# Static hosts (GitHub Pages) cannot set response headers: the pages' own <meta> Content-Security-Policy and referrer
# policy apply, but frame-ancestors cannot be set from a <meta> tag, so framing is not refused there (docs/THREAT_MODEL.md).
set -euo pipefail
[[ $# -eq 1 && -n "$1" ]] || { echo "usage: scripts/build_site.sh OUT_DIR" >&2; exit 3; }
root="$(cd "$(dirname "$0")/.." && pwd)"
out="$1"
src="$root/packages/verify"

rm -rf "$out"
mkdir -p "$out"
for d in r demo src pkg; do cp -R "$src/$d" "$out/$d"; done
cp "$src/LICENSE" "$src/NOTICE" "$out/"
rm -f "$out/pkg/.gitignore"
touch "$out/.nojekyll"  # serve every path as it is (no Jekyll processing)
cat > "$out/index.html" <<'HTML'
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Zeceipt: verifiable receipts for shielded Zcash payments</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; img-src 'self'">
<meta http-equiv="refresh" content="0; url=demo/">
<link rel="icon" href="r/icon.svg" type="image/svg+xml">
</head>
<body>
<p><a href="demo/">Open the verifier</a> · <a href="https://github.com/beautifulrem/zeceipt">Source and specification</a></p>
</body>
</html>
HTML
# Every file the pages load must be in the site: a missing module would only fail in the browser.
for f in r/index.html r/page.js r/view.js r/ui.js r/page.css demo/index.html demo/demo.css src/index.js pkg/zeceipt_wasm.js pkg/zeceipt_wasm_bg.wasm demo/fixtures/synthetic-receipt-bearer.json demo/fixtures/synthetic-ironwood.hex; do
  [[ -f "$out/$f" ]] || { echo "build_site: missing $f" >&2; exit 1; }
done
echo "site built in $out ($(find "$out" -type f | wc -l | tr -d ' ') files)"
