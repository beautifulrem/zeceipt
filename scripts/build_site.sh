#!/usr/bin/env bash
# Build the public static site from packages/verify (PM round 1, D08; judge round 1, D2): the landing page
# (index.html, home.css), the case review page for reviewers (case/, with its sample dossier), the dossier builder for
# holders (build/), the receipt page (r/), the paste demo (demo/), and the verifier they load (src/, pkg/). Nothing is
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
for d in r demo case build src pkg; do cp -R "$src/$d" "$out/$d"; done
cp "$src/LICENSE" "$src/NOTICE" "$out/"
rm -f "$out/pkg/.gitignore"
touch "$out/.nojekyll"  # serve every path as it is (no Jekyll processing)
cp "$src/index.html" "$src/home.css" "$out/"
# Every file the pages load must be in the site: a missing module would only fail in the browser.
for f in index.html home.css \
  case/index.html case/page.js case/view.js case/ui.js case/case.css case/fixtures/testnet-dossier.json case/fixtures/testnet-dossier-transparent-origin.json case/fixtures/testnet-dossier-exchange.json \
  build/index.html build/page.js build/view.js build/build.css \
  r/index.html r/page.js r/view.js r/ui.js r/page.css r/icon.svg r/fonts/Geist-Variable.woff2 r/fonts/GeistMono-Variable.woff2 \
  r/icons/download.svg r/icons/printer.svg r/icons/upload.svg r/icons/link.svg r/icons/arrow-right.svg r/icons/circle-alert.svg \
  r/icons/trash.svg r/icons/key-round.svg r/icons/refresh-cw.svg \
  demo/index.html demo/demo.css src/index.js pkg/zeceipt_wasm.js pkg/zeceipt_wasm_bg.wasm \
  demo/fixtures/synthetic-receipt-bearer.json demo/fixtures/synthetic-ironwood.hex; do
  [[ -f "$out/$f" ]] || { echo "build_site: missing $f" >&2; exit 1; }
done
echo "site built in $out ($(find "$out" -type f | wc -l | tr -d ' ') files)"
