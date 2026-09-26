#!/usr/bin/env python3
"""Release consistency (WBS 4.1.1.4; slice R1b3a; R114, R116).

Default mode (CI): every version source equals the Cargo workspace version:
  - `Cargo.toml` [workspace.package] version (the reference);
  - `Cargo.lock`, each `zeceipt-*` package;
  - `packages/verify/package.json` and its lockfile (top level and `packages[""]`);
  - `packages/verify/pkg/package.json` (wasm-pack's) and the committed WASM's own `version()`, run in Node;
  - `apps/console/package.json` and its lockfile;
  - `docs/api/openapi.json` `info.version`.
And `CHANGELOG.md` keeps Keep a Changelog's shape: `## [Unreleased]` is the first version heading, every other
version heading is `## [X.Y.Z] - YYYY-MM-DD` (a real date), newest first, and none is above the workspace version.

`--tag vX.Y.Z` (before cutting a release tag), additionally:
  - the tag is `v` + the workspace version;
  - the first dated section is that version;
  - `Unreleased` has no entries (only blank lines);
  - the working tree is clean (`git status --porcelain`);
  - the tag does not exist yet.

Exit 1 listing every problem; one summary line on success. `--root DIR` checks another tree (the tests use it).
"""
import argparse
import datetime
import json
import re
import subprocess
import sys
import tomllib
from pathlib import Path

HEADING = re.compile(r"^## \[(?P<name>[^\]]+)\](?P<rest>.*)$", re.M)
# A version heading someone wrote without the brackets, which HEADING would not see.
BARE_VERSION = re.compile(r"^## v?\d+\.\d+\.\d+\b.*$", re.M)
DATED = re.compile(r"^ - (\d{4}-\d{2}-\d{2})$")
SEMVER = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")

# Run in Node with the pkg directory as argv[1]; writes nothing to the tree.
WASM_VERSION_JS = """
const fs = await import("node:fs");
const { pathToFileURL } = await import("node:url");
const dir = process.argv[1];
const { initSync, version } = await import(pathToFileURL(dir + "/zeceipt_wasm.js").href);
initSync({ module: fs.readFileSync(dir + "/zeceipt_wasm_bg.wasm") });
process.stdout.write(version());
"""


def semver(v):
    m = SEMVER.match(v)
    return tuple(int(x) for x in m.groups()) if m else None


def version_sources(root: Path, problems: list) -> str | None:
    """Every version source; returns the workspace version (the reference)."""
    try:
        want = tomllib.loads((root / "Cargo.toml").read_text())["workspace"]["package"]["version"]
    except (OSError, KeyError, tomllib.TOMLDecodeError) as e:
        problems.append(f"Cargo.toml: no [workspace.package] version ({e})")
        return None
    if semver(want) is None:
        problems.append(f"Cargo.toml: workspace version {want!r} is not X.Y.Z")

    def same(where, got):
        if got != want:
            problems.append(f"{where}: {got!r}, the workspace says {want!r}")

    try:
        lock = tomllib.loads((root / "Cargo.lock").read_text())
        packages = lock.get("package", [])
        if any("name" not in p for p in packages):
            problems.append("Cargo.lock: a package without a name")
        crates = [p for p in packages if p.get("name", "").startswith("zeceipt-")]
        if not crates:
            problems.append("Cargo.lock: no zeceipt-* package")
        for p in crates:
            same(f"Cargo.lock {p['name']}", p["version"])
    except (OSError, tomllib.TOMLDecodeError) as e:
        problems.append(f"Cargo.lock: unreadable ({e})")

    def manifest(rel, key=("version",)):
        try:
            d = json.loads((root / rel).read_text())
            for k in key:
                d = d[k]
            return d
        except (OSError, KeyError, TypeError, json.JSONDecodeError) as e:
            problems.append(f"{rel}: no {'.'.join(key)} ({e})")
            return None

    for pkg in ("packages/verify", "apps/console"):
        got = manifest(f"{pkg}/package.json")
        if got is not None:
            same(f"{pkg}/package.json", got)
        for key in (("version",), ("packages", "", "version")):
            got = manifest(f"{pkg}/package-lock.json", key)
            if got is not None:
                label = "version" if key == ("version",) else 'packages[""].version'
                same(f"{pkg}/package-lock.json {label}", got)
    got = manifest("packages/verify/pkg/package.json")
    if got is not None:
        same("packages/verify/pkg/package.json", got)
    got = manifest("docs/api/openapi.json", ("info", "version"))
    if got is not None:
        same("docs/api/openapi.json info.version", got)

    # The binary itself, not only its manifest: the committed WASM reports its crate version.
    pkg_dir = root / "packages" / "verify" / "pkg"
    try:
        out = subprocess.run(["node", "--input-type=module", "-e", WASM_VERSION_JS, str(pkg_dir)], capture_output=True, text=True, timeout=60)
        m = re.match(r"^zeceipt-wasm (\S+) ", out.stdout)
        if out.returncode != 0 or not m:
            problems.append(f"packages/verify/pkg: the WASM's version() could not be read ({out.stderr.strip()[:200] or out.stdout[:80]})")
        else:
            same("packages/verify/pkg WASM version()", m.group(1))
    except (OSError, subprocess.SubprocessError) as e:
        problems.append(f"packages/verify/pkg: the WASM's version() could not be read ({e})")
    return want


