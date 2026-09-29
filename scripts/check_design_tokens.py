#!/usr/bin/env python3
"""The console and the public receipt page share one set of design tokens (slice F4, R134).

apps/console/app/globals.css is the source; packages/verify/r/page.css carries a copy, because the receipt page is a
static page with no build step and a CSP that loads nothing from elsewhere. Every custom property the console defines
in its light `:root` block and in its dark block must appear in the page's matching block with the same value.
The radii (the console's `@theme inline` scale) and the shared button rules (`.btn`, `.btn-primary`,
`.btn-secondary`) must also match, declaration by declaration, so the two surfaces cannot drift apart.
Exit 1 on any difference, naming each one.
"""
import re
import sys
from pathlib import Path

repo = Path(__file__).resolve().parent.parent
CONSOLE = repo / "apps/console/app/globals.css"
PAGE = repo / "packages/verify/r/page.css"


def blocks(css: str) -> tuple[dict[str, str], dict[str, str]]:
    light = re.search(r"^:root\s*\{([^}]*)\}", css, re.M)
    dark = re.search(r"prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([^}]*)\}", css)
    if not light or not dark:
        raise SystemExit("token blocks not found")
    parse = lambda body: {k: " ".join(v.split()) for k, v in re.findall(r"--([a-z0-9-]+):\s*([^;]+);", body)}
    return parse(light.group(1)), parse(dark.group(1))


def rule(css: str, selector: str) -> dict[str, str]:
    m = re.search(r"(?:^|\n)\s*" + re.escape(selector) + r"\s*\{([^}]*)\}", css)
    if not m:
        raise SystemExit(f"rule {selector} not found")
    decls = {k.strip(): " ".join(v.split()) for k, v in re.findall(r"([a-z-]+)\s*:\s*([^;]+);", m.group(1))}
    # The console names its font variable for Tailwind; the page, which has no Tailwind, names it --sans.
    return {k: v.replace("var(--font-sans)", "var(--sans)") for k, v in decls.items()}


def main() -> int:
    console_css, page_css = CONSOLE.read_text(), PAGE.read_text()
    source, copy = blocks(console_css), blocks(page_css)
    errors = []
    theme = re.search(r"@theme inline\s*\{([^}]*)\}", console_css).group(1)
    radii = dict(re.findall(r"--(radius-[a-z]+):\s*([^;]+);", theme))
    for k, v in radii.items():
        if copy[0].get(k) != v:
            errors.append(f"{PAGE.relative_to(repo)}: --{k} is {copy[0].get(k)}, the console's is {v}")
    for sel in (".btn", ".btn-primary", ".btn-secondary"):
        want, have = rule(console_css, sel), rule(page_css, sel)
        if want != have:
            diff = sorted(set(want.items()) ^ set(have.items()))
            errors.append(f"{sel} differs between the console and the page: {diff}")
    for scheme, want, have in (("light", source[0], copy[0]), ("dark", source[1], copy[1])):
        for k, v in want.items():
            if k not in have:
                errors.append(f"{PAGE.relative_to(repo)} ({scheme}): --{k} is missing (console: {v})")
            elif have[k] != v:
                errors.append(f"{PAGE.relative_to(repo)} ({scheme}): --{k} is {have[k]}, the console's is {v}")
    for e in errors:
        print(e)
    print(f"design tokens: {len(source[0])} light + {len(source[1])} dark tokens, {len(radii)} radii and 3 button rules compared, {len(errors)} difference(s)")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
