#!/usr/bin/env bash
# Build the public static site from packages/verify (PM round 1, D08; judge round 1, D2): the landing page
# (index.html, home.css), the case review page for reviewers (case/, with its sample dossier), the dossier builder for
# holders (build/), the receipt page (r/), the paste demo (demo/), and the verifier they load (src/, pkg/). Nothing is
# compiled here: the committed WASM package is published as it is, so the site runs the bytes whose sha256 the README
# states.
#
# Usage: scripts/build_site.sh OUT_DIR [--node NET=URL]...
#
# --node (repeatable; NET is main or test) builds a self-hosted copy for a reviewer who runs their own node (a
# lightwalletd or Zaino behind a gRPC-web proxy): the case and build pages then fetch only from the nodes named, for
# the networks named, and their Content-Security-Policy's connect-src allows only those origins ('self' plus them), so
# no public node learns which transactions a case looks up. A network without --node cannot be fetched at all in that
# copy (its dossiers can still be checked from transaction files).
#
# Static hosts (GitHub Pages) cannot set response headers: the pages' own <meta> Content-Security-Policy and referrer
# policy apply, but frame-ancestors cannot be set from a <meta> tag, so framing is not refused there (docs/THREAT_MODEL.md).
set -euo pipefail
usage() { echo "usage: scripts/build_site.sh OUT_DIR [--node NET=URL]..." >&2; exit 3; }
[[ $# -ge 1 && -n "$1" && "$1" != --* ]] || usage
root="$(cd "$(dirname "$0")/.." && pwd)"
out="$1"; shift
nodes=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --node) [[ $# -ge 2 && "$2" =~ ^(main|test)=(https://|http://(localhost|127\.0\.0\.1)[:/]) ]] || usage; nodes+=("$2"); shift 2 ;;
    *) usage ;;
  esac
done
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
if [[ ${#nodes[@]} -gt 0 ]]; then
  # The self-hosted copy: name the nodes in each dossier page and allow only their origins.
  python3 - "$out" "${nodes[@]}" <<'PY'
import json, re, sys
from urllib.parse import urlsplit
out, specs = sys.argv[1], sys.argv[2:]
nodes = {}
for spec in specs:
    net, url = spec.split("=", 1)
    nodes.setdefault(net, []).append(url.rstrip("/"))
origins = sorted({f"{urlsplit(u).scheme}://{urlsplit(u).netloc}" for us in nodes.values() for u in us})
for page in ("case/index.html", "build/index.html"):
    path = f"{out}/{page}"
    html = open(path).read()
    html, n1 = re.subn(r'<meta name="zeceipt-nodes" content="[^"]*">', '<meta name="zeceipt-nodes" content="' + json.dumps(nodes).replace('"', "&quot;") + '">', html)
    html, n2 = re.subn(r"connect-src [^;\"]*", "connect-src 'self' " + " ".join(origins), html)
    assert n1 == 1 and n2 == 1, f"{page}: nodes meta or connect-src not found"
    open(path, "w").write(html)
print("self-hosted: " + ", ".join(f"{k}: {' '.join(v)}" for k, v in nodes.items()))
PY
fi
# Cache-busting (appraisal round 2, E13): a static host lets browsers keep each file for a while (GitHub Pages: 10
# minutes), so a page open across a deploy, or a revisit, could pair a new sample with an old verifier. Every module
# import, module script, stylesheet and WebAssembly URL in the site gets `?v=<the first 8 hex of the file's sha256>`,
# the file's content after its own references are versioned, so a change anywhere below a page changes that page's
# URLs. The .wasm bytes are untouched (their sha256 is still the README's); only the JavaScript and HTML that name
# them change. A reference to a file that is not in the site fails the build.
python3 - "$out" <<'PY'
import hashlib, os, re, sys
out = os.path.realpath(sys.argv[1])
JS_REF = re.compile(r"""(\bfrom\s*|\bimport\s*\(?\s*)(["'])(\.\.?/[^"'?#]+\.js)\2""")
WASM_REF = re.compile(r"""(["'])((?:\.\.?/)?(?:[\w-]+/)*zeceipt_wasm_bg\.wasm)\1""")
HTML_REF = re.compile(r"""(<script type="module" src="|<link rel="stylesheet" href=")([^"?#:]+\.(?:js|css))(")""")
INLINE = re.compile(r"(<script type=\"module\">)(.*?)(</script>)", re.S)
done, busy = {}, set()

def resolve(src, ref):
    path = os.path.realpath(os.path.join(os.path.dirname(src), ref))
    if not path.startswith(out + os.sep) or not os.path.isfile(path):
        sys.exit(f"build_site: {os.path.relpath(src, out)} names {ref}, which is not in the site")
    return path

def rewrite_js(src, text):
    text = JS_REF.sub(lambda m: f"{m[1]}{m[2]}{m[3]}?v={version(resolve(src, m[3]))}{m[2]}", text)
    return WASM_REF.sub(lambda m: f"{m[1]}{m[2]}?v={version(resolve(src, m[2]))}{m[1]}", text)

def version(path):
    """The file's version: its content, with its own references versioned first, hashed."""
    if path in done:
        return done[path]
    if path in busy:
        sys.exit(f"build_site: an import cycle through {os.path.relpath(path, out)}")
    busy.add(path)
    if path.endswith(".js"):
        text = rewrite_js(path, open(path, encoding="utf-8").read())
        open(path, "w", encoding="utf-8").write(text)
        data = text.encode()
    else:
        data = open(path, "rb").read()
    busy.discard(path)
    done[path] = hashlib.sha256(data).hexdigest()[:8]
    return done[path]

pages = 0
for d, _, files in os.walk(out):
    for f in files:
        p = os.path.join(d, f)
        if f.endswith(".js"):
            version(p)
        elif f.endswith(".html"):
            html = open(p, encoding="utf-8").read()
            new = HTML_REF.sub(lambda m: f"{m[1]}{m[2]}?v={version(resolve(p, m[2]))}{m[3]}", html)
            new = INLINE.sub(lambda m: m[1] + rewrite_js(p, m[2]) + m[3], new)
            if new != html:
                open(p, "w", encoding="utf-8").write(new)
                pages += 1
print(f"versioned: {len(done)} files, referenced from {pages} pages")
PY
echo "site built in $out ($(find "$out" -type f | wc -l | tr -d ' ') files)"
