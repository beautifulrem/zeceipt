#!/usr/bin/env bash
# Build the browser verifier's WebAssembly package reproducibly (WBS 3.4.2.4; slice X3a; R119).
#
# Absolute build paths would otherwise be embedded in the .wasm (panic locations in the Cargo registry's sources), so
# the same source built in another checkout or on another machine would differ, and the package would carry the
# builder's local paths. rustc's --remap-path-prefix and clang's -ffile-prefix-map (for the secp256k1 C code) replace
# them; Cargo's trim-paths does the same but is unstable in Cargo 1.96. With the same toolchain (README, "Building the
# WASM package"), two builds from different checkouts are byte-identical.
#
# Usage: scripts/build_wasm.sh [--out-dir DIR]   (default: packages/verify/pkg, the committed package)
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
out="$root/packages/verify/pkg"
if [[ "${1:-}" == "--out-dir" ]]; then
  out="$(mkdir -p "$2" && cd "$2" && pwd)"
fi

registry="${CARGO_HOME:-$HOME/.cargo}/registry/src"
clang="${ZECEIPT_WASM_CLANG:-/opt/homebrew/opt/llvm/bin/clang}"
ar="${ZECEIPT_WASM_AR:-/opt/homebrew/opt/llvm/bin/llvm-ar}"
[[ -x "$clang" && -x "$ar" ]] || { echo "build_wasm: need a wasm-capable clang and llvm-ar (set ZECEIPT_WASM_CLANG and ZECEIPT_WASM_AR)" >&2; exit 3; }

export CC_wasm32_unknown_unknown="$clang" AR_wasm32_unknown_unknown="$ar"
export CFLAGS_wasm32_unknown_unknown="--target=wasm32-unknown-unknown -O2 -nostdlib -fno-exceptions -D__wasm32__ -ffile-prefix-map=$registry=/cargo/registry/src -ffile-prefix-map=$root=/zeceipt"
export RUSTFLAGS="--remap-path-prefix=$registry=/cargo/registry/src --remap-path-prefix=$root=/zeceipt"

wasm-pack build "$root/crates/zeceipt-wasm" --target web --release --out-dir "$out"
rm -f "$out/.gitignore"

echo "toolchain: $(rustc --version) | $(wasm-pack --version) | wasm-bindgen $(sed -n '/^name = "wasm-bindgen"$/{n;s/version = "\(.*\)"/\1/p;}' "$root/Cargo.lock") | $("$clang" --version | head -1)"
(cd "$out" && shasum -a 256 package.json zeceipt_wasm.js zeceipt_wasm.d.ts zeceipt_wasm_bg.wasm zeceipt_wasm_bg.wasm.d.ts)
