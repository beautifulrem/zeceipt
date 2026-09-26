#!/usr/bin/env python3
"""Tests for check_release.py (slice R1b3a): each rule on a temporary tree built from the repository's own files, with
one fault introduced. Standard library only: `python3 scripts/test_check_release.py`."""
import json
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

# Importing the checker must not write a bytecode cache into the tree: a changed file would make --tag refuse.
sys.dont_write_bytecode = True
import check_release  # noqa: E402

REPO = Path(__file__).resolve().parent.parent
FILES = [
    "Cargo.toml", "Cargo.lock", "CHANGELOG.md", "docs/api/openapi.json",
    "packages/verify/package.json", "packages/verify/package-lock.json",
    "apps/console/package.json", "apps/console/package-lock.json",
]
# Before a release (as the repository is until the tag): the entries wait under Unreleased.
UNRELEASED = """# Changelog

## [Unreleased]

### Added

- Everything.
"""
# After moving them into a dated section at the tag: Unreleased stays, empty (Keep a Changelog).
RELEASED = """# Changelog

## [Unreleased]

## [{v}] - 2026-10-09

### Added

- Everything.
"""


class ReleaseCheck(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="zeceipt-release-"))
        for rel in FILES:
            (self.root / rel).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(REPO / rel, self.root / rel)
        shutil.copytree(REPO / "packages/verify/pkg", self.root / "packages/verify/pkg")
        self.version = check_release.tomllib.loads((REPO / "Cargo.toml").read_text())["workspace"]["package"]["version"]

    def tearDown(self):
        shutil.rmtree(self.root)

    def problems(self, tag=None):
        return check_release.run(self.root, tag)[0]

    def edit_json(self, rel, path, value):
        p = self.root / rel
        d = json.loads(p.read_text())
        node = d
        for k in path[:-1]:
            node = node[k]
        node[path[-1]] = value
        p.write_text(json.dumps(d))

    def assertOnly(self, problems, pattern):
        self.assertEqual(len(problems), 1, problems)
        self.assertRegex(problems[0], pattern)

    def git_repo(self):
        # An identity on every call: a CI runner has none, and a commit or an annotated tag needs one.
        ident = ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false"]
        run = lambda *a: subprocess.run(["git", "-C", str(self.root), *ident, *a], check=True, capture_output=True)
        run("init", "-q")
        run("add", "-A")
        run("commit", "-q", "-m", "tree")
        return run

    def test_the_repository_passes_by_default(self):
        self.assertEqual(self.problems(), [])

    def test_a_manifest_that_differs(self):
        self.edit_json("packages/verify/package.json", ["version"], "0.1.1")
        self.assertOnly(self.problems(), r"^packages/verify/package\.json: '0\.1\.1'")

    def test_a_lockfile_that_differs(self):
        self.edit_json("apps/console/package-lock.json", ["packages", "", "version"], "0.2.0")
        self.assertOnly(self.problems(), r'^apps/console/package-lock\.json packages\[""\]\.version: \'0\.2\.0\'')

    def test_a_cargo_lock_crate_that_differs(self):
        p = self.root / "Cargo.lock"
        p.write_text(re.sub(r'(name = "zeceipt-lwd"\nversion = )"[^"]+"', r'\1"9.9.9"', p.read_text()))
        self.assertOnly(self.problems(), r"^Cargo\.lock zeceipt-lwd: '9\.9\.9'")

    def test_the_openapi_version(self):
        self.edit_json("docs/api/openapi.json", ["info", "version"], "1.0.0")
        self.assertOnly(self.problems(), r"^docs/api/openapi\.json info\.version")

    def test_the_wasm_binary_is_checked_not_only_its_manifest(self):
        # The workspace moves on but pkg/ was not rebuilt: every other source is bumped, the WASM still says the old one.
        new = "9.9.9"
        p = self.root / "Cargo.toml"
        p.write_text(p.read_text().replace(f'version = "{self.version}"', f'version = "{new}"', 1))
        p = self.root / "Cargo.lock"
        p.write_text(re.sub(r'(name = "zeceipt-[a-z]+"\nversion = )"[^"]+"', rf'\1"{new}"', p.read_text()))
        for rel in ("packages/verify/package.json", "apps/console/package.json", "packages/verify/pkg/package.json"):
            self.edit_json(rel, ["version"], new)
        for rel in ("packages/verify/package-lock.json", "apps/console/package-lock.json"):
            self.edit_json(rel, ["version"], new)
            self.edit_json(rel, ["packages", "", "version"], new)
        self.edit_json("docs/api/openapi.json", ["info", "version"], new)
        self.assertOnly(self.problems(), rf"^packages/verify/pkg WASM version\(\): '{re.escape(self.version)}'")

    def test_a_changelog_without_unreleased(self):
        p = self.root / "CHANGELOG.md"
        p.write_text(p.read_text().replace("## [Unreleased]", "## Unreleased"))
        self.assertIn("CHANGELOG.md: the first version heading must be exactly '## [Unreleased]'", self.problems())

    def test_a_malformed_or_impossible_date(self):
        p = self.root / "CHANGELOG.md"
        p.write_text(RELEASED.format(v=self.version).replace("2026-10-09", "2026-10-9"))
        self.assertOnly(self.problems(), r"is not '## \[X\.Y\.Z\] - YYYY-MM-DD'")
        p.write_text(RELEASED.format(v=self.version).replace("2026-10-09", "2026-02-30"))
        self.assertOnly(self.problems(), r"has no real date \(2026-02-30\)")

    def test_sections_newest_first_and_none_above_the_workspace(self):
        p = self.root / "CHANGELOG.md"
        p.write_text("## [Unreleased]\n\n## [0.0.1] - 2026-01-01\n\n## [0.0.2] - 2026-01-02\n")
        self.assertOnly(self.problems(), r"\[0\.0\.2\] is not below the section above it")
        p.write_text("## [Unreleased]\n\n## [9.0.0] - 2026-01-01\n")
        self.assertOnly(self.problems(), r"\[9\.0\.0\] is above the workspace version")

    def test_a_repeated_version_section(self):
        (self.root / "CHANGELOG.md").write_text("## [Unreleased]\n\n## [0.0.1] - 2026-01-02\n\n## [0.0.1] - 2026-01-01\n")
        self.assertOnly(self.problems(), r"\[0\.0\.1\] is not below the section above it")

    def test_a_dated_unreleased_heading(self):
        (self.root / "CHANGELOG.md").write_text("## [Unreleased] - 2026-10-09\n")
        self.assertOnly(self.problems(), r"the first version heading must be exactly '## \[Unreleased\]'")

    def test_a_version_heading_without_brackets(self):
        (self.root / "CHANGELOG.md").write_text("## [Unreleased]\n\n## 0.0.1 - 2026-01-01\n")
        self.assertOnly(self.problems(), r"'## 0\.0\.1 - 2026-01-01' looks like a version heading without brackets")

    def test_malformed_inputs_are_problems_not_crashes(self):
        self.edit_json("apps/console/package-lock.json", ["packages"], [])
        p = self.root / "Cargo.lock"
        p.write_text(p.read_text() + '\n[[package]]\nversion = "1.0.0"\n')
        problems = self.problems()
        self.assertTrue(any(x.startswith('apps/console/package-lock.json: no packages') for x in problems), problems)
        self.assertTrue(any(x.startswith("Cargo.lock: a package without a name") for x in problems), problems)

    def test_tag_mode_before_the_changelog_is_released_lists_every_reason(self):
        (self.root / "CHANGELOG.md").write_text(UNRELEASED)
        self.git_repo()
        problems = self.problems(f"v{self.version}")
        self.assertEqual(len(problems), 2, problems)
        self.assertRegex(problems[0], rf"the first dated section must be \[{re.escape(self.version)}\] \(found none\)")
        self.assertRegex(problems[1], r"'## \[Unreleased\]' still has entries")

    def test_tag_mode_passes_on_a_released_clean_tree(self):
        (self.root / "CHANGELOG.md").write_text(RELEASED.format(v=self.version))
        self.git_repo()
        self.assertEqual(self.problems(f"v{self.version}"), [])

    def test_tag_mode_wrong_tag_dirty_tree_and_existing_tag(self):
        (self.root / "CHANGELOG.md").write_text(RELEASED.format(v=self.version))
        run = self.git_repo()
        self.assertTrue(any("so the tag must be" in p for p in self.problems("v9.9.9")))
        (self.root / "stray.txt").write_text("x")
        self.assertOnly(self.problems(f"v{self.version}"), r"^the working tree is not clean")
        (self.root / "stray.txt").unlink()
        run("tag", "-a", f"v{self.version}", "-m", "t")
        self.assertOnly(self.problems(f"v{self.version}"), rf"^the tag v{re.escape(self.version)} already exists")


if __name__ == "__main__":
    unittest.main(verbosity=2)
