#!/usr/bin/env bash
# Security self-review, one command (slice J1; WBS 3.4.2.3; RSK-17). Run from anywhere; it works on the repository
# this script lives in. Every check runs; the script exits 1 if any failed or a tool is missing. Results and
# dispositions are recorded in docs/SECURITY_REVIEW.md; accepted findings live in the files the tools read
# (.cargo/audit.toml, .gitleaks.toml, .gitleaksignore, `gitleaks:allow` comments), each with its reason.
#
# Tools: cargo-audit (`cargo install cargo-audit --locked`), gitleaks (`brew install gitleaks`), npm.
# Network: cargo audit fetches the RustSec database and npm audit asks the registry.
set -u
cd "$(dirname "$0")/.."
root=$(pwd)
reports=$(mktemp -d)
failed=()

run() { # name, command...
  local name=$1 log
  shift
  log="$reports/${name//[^A-Za-z0-9._-]/_}.log"
  if "$@" > "$log" 2>&1; then
    echo "PASS  $name"
  else
    echo "FAIL  $name (log: $log)"
    failed+=("$name")
  fi
}
need() { # tool, install hint (cargo subcommands are found by cargo itself, e.g. in ~/.cargo/bin)
  if ! { command -v "$1" > /dev/null 2>&1 || { [ "${1#cargo-}" != "$1" ] && cargo "${1#cargo-}" --version > /dev/null 2>&1; }; }; then
    echo "FAIL  $1 is not installed ($2)"
    failed+=("$1")
    return 1
  fi
}

echo "security review of $root at $(git rev-parse --short HEAD)$(git diff --quiet HEAD && echo '' || echo ' (with uncommitted changes)'), $(date -u +%Y-%m-%dT%H:%MZ)"

# 1. Rust dependencies: RustSec, vulnerabilities and informational warnings (unmaintained, unsound, yanked) alike.
if need cargo-audit "cargo install cargo-audit --locked"; then
  echo "      $(cargo audit --version)"
  run cargo-audit cargo audit --deny warnings
fi

# 2. npm dependencies: the GitHub Advisory Database, whole tree (a dev tool runs on this machine too).
if need npm "install Node.js 24"; then
  for pkg in apps/console packages/verify; do
    run "npm-audit:$pkg" npm --prefix "$pkg" audit --audit-level=low
  done
fi

# 3. Secrets: every commit, then the working tree (untracked files included; build outputs excluded by .gitleaks.toml).
if need gitleaks "brew install gitleaks"; then
  echo "      gitleaks $(gitleaks version)"
  run gitleaks-history gitleaks git --redact --no-banner --config .gitleaks.toml --report-path "$reports/gitleaks-history.json" .
  run gitleaks-tree gitleaks dir --redact --no-banner --config .gitleaks.toml --report-path "$reports/gitleaks-tree.json" .
fi

# 4. The repository's own guards: no key material in code, no secrets in logs (NFR-1, NFR-6).
run source-guards python3 scripts/check_source_guards.py

if [ ${#failed[@]} -gt 0 ]; then
  echo "security review FAILED: ${failed[*]} (reports in $reports)"
  exit 1
fi
echo "security review passed (reports in $reports)"
