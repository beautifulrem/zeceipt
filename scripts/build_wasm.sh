#!/usr/bin/env bash
# Build the browser verifier's WebAssembly package reproducibly (WBS 3.4.2.4; slices X3a, X3b, X3c; R119, R120).
#
# Absolute build paths would otherwise be embedded in the .wasm (panic locations in the Cargo registry's sources), so
# the same source built in another checkout or on another machine would differ, and the package would carry the
# builder's local paths. rustc's --remap-path-prefix and clang's -ffile-prefix-map (for the secp256k1 C code) replace
# them; Cargo's trim-paths does the same but is unstable in Cargo 1.96. With the same toolchain (README, "Building the
# WASM package"), two builds from different checkouts are byte-identical.
#
# Usage:
#   scripts/build_wasm.sh                      build into packages/verify/pkg (the committed package)
#   scripts/build_wasm.sh --out-dir DIR        build into DIR
#   scripts/build_wasm.sh --check              build into a temporary directory and compare with the committed package
#   scripts/build_wasm.sh --compare DIR        compare an existing build in DIR with the committed package (no build)
#   add --require-identical-wasm to --check or --compare to fail when the .wasm bytes differ
# Comparing: the wasm-bindgen outputs (JS glue, .d.ts, package.json) must be identical (exit 1 otherwise); the .wasm is
# reported identical or different, and fails only with --require-identical-wasm. Usage errors exit 3.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
committed="$root/packages/verify/pkg"
usage() { sed -n '/^# Usage:/,/^# Comparing/p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 3; }

out="$committed" mode=build compare_dir="" require_wasm=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --out-dir) [[ $# -ge 2 && -n "$2" ]] || usage; out="$2"; shift 2 ;;
    --check) mode=check; shift ;;
    --compare) [[ $# -ge 2 && -n "$2" ]] || usage; mode=compare; compare_dir="$2"; shift 2 ;;
    --require-identical-wasm) require_wasm=1; shift ;;
    *) echo "build_wasm: unknown argument: $1" >&2; usage ;;
  esac
done
[[ $require_wasm == 1 && $mode == build ]] && { echo "build_wasm: --require-identical-wasm needs --check or --compare" >&2; usage; }

compare() { # $1: a built package directory
  local dir="$1" status=0 line
  for f in package.json zeceipt_wasm.js zeceipt_wasm.d.ts zeceipt_wasm_bg.wasm.d.ts; do
    if cmp -s "$dir/$f" "$committed/$f"; then line="identical: $f"; else line="DIFFERS: $f (wasm-bindgen output; must match)"; status=1; fi
    echo "$line"; [[ -n "${GITHUB_STEP_SUMMARY:-}" ]] && echo "- $line" >> "$GITHUB_STEP_SUMMARY"
  done
  local built had
  built="$(shasum -a 256 "$dir/zeceipt_wasm_bg.wasm" | cut -d' ' -f1)"
  had="$(shasum -a 256 "$committed/zeceipt_wasm_bg.wasm" | cut -d' ' -f1)"
  if [[ "$built" == "$had" ]]; then line="identical: zeceipt_wasm_bg.wasm ($built)"
  else line="differs: zeceipt_wasm_bg.wasm (built $built, committed $had)"; [[ $require_wasm == 1 ]] && status=1; fi
  echo "$line"; [[ -n "${GITHUB_STEP_SUMMARY:-}" ]] && echo "- $line" >> "$GITHUB_STEP_SUMMARY"
  return $status
}

if [[ $mode == compare ]]; then
  [[ -d "$compare_dir" ]] || { echo "build_wasm: no such directory: $compare_dir" >&2; exit 3; }
  compare "$(cd "$compare_dir" && pwd)"
  exit $?
fi
if [[ $mode == check ]]; then
  out="$(mktemp -d)/pkg"
fi
mkdir -p "$out"
out="$(cd "$out" && pwd)"

registry="${CARGO_HOME:-$HOME/.cargo}/registry/src"
clang="${ZECEIPT_WASM_CLANG:-/opt/homebrew/opt/llvm/bin/clang}"
ar="${ZECEIPT_WASM_AR:-/opt/homebrew/opt/llvm/bin/llvm-ar}"
clang="$(command -v "$clang" || true)" ar="$(command -v "$ar" || true)"
[[ -n "$clang" && -n "$ar" ]] || { echo "build_wasm: need a wasm-capable clang and llvm-ar (set ZECEIPT_WASM_CLANG and ZECEIPT_WASM_AR)" >&2; exit 3; }

export CC_wasm32_unknown_unknown="$clang" AR_wasm32_unknown_unknown="$ar"
export CFLAGS_wasm32_unknown_unknown="--target=wasm32-unknown-unknown -O2 -nostdlib -fno-exceptions -D__wasm32__ -ffile-prefix-map=$registry=/cargo/registry/src -ffile-prefix-map=$root=/zeceipt"
export RUSTFLAGS="--remap-path-prefix=$registry=/cargo/registry/src --remap-path-prefix=$root=/zeceipt"

wasm-pack build "$root/crates/zeceipt-wasm" --target web --release --out-dir "$out"
rm -f "$out/.gitignore"

# wasm-opt is the one wasm-pack downloaded into its cache; its version changes the bytes too.
wasm_opt="$(find "${XDG_CACHE_HOME:-$HOME/.cache}/.wasm-pack" "$HOME/Library/Caches/.wasm-pack" -path '*wasm-opt*' -name wasm-opt -type f 2>/dev/null | head -1 || true)"
echo "toolchain: $(rustc --version) | $(wasm-pack --version) | wasm-bindgen $(sed -n '/^name = "wasm-bindgen"$/{n;s/version = "\(.*\)"/\1/p;}' "$root/Cargo.lock") | ${wasm_opt:+$("$wasm_opt" --version) | }$("$clang" --version | head -1)"
(cd "$out" && shasum -a 256 package.json zeceipt_wasm.js zeceipt_wasm.d.ts zeceipt_wasm_bg.wasm zeceipt_wasm_bg.wasm.d.ts)

if [[ $mode == check ]]; then
  compare "$out"
fi