def changelog(root: Path, want: str | None, problems: list):
    """The changelog's version sections: [(name, date or None, body)], in file order."""
    try:
        text = (root / "CHANGELOG.md").read_text()
    except OSError as e:
        problems.append(f"CHANGELOG.md: unreadable ({e})")
        return []
    for bare in BARE_VERSION.finditer(text):
        problems.append(f"CHANGELOG.md: '{bare.group(0)}' looks like a version heading without brackets ('## [X.Y.Z] - YYYY-MM-DD')")
    heads = list(HEADING.finditer(text))
    sections = []
    for i, h in enumerate(heads):
        body = text[h.end(): heads[i + 1].start() if i + 1 < len(heads) else len(text)]
        sections.append((h.group("name"), h.group("rest"), body))
    if not sections or sections[0][0] != "Unreleased" or sections[0][1] != "":
        problems.append("CHANGELOG.md: the first version heading must be exactly '## [Unreleased]'")
    out = [(sections[0][0], None, sections[0][2])] if sections and sections[0][0] == "Unreleased" else []
    previous = None
    for name, rest, body in sections[1:] if out else sections:
        if name == "Unreleased":
            problems.append("CHANGELOG.md: '## [Unreleased]' appears more than once")
            continue
        m = DATED.match(rest)
        if semver(name) is None or not m:
            problems.append(f"CHANGELOG.md: '## [{name}]{rest}' is not '## [X.Y.Z] - YYYY-MM-DD'")
            continue
        try:
            datetime.date.fromisoformat(m.group(1))
        except ValueError:
            problems.append(f"CHANGELOG.md: [{name}] has no real date ({m.group(1)})")
        if previous is not None and semver(name) >= previous:
            problems.append(f"CHANGELOG.md: [{name}] is not below the section above it (newest first)")
        previous = semver(name)
        if want and semver(want) and semver(name) > semver(want):
            problems.append(f"CHANGELOG.md: [{name}] is above the workspace version {want}")
        out.append((name, m.group(1), body))
    return out


def tag_checks(root: Path, tag: str, want: str | None, sections, problems: list):
    if want and tag != f"v{want}":
        problems.append(f"--tag {tag}: the workspace version is {want}, so the tag must be v{want}")
    dated = [s for s in sections if s[1] is not None]
    if not dated or dated[0][0] != tag.removeprefix("v"):
        problems.append(f"CHANGELOG.md: the first dated section must be [{tag.removeprefix('v')}] (found {dated[0][0] if dated else 'none'})")
    unreleased = [s for s in sections if s[0] == "Unreleased"]
    if unreleased and unreleased[0][2].strip():
        problems.append("CHANGELOG.md: '## [Unreleased]' still has entries; move them into the release's section")
    def git(*a):
        try:
            return subprocess.run(["git", "-C", str(root), *a], capture_output=True, text=True)
        except OSError as e:
            return subprocess.CompletedProcess(a, 127, "", str(e))
    status = git("status", "--porcelain")
    if status.returncode != 0:
        problems.append(f"git status failed: {status.stderr.strip()}")
    elif status.stdout.strip():
        problems.append("the working tree is not clean (git status --porcelain)")
    if git("rev-parse", "-q", "--verify", f"refs/tags/{tag}").returncode == 0:
        problems.append(f"the tag {tag} already exists")


def run(root: Path, tag: str | None) -> tuple[list, str | None]:
    problems: list = []
    want = version_sources(root, problems)
    sections = changelog(root, want, problems)
    if tag is not None:
        tag_checks(root, tag, want, sections, problems)
    return problems, want


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--tag", help="the release tag about to be cut, e.g. v0.1.0 (strict mode)")
    ap.add_argument("--root", type=Path, default=Path(__file__).resolve().parent.parent)
    args = ap.parse_args(argv)
    problems, want = run(args.root, args.tag)
    if problems:
        for p in problems:
            print(f"release check: {p}", file=sys.stderr)
        return 1
    print(f"release check passed: version {want} in every source" + (f"; ready to tag {args.tag}" if args.tag else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
