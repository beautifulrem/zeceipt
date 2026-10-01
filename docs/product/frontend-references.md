# Frontend references and redesign brief

Status: proposal, 2026-10-01. Scope: the static pages in `packages/verify/`: landing (`index.html`, `home.css`), case review (`case/`), builder (`build/`) and receipt (`r/`). Submissions close 2026-10-12 PT, which leaves 10 working days for one maintainer.

Reference sources were cloned read-only (shallow or sparse) into `/Volumes/Remi/hackathon/raw/fe-refs/`. Nothing was installed, built or run. Screenshots are in `/Volumes/Remi/hackathon/raw/fe-refs/shots/` and were taken with `raw/fe-refs/shoot.mjs` and `shoot2.mjs`, which use Playwright with system Chrome as `test/dossier.e2e.mjs` does. In this document, `refs/` stands for `/Volumes/Remi/hackathon/raw/fe-refs/` and `shots/` for `refs/shots/`.

Screenshots of the current pages (live site, 2026-10-01):

- `shots/zeceipt-landing-light.png`, `shots/zeceipt-landing-dark.png`
- `shots/zeceipt-case-empty.png`, `shots/zeceipt-case-sample-light.png`, `shots/zeceipt-case-sample-dark.png`, `shots/zeceipt-case-sample-mobile.png`
- crops: `shots/zeceipt-case-verdict-crop.png`, `shots/zeceipt-case-flow-crop.png`
- `shots/zeceipt-build-light.png`, `shots/zeceipt-receipt-empty.png`

---

## 1. References: what to learn from each

Seven open-source frontends and one closed-source compliance product were studied. They were chosen because each one shows something a reviewer needs when reading a case: transactions, funds flow, verification status and evidence.

### 1.1 mempool.space (`mempool/mempool`, Angular + Bootstrap SCSS)

Screenshots: `shots/mempool-tx-multi.png`, `shots/mempool-tx-multi-full.png`, `shots/mempool-tx-multi-flow-crop.png` (5 inputs, 6 outputs), `shots/mempool-tx.png`.

**Funds-flow "bowtie".** The flow is drawn by `refs/mempool/frontend/src/app/components/tx-bowtie-graph/tx-bowtie-graph.component.ts`:
- Inputs come in on the left and outputs leave on the right. Each strand's thickness is proportional to its value (`initLines`, L272–289): `combinedWeight * value / total`.
- A minimum stroke keeps tiny outputs visible (`minWeight = 2`, L55). Zero-value outputs get a fixed stub (`zeroValueThickness`, L79).
- Strands are capped at `maxStrands = 24` (L56), and the rest are folded together.
- The paths are plain cubic Béziers (`makePath`, L404–419): `M start outer L curveStart outer C mid outer, mid inner, curveEnd inner L end inner`. Connectors are arrow-shaped polygons (`makeConnectorPath`, L433).
- Hovering a strand highlights it and its row in the input/output list (`.line:hover`, `tx-bowtie-graph.component.scss`).
- The geometry needs no library. It is about 150 lines we can port to vanilla `createElementNS`.

**Input/output list** (`components/transactions-list/transactions-list.component.*`):
- Two columns, inputs and outputs, with a red or green arrow disc at the outer edge.
- Amounts are right-aligned. The unit `BTC` is set smaller and muted (`<span class="symbol">`, `components/amount/amount.component.html`).
- The total is shown as a solid chip under the outputs.

**Address truncation** (`shared/components/truncate/truncate.component.{html,scss}`):
- The head of the address gets `text-overflow: ellipsis` and the last N characters (`lastChars`, 8 for addresses) never shrink. This is a CSS-only middle ellipsis that adapts to the available width.
- The full string sits underneath in a transparent `.hidden-content` span, so select-and-copy and find-in-page still work.

**Address poisoning warning** (`shared/components/address-text/address-text.component.html`): when two outputs share a prefix and suffix, the shared parts are shown and the differing infix is underlined in a group colour, with a warning icon. The same idea applies to us: show a reviewer when a funder address and the assigned deposit address only look alike.

**Status** (`shared/components/confirmations/confirmations.component.html`): one solid chip per state ("1 confirmation", "Replaced", "Removed", "Unconfirmed"), each a full word in a fixed colour.

**What not to copy:** the dark navy and purple gradients (`styles.scss` `$bg: #11131f`, `--tertiary #6225b2`) are a consumer brand, not a compliance look. So are the 3D block carousel and Bootstrap's striped tables. Take the geometry, not the paint.

### 1.2 Blockscout (`blockscout/frontend`, Next.js + Chakra UI v3)

Screenshots: `shots/blockscout-tx.png`, `shots/blockscout-tx-dark.png`, `shots/blockscout-tx-tokentransfers.png`, `shots/blockscout-tx-tokentransfers-dark.png`, `shots/blockscout-address.png`. The repo also ships Playwright component baselines, for example `refs/blockscout-frontend/src/shared/tags/status-tag/__screenshots__/StatusTag.pw.tsx_default_ok-status-1.png` and `src/slices/address/components/from-to/__screenshots__/AddressFromTo.pw.tsx_default_outgoing-txn-1.png`.

**Detail grid** (`src/shared/detailed-info/DetailedInfo.tsx`):
- Two columns: `templateColumns: 'max-content minmax(728px, auto)'` (L19), with a fixed 32px value line height (`ITEM_VALUE_LINE_HEIGHT`, L12).
- Each label has a small (?) hint icon. Long explanations live in its tooltip, not on the page. This is the main lesson for our copy.
- Groups are separated by hairline dividers, not by cards.

**Type scale** (`src/toolkit/theme/foundations/typography.ts`):
- Headings: 32/40, 24/32, 18/24, 16/24, 14/20, weight 500.
- Body: 20/28, 16/24, 14/20, 12/16.
- Only two weights carry hierarchy, and nothing is uppercase.

**Radii** (`src/toolkit/theme/foundations/borders.ts`): `sm` is 4px, `base` 8px, `md` 12px and `lg` 16px. Badges and tags use `sm`, 4px (`recipes/badge.recipe.ts` L9). They are rectangles, not pills.

**Status tag** (`src/shared/tags/status-tag/StatusTag.tsx`, `src/slices/tx/components/TxStatus.tsx`):
- Three types: `ok`, `error` and `pending`, coloured green, red and gray, with a 10px icon and a word ("Success", "Failed", "Pending").
- In `mode="compact"` only the icon shows and the word moves to a tooltip. That suits repeated statuses, such as our flow edges.

**Badge colours** (`src/toolkit/theme/foundations/semanticTokens.ts`, L362–455): `badge.green.bg = green.50 / green.800`, `fg = green.500 / green.200`, and so on. The background is subtle, there is no border and the foreground is saturated, which is calmer than ours (border, background and coloured text).

**Transfer list** (`src/slices/token-transfer/components/list/TokenTransferTableItem.tsx`, `src/slices/address/components/from-to/AddressFromTo.tsx`):
- One row per movement: asset | from → to | value, with the value right-aligned.
- `AddressFromTo` lays out `from [icon] to` on a three-column grid (`minmax(auto,min-content) 20px minmax(auto,min-content)`).
- It drops the link and copy button on the side that is the current address (`noLink={isOutgoing}`). This is the right model for our path, deposit and transparent-payment claims.

**Address entity** (`src/shared/entities/components.tsx`, `src/slices/address/components/entity/AddressEntity.tsx`):
- Identicon, then the hash in one of several truncation modes (`dynamic`, `constant` and `constant_long` with 16 symbols, `tail`), then a copy button.
- The full value is always shown in a tooltip.

**Shielded values** (`src/shared/values/entity/ConfidentialValue.tsx`): a value that cannot be known is shown as `•••••`, a deliberate glyph rather than "N/A". Use it for undisclosed inputs.

**Dark mode:** every semantic token has a `_light`/`_dark` pair. Dark text is `whiteAlpha.800`, not pure white.

### 1.3 Safe{Wallet} (`safe-global/safe-wallet-monorepo`, Next.js + MUI, migrating to shadcn/Base UI + Tailwind v4 + lucide-react)

Screenshots: `shots/safe-history-expanded.png` (full page) and `shots/safe-tx-expanded-crop.png` (one transaction expanded with its audit log), `shots/safe-history.png`.

**Transaction detail layout** (`refs/safe-wallet-monorepo/apps/web/src/components/transactions/TxDetails/index.tsx`):
- The main column holds the decoded call, fees, a collapsible "Transaction details" section and the list of actions.
- A side column takes 33% of the width and holds the **Audit log**.
- The row summary shows: nonce | type | "2 actions" | time | status word ("Success", in green text, no chip).

**Audit log** (`apps/web/src/components/common/AuditLog/index.tsx`, `styles.module.css`):
- A vertical timeline: Proposed → Signed (1/3) → Signed (2/3) → Signed (3/3) → Executed.
- Each row is a 28px round icon from Lucide (`ACTION_ICONS`, L13: `Plus`, `PenLine`, `Check`, `Clock`, `CircleAlert`), a label, the actor's short address and a timestamp on the right.
- The grid is `28px 1fr auto` with a 2px connector line.
- It reflows with a container query at 300px (`@container audit-log-container (max-width: 300px)`).
- The header reads "AUDIT LOG ✓ 3/3", with copy, hash and external-link icon buttons.

This is the model for our challenge record: Nonce issued (H₀) → Control transaction mined → Dossier built → Checked here.

**Address** (`apps/web/src/components/common/EthHashInfo/SrcEthHashInfo/index.tsx`):
- `highlight4bytes` (L83) bolds the first four characters after `0x` and the last four, and leaves the middle regular, so people compare what they actually compare.
- It adds an optional chain prefix in bold (`eth:`) and an identicon, and uses `shortenAddress` on mobile.

**Tokens:**
- `packages/theme/src/palettes/light.ts`: text `#121312` / `#A1A3A7`, borders `#DCDEE0`, background `#F4F4F4`, success `#00B460` on `#CBF2DB`, warning `#FF8C00` on `#FFECC2`, error `#FF5F72` on `#FFE0E6`.
- `packages/theme/src/tokens/typography.ts`: DM Sans; h1 32/36 at 700, body1 16/22, body2 14/20, caption 12/16.
- `packages/theme/src/tokens/radius.ts`: the default is 6px.
- `packages/theme/ARCHITECTURE.md`: one palette package generates MUI, Tamagui and `vars.css` (`apps/web/src/styles/vars.css`, "generated, do not edit"). Our `check_design_tokens.py` does the same job, by checking where Safe generates.

**Copy:** short nouns ("Fees", "Paid from the signer", "Transaction details", "All actions") and counts ("2 actions", "3/3"). No marketing.

### 1.4 Otterscan (`otterscan/otterscan`, Vite + React + Tailwind v4 + Headless UI)

No live screenshot: Cloudflare blocked the public instances (otterscan.io). This entry rests on the code only.

**Font roles as tokens** (`refs/otterscan/src/index.css` L21–28): `--font-address`, `--font-hash`, `--font-data`, `--font-balance` and `--font-blocknum`. The kind of datum picks the face, not the component. Adopt the idea with two faces: identifiers in mono, amounts in tabular figures.

**Selection highlight** (`src/selection/SelectionHighlighter.tsx`, `useSelection.ts`): hovering an address, value or method highlights every other occurrence on the page with a dashed orange border and amber background. For us, hovering `n2` or an address in the claims table should light up the same note in the flow and the funders table. It is a cheap, high-value forensic affordance.

**Info rows** (`src/components/InfoRow.tsx`): `sm:grid-cols-4`, with the label taking one column and the value three. Same idea as Blockscout, simpler.

**Direction tag** (`src/components/TransactionDirection.tsx`): `IN`, `OUT`, `SELF` and `INT` as small square tags. It maps onto our claim kinds: Origin = in, Payment = out, Path = self, Control = self.

### 1.5 CipherScan (`Kenbak/cipherscan`, Next.js 16 + Tailwind v4 + Geist; Zcash explorer)

Screenshots: `shots/cipherscan-tx.png` (light; this deshielding transaction is the closest analogue to our origin and transparent-payment steps), `shots/cipherscan-tx-io.png`, `shots/cipherscan-tx-dark.png` (now branded "ZecBlock", caught mid-load with skeletons), `shots/cipherscan-home.png`.

**Hero flow** (`refs/cipherscan/app/tx/[txid]/components/TxHeroFlow.tsx`):
- A one-line diagram, `[Orchard Pool] → 11.0003 ZEC ($…) → t1avp5…CbmW`, followed by one plain-language sentence: "11.0003 ZEC moved out of the private shielded pool to the public address t1avp5…CbmW. Included in canonical Zcash block #3100000 with 402,351 confirmations."
- `rankedNodes` (L101) shows only the largest party and folds the rest into "+N more", which carries their combined total. Its doc comment explains why: a wall of addresses "reads as a wall of text rather than a clear headline fact".
- Each funds-flow step of ours should open with exactly this kind of node → amount → node line.

**Tokens** (`app/globals.css`):
- A Major Third type scale (L99): 12, 14, 16, 20, 24, 30, 38, 48, 60.
- Radii (L126): 6, 8, 10, 16, 20, 24.
- Theme-aware tokens go in `@theme inline` and static ones in `@theme`.
- The brand is described in `BRAND.md`: "Confident and short, technically precise", Inter or Geist with JetBrains Mono, dark-first.

**Status in the dark build:** square mono tags `CONFIRMED` and `SHIELDED` with a tinted background and no border. Block, confirmations and age sit in one mono metadata line.

**Caution:** CipherScan also uses `> TX_LOOKUP` terminal eyebrows and many mono-uppercase labels. In 2026 that is the same "dev-tool cosplay" look we are trying to drop (see §2). Take the flow line and the summary sentence, not the eyebrows.

### 1.6 Zenvelope (`IhorMuliar/zenvelope`, Vite + React, plain CSS; Zcash, same hackathon)

Screenshot: `shots/zenvelope-home.png`.

**The same constraints as ours, already solved with a build step:**
- A static host, WASM, the secret in the URL fragment, and a CSP of `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; …` with no `unsafe-inline`.
- That CSP is in `web/index.html` as a `<meta>` fallback, and `web/netlify.toml` and `public/_headers` carry the same policy as headers. `src/lib/headers.test.ts` fails the build if the three drift apart.
- `web/vite.config.ts` shows the WASM gotchas a Vite migration would hit:
  - `optimizeDeps.exclude` for the wasm-bindgen glue ("esbuild would break its `import.meta.url` handling").
  - A custom plugin to copy the threaded WASM package verbatim, outside the module graph.
- This is evidence that option (b) in §3 is feasible. It is also evidence of its cost.

**Copy as a module** (`web/src/copy/en.ts`): every user-facing string lives in one file, and `en.test.ts` enforces rules on it (for example, never the word "claim"). Our `case/view.js` already holds most strings (`STATUS_LABEL`, `KIND_HELP`); finish that move.

**Trust boundary as a component** (`web/src/components/TrustBoundary.tsx`): an irreversible privacy step gets its own screen with a checkbox gate, not a line of fine print. This applies to our "Copy a review link", which leaks the whole dossier.

**Look:** warm off-white `#fbfaf7`, accent `#b8860b`, a single 44rem column, numbered cards (`web/src/styles.css`). It is close to our current look, and it is what we want to move away from: a single centred column, three equal cards and a gold button.

### 1.7 Nighthawk zcash-explorer (`nighthawk-apps/zcash-explorer`, Phoenix + Tailwind): an anti-reference

The live site (zcashblockexplorer.com) failed its TLS check, so there is no screenshot. In `refs/zcash-explorer/lib/zcash_explorer_web/templates/transaction/tx.html.heex` (L45–75, L286–347), status is shown as `rounded-full` pills in `bg-yellow-400` / `bg-green-200` with emoji (`🛡 Shielded`). That is stock Tailwind UI. It is what "generated" looks like, and it is listed here so we avoid it.

### 1.8 Compliance tools: Range, and Arkham / Chainalysis / TRM (closed source)

Screenshot: `shots/range-home.png`. Arkham's explorer sits behind a Cloudflare challenge in automation, and Chainalysis Reactor and TRM Forensics are login-only, so we have no live screenshots of them.

**Range landing:**
- The hero has a short two-line claim on the left and a live product panel on the right.
- The panel shows "AML company policy, procedure 4.2 · Running" and a step list: Collect activity (Checking), Classify transactions (Waiting), Screen counterparties, Match counterparties.
- The product is the illustration: no feature cards, no numbered circles.
- The palette is a dark green ink on warm white, and there is very little colour.

**Reactor, TRM and Arkham** (from public docs and marketing): a graph canvas with entity nodes and value-weighted edges, a side panel for the selected entity, and a dense transaction table with a direction column and right-aligned amounts. Our dossiers are small, at most about 15 claims, so we need the left-to-right Sankey idea, not a free-form graph.

---

## 2. Why the current pages read as "AI-generated"

Every point below is in the shipped CSS or HTML.

1. **Mono-uppercase micro-labels everywhere.** This is the 2024–26 v0/shadcn signature. It appears in:
   - `.eyebrow` (`r/page.css` L173)
   - `h3` (L131: mono, 0.72rem, 0.08em tracking, uppercase)
   - `.facts dt` (`case/case.css` L94)
   - `.step-number` (L151, "STEP 1")
   - `.claims-table th` (L253)
   - the footer (`.foot` is set in `var(--mono)`)

   The case page sets 20+ labels this way. Labels in Blockscout, Safe and mempool are sentence-case sans.
2. **A decorative glow.** `--glow` is a radial amber gradient behind the page (`r/page.css` L59 and dark L101, applied at L118). It is decoration with no meaning.
3. **A generic hero.**
   - The landing H1 is a 21-word sentence at up to 2.9rem (`home.css` L5) that wraps to four lines (`shots/zeceipt-landing-light.png`).
   - Under it: a 60-word lede, two buttons, then a 40-word "try" line.
   - The product itself is never shown above the fold.
   - Case and Build repeat the pattern with an eyebrow, a big H1 and a long muted lede.
4. **Numbered circles in "How it works".** `.how li::before` (`home.css` L16) draws three amber-tinted 999px circles over three equal columns. This is the most templated block on the page.
5. **A uniform stack of rounded cards.**
   - `.card` (`r/page.css` L184) has a 16px radius, a shadow and 1.35/1.5rem padding, and it is the only container.
   - The case page stacks 11 of them in an 880px column (`main`, L169).
   - Cards nest inside cards: `.step` (`case.css` L132) sits inside `#flow-card`, `.flagship` (L216) inside `#input-card`, and `.nonce-line` (L99), `.deposit-line` (L104) and `.sample-nonce-row` (L209) inside `#banner`.
   - Hierarchy comes from boxes, not from type and space.
6. **Too many pills and circles.**
   - `.chip` "Runs in your browser" in the top bar (L162)
   - `.badge` at 999px (`case.css` L115)
   - `.pill` (L195)
   - the 3.25rem round `.verdict-icon` (L331)
   - status dots (`.status::before`, L178)
   - `.step-dot` circles and a rotated diamond (`case.css` L143)
7. **A ✓/✗ two-column list.** `.checks`/`.limits` (`r/page.css` L363–365) appear as "What a verified dossier shows / Honest limits" (landing), "What the holder disclosed / What this does not prove" (case) and "What a dossier shows / What it does not hand over" (build). The same icon-list block appears three times, and the heading "Honest limits" sounds like an LLM.
8. **Brand amber collides with warning amber.** `--accent-soft #fdf4dc` and `--warning-soft #fdf2e2` (L39 and L46) are nearly the same colour. The flagship sample box (`.flagship`, accent-soft) and the sample-nonce row (`.sample-nonce-row`, accent-soft) look exactly like the warnings next to them (`.offline-line`, `.deposit-line`, warning-soft). In `shots/zeceipt-case-verdict-crop.png` the "try it" box reads as a caution. Six tinted callouts compete on the case page.
9. **Status repeated until it is noise.** For four claims the sample case shows 11 green "Verified" pills: one per step, one per edge and one per table row (`shots/zeceipt-case-flow-crop.png`).
10. **Prose where data belongs.**
    - The "Decision summary" puts five columns of 11px sentences under 11px mono labels (`.facts.decision`, `case.css` L199; `.decision-detail`, L201). Each fact is a paragraph ("0.2 TAZ from transparent inputs; of the inputs, 0.09985 TAZ went back to tmPVt…").
    - The challenge section opens with a 110-word paragraph.
    - "After the case" is two paragraphs of 80+ words.
    - Each one is accurate, but together they bury what a reviewer needs.
11. **A rhetorical headline.** "Claims verified — control not shown", with an em dash, is set in 1.9rem bold in the tone colour (`.verdict-word`, L339). Compliance tools state counts: "4 of 4 claims verified".
12. **Gimmicky motion and skeuomorphism.**
    - `@keyframes stamp` and `ring` animate the verdict icon (the `r/page.css` Motion section).
    - A torn-receipt mask (`.slip-wrap`, L321–330).
    - These charm on a consumer receipt but read as ornament in a case file.
13. **Everything centred in one narrow column.** The 880px `main` and `.topbar-inner` leave about 40% of a 1440px screen empty, while a 64-character txid wraps and the claims table squeezes its "What the chain shows" column (`shots/zeceipt-case-sample-light.png`). The second column could hold the case record and the challenge, as Safe uses its audit-log column.
14. **The same footnote on every page.** A shield icon with a "Privacy: this page asks…" line at the bottom (`.privacy`, L367), plus a green "Runs in your browser" pill at the top. One clear statement, placed once in a fixed spot, is more credible.

The fonts (Geist and Geist Mono) and the icons (Lucide) are not the problem. They are what Vercel, CipherScan and Safe use too. The "AI" look comes from the combination of mono eyebrows, glow, pills, 16px cards and a single centred column.

---

## 3. Architecture and libraries

### Options

| | (a) Stay no-build, vendor static assets | (b) Vite + Preact or Lit + Tailwind v4 (or vanilla-extract) |
|---|---|---|
| Strict CSP | Unchanged: external `type="module"` scripts and same-origin CSS. SVG flow via `createElementNS` with presentation attributes (`d`, `stroke-width`), and CSSOM `el.style.setProperty` where needed (allowed under `style-src 'self'`; a `style="…"` attribute string is not). | Feasible: Zenvelope runs Vite + React under the same CSP (`web/index.html`). But Vite inlines small assets as `data:` URIs by default (`img-src 'self'` blocks them, so `build.assetsInlineLimit: 0` is needed), dev mode injects `<style>` tags (needs a dev-only CSP), and the CSP meta has to be kept in each emitted HTML. |
| GitHub Pages under `/zeceipt/` | Works today (`scripts/build_site.sh`, `.github/workflows/pages.yml`). | Needs `base: '/zeceipt/'`, a multi-page `rollupOptions.input` (index, case, build, r, demo) and a changed `build_site.sh`. |
| WASM (`pkg/zeceipt_wasm_bg.wasm`, `src/index.js`) | Untouched. | wasm-bindgen's `new URL(…, import.meta.url)` must survive bundling: `optimizeDeps.exclude`, as Zenvelope learned (`web/vite.config.ts`). The page footer prints the verifier sha256, so hashed asset names change what it reports. |
| Tests (`test/dossier-view.mjs`, `dossier.e2e.mjs`, `page.e2e.mjs`, about 210 KB) | Keep passing if ids and the listed classes stay (see the table below). `case/view.js` (pure logic) is unchanged. | `dossier-view.mjs` imports `case/view.js` and `build/view.js` directly, so they must stay plain ESM. The e2e tests serve `packages/verify` and would need to serve `dist/` instead. Every DOM builder in `case/page.js` (34 KB) and `case/ui.js` is rewritten, and then the whole e2e suite is re-validated. |
| Design-token check (`scripts/check_design_tokens.py`) | Unchanged, or one path change if tokens move into `r/tokens.css`. | Tailwind v4 `@theme` would match the console (`apps/console/app/globals.css` already uses `@import "tailwindcss"` with `@theme inline`), which is a real long-term plus. The check script still needs rewriting. |
| 10 days, 1 maintainer | About 6 days of CSS and small DOM changes, with tests green throughout. | 4–5 days just to reach parity, with the risk concentrated just before the deadline. |

### Recommendation: (a), stay no-build, with a disciplined CSS structure

Concretely:

- **Colors:** use Radix Colors (MIT) as the *source of values* for the neutral scale. Copy the hex values into the existing semantic tokens in both `apps/console/app/globals.css` and `r/page.css`, so nothing is loaded at runtime. Choose sand for warm continuity, or slate for a cooler, more institutional feel. The 12-step semantics (1–2 backgrounds, 3–5 component fills, 6–8 borders, 9–10 solids, 11–12 text) give each token a reason. Keep the status hues already in the tokens: they pass `apps/console/test/contrast.test.ts`. The values from Radix's step 11 on step 3 for amber and blue measure 4.25:1 and fail AA (computed below).
- **Fonts:** keep Geist and Geist Mono, which are already vendored in `r/fonts/` and shared with the console. Add `font-variant-numeric: tabular-nums` to every amount. Do not add a third face.
- **Icons:** keep Lucide as CSS masks (`r/icons/`). Add only `arrow-right`, `arrow-down-left`, `arrow-up-right`, `repeat` and `hash` (ISC). Use them for the direction tags and the challenge log.
- **Cascade:** split the stylesheet with native `@layer tokens, base, components, pages;` (no build needed) into:
  - `r/tokens.css`, the checked copy; point `check_design_tokens.py` at it
  - `r/base.css`
  - `r/components.css`, with the badge, address, amount, table, verdict, panel and log components
  - the page files

  This ends the current cascade, in which `home.css` loads on top of `case.css`, which loads on top of `page.css`.
- **Flow diagram:** hand-port mempool's bowtie geometry (§1.1) into `case/flow-svg.js`, about 150 lines with no dependency. d3-sankey is not worth vendoring for graphs of 15 nodes or fewer.
- **Do not adopt:** Open Props, which is a second token system and would fight the check, or any `@fontsource` packages (Geist is already in place).

Revisit option (b) after the hackathon, when the receipt page, the case page and the console could share Preact components and Tailwind `@theme` tokens. Zenvelope's `vite.config.ts` and `headers.test.ts` are the blueprint for that move.

### Ids and classes the tests depend on (do not rename)

All ids are load-bearing, including `status`, `headline`, `verdict-sub`, `banner`, `banner-error`, `parse-raw`, `facts`, `nonce-line`, `nonce-note`, `deposit-line`, `offline-line`, `sample-nonce`, `sample-nonce-row`, `flow`, `claims`, `preview`, `built`, `build-error`, `error-text`, `copy-live`, `nonce-input`, `h0-status`, `deposit-status`, `scan-status`, `beacon-status`, `link-status`, `tx-files-status`, `outcome`, `receipt`, `inclusion`, `binding` and `source-status`.

These classes are queried by the tests:

| Selector used in tests | Meaning |
|---|---|
| `#flow > li.step`, `li.step.tone-failed`, `#flow .step-tx` | flow steps and their transaction line |
| `#flow .edge`, `.edge .badge`, `.badge-verified` | per-claim lines under a step, and their status |
| `#flow .chip-untraced` | an untraced note |
| `#claims tbody tr`, `#claims .badge-verified` | claim table rows and status |
| `#claims .row-flag.flag-warn`, `.row-flag.flag-ok` | amber or green flags under a claim |
| `#preview tbody tr`, `#preview .badge-verified` | the builder's preview table |
| `.checks li, .limits li` | the receipt page's lists |
| `#payment .amount`, `#summary tr[data-failed]`, `#verdict-note code` | the receipt page |
| `button:visible, .btn:visible`, `main a`, `dt`/`dd` inside `#facts` | generic |

Restyling these is free. Moving elements in the DOM is fine, except where `page.e2e.mjs` checks the order of `#outcome` relative to `#receipt`.

---

## 4. Redesign spec

### 4.1 Global

**Layout grid**
- Page max width 1280px with a 24px gutter. The topbar uses the full width.
- Case and Build use two columns at ≥1100px: main `minmax(0, 1fr)` and a rail of 360px, with a 32px gap. The rail is `position: sticky; top: 72px` and carries `container-type: inline-size`, as Safe's audit log does. This borrows Safe's TxDetails split.
- Below 1100px the rail drops under the verdict, not to the bottom of the page.
- Below 640px everything is one column, tables become stacked rows (the existing rules), and identifiers are truncated more aggressively.
- Sections are separated by 32px of space and a 1px `--line` hairline with an `h2`, not by cards. A card (a bordered surface) is used only for an interactive object: the input panel, a rail panel or the flow canvas.

**Radii:** 4px for badges, tags and inputs' inner chips; 6px for buttons and inputs (the console's `--radius-sm`); 8px for panels. Nothing round except avatars. This borrows Blockscout's `borders.ts` and Safe's `defaultRadius = 6`. The console's `@theme` radii stay as they are, which keeps the check passing; pages simply stop using `--radius-xl`.

**Shadows:** none on panels. Use `--shadow-raised` only for popovers and tooltips.

**Typography** (Geist; Blockscout sizes; one scale for all pages)

| Token | Size / line | Weight | Use |
|---|---|---|---|
| `--text-display` | 36/44 | 600, −0.02em | landing H1 only |
| `--text-h1` | 24/32 | 600 | page title ("Case ZC-2026-0412", "Build a dossier") |
| `--text-h2` | 16/24 | 600 | section titles ("Claims", "Funds flow") |
| `--text-body` | 14/20 | 400 | default UI text (body drops from 15px to 14px, as in Blockscout and Safe) |
| `--text-small` | 12/16 | 500 | labels, table headers, hints; **sentence case, sans, no tracking** |
| `--text-mono` | 13/20 Geist Mono | 400 | txids, addresses, nonces, hashes |
| `--text-amount` | 14/20 Geist, `tabular-nums` | 500 | amounts; 20/28 in the stat row |

The only uppercase text left is network tags (`TESTNET`), and only inside a tag.

**Colour tokens.** Semantic names stay; neutrals take Radix sand values. Status values are the current, contrast-tested ones, except the two marked "new".

| Token | Light | Dark | Note |
|---|---|---|---|
| `--canvas` | `#f9f9f8` (sand-2) | `#111110` (sand-dark-1) | was `#f6f6f3` / `#090a0f` |
| `--surface` | `#ffffff` | `#191918` (sand-dark-2) | |
| `--surface-2` | `#f1f0ef` (sand-3) | `#222221` (sand-dark-3) | table header, hover |
| `--line` | `#e2e1de` (sand-5) | `#31312e` (sand-dark-5) | hairlines |
| `--line-strong` | `#cfceca` (sand-7) | `#494844` (sand-dark-7) | panel borders |
| `--input-line` | `#8d8d86` (sand-9, 3.34:1) | `#6f6d66` (sand-dark-9, 3.40:1) | must stay ≥3:1 (WCAG 1.4.11) |
| `--fg` | `#21201c` (sand-12, 16.3:1) | `#eeeeec` (15.1:1) | |
| `--muted` | `#63635e` (sand-11, 6.0:1) | `#b5b3ad` (8.4:1) | |
| `--subtle` | keep `#6e7380` | keep `#7b8294` | sand-10 is only 3.9:1, so do not use it for text |
| `--success` / `-soft` / `-line` | keep `#11703a` / `#e8f5ed` / `#b3dcc1` | keep `#5ad38a` / … | |
| `--warning` / `-soft` / `-line` | keep `#8f4f00` / `#fdf2e2` / `#efcf9c` | keep | |
| `--danger` / … | keep | keep | |
| `--info` / … | keep `#1b58c4` / `#ebf1fd` / `#bdd0f5` | keep | **samples, demo and offline mode use info, not accent** |
| `--accent` | keep `#f4b728` | keep | **only** the logo, the focus ring (`--ring`) and the link underline |
| `--accent-soft` | `#fbf7ec` (new, desaturated) | `#1d1a12` (new) | for hover on brand links only; never a callout fill |
| `--glow` | remove | remove | |

Measured contrast for the candidate Radix pairs: sand-11 on white 6.04, sand-11 on sand-3 5.31, grass-11 on grass-3 4.54, red-11 on red-3 4.54, amber-11 on amber-3 **4.25 (fails)**, blue-11 on blue-3 **4.25 (fails)**. That is why the status hues keep their current values.

**Rule:** one tinted callout per screen at most. All other states use the badge, the stat row or plain text.

### 4.2 Components

**Status badge** (`.badge`, `.badge-<status>`; borrows Blockscout's `StatusTag` and `badge.recipe.ts`)
- 20px tall, 4px radius, no border, `--tone-soft` background, `--tone` text at 12px/500, a 12px Lucide icon and a word: Verified, Failed, Not checked yet, Not proven.
- A compact mode, `.badge.is-compact`, shows the icon only, with the word in `title` and an `aria-label`. Use it on flow edges; the `.badge-verified` class stays, so the tests still pass. That leaves one full badge per claim, in the table.

**Direction tag** (`.kind-tag`; borrows Otterscan's `TransactionDirection` and Blockscout's token-type badge)
- A neutral 4px tag in front of each claim kind: `In` (origin), `Self` (path, control) and `Out` (deposit, transparent payment).
- Each gets a 12px arrow icon: `arrow-down-left`, `repeat` or `arrow-up-right`.

**Identifier** (`.id`; borrows mempool's `truncate`, Safe's `highlight4bytes` and Blockscout's `AddressEntity`)
- Markup:

  ```html
  <span class="id" title="full">
    <span class="id-head">5146f38c</span>
    <span class="id-mid">…</span>
    <span class="id-tail">36e6</span>
    <button class="copy">
  </span>
  ```

- On screen, `.id-head` ellipsizes (`flex-shrink:1; overflow:hidden; text-overflow:ellipsis`) and `.id-tail` never shrinks: 8 characters for txids, 6 for addresses and nonces.
- The head and tail are `font-weight: 600`, the middle 400.
- A visually hidden copy of the full value keeps find-in-page working.
- In print the full value is shown (the existing `.print-full`).
- Hovering any `.id[data-key]` or note chip adds `.is-selected` to every element with the same `data-key`: a dashed `--accent` outline on `--accent-soft`. This is Otterscan's `SelectionHighlighter`, done in about 20 lines in `case/ui.js` with `mouseover` and `focusin` on `main`.

**Amount** (`.amount`; borrows mempool's `amount.component` and the existing `.amount-zeros` rule)
- Geist with `tabular-nums`, right-aligned in tables, always 8 decimals in tables (`0.20000000`), with trailing zeros muted (`.amount-zeros`, which is checked against the console).
- The unit `TAZ`/`ZEC` is 11px, muted, after a thin space.
- Undisclosed values render as `•••••` with a "not disclosed" tooltip, as in Blockscout's `ConfidentialValue`, and lower bounds as `≥ 0.0500`.
- Headline figures, in the stat row, show 4 decimals at 20/28.

**Verdict header** (`#banner`, `#headline`, `#verdict-sub`; borrows Safe's tx summary row, Blockscout's page header and CipherScan's header badges)
- The header is not a card. It is a full-width band at the top of the main column, with a 3px left rule in `--tone`. Inside:
  1. A title row: `#headline` at 24/32, 600, in `--fg` (not the tone colour), followed by one status badge in `--tone`. Example: **4 of 4 claims verified** with a `Control not matched` tag (amber).
  2. `#verdict-sub`: one sentence, at most 25 words. The rest goes into a "Why" disclosure.
  3. **Stat row** (replaces the decision summary; borrows CipherScan's overview tiles and Blockscout's stat recipe):

     | Arrived | Paid out | Explained | Control | Claims |
     |---|---|---|---|---|
     | 0.2000 TAZ in 1 note | 0.0500 TAZ in 1 payment | Yes | Not matched | 4 verified |

     Labels are 12px sans muted; values are 16px/600 tabular. Each value has a hint (?) icon whose tooltip holds today's `.decision-detail` sentence (Blockscout's `DetailedInfo` hint).
  4. A meta line in mono 12px muted: `Dossier sha256 902f9b6b…98ae93 [copy] · Zcash testnet · built 2026-09-30 16:19 UTC · checked 2026-10-01 07:30 UTC via zjs.zec.rocks`. This is CipherScan's one-line metadata.
- Today's `#nonce-line`, `#nonce-note`, `#deposit-line`, `#offline-line` and `#sample-nonce-row` become **one** callout slot under the stat row, holding the most important note only. Tone: amber for a mismatch, info-blue for sample or offline mode, never brand amber. The other notes go into the challenge log in the rail.
- Remove `.verdict-icon`, `stamp`, `ring` and `.slip-wrap` on the case page. Keep the slip only on `r/`, the consumer receipt, if wanted.

**Claims table** (`#claims`; borrows Blockscout's table recipe and `TokenTransferTableItem`)
- Columns: `#` (mono, muted, 32px) | Claim (kind tag + "Origin") | Transaction (`.id`, with the height under it as 12px muted text) | Notes (`n1 → n2`, mono, hover-linked) | Amount (right-aligned) | Status (badge).
- The header row is 12px sans muted on `--surface-2`. Rows are 48px minimum, with a 1px `--line` between rows, never dashed.
- "What the chain shows" becomes an expandable row (`<details>` in the last cell, or a full-width second row) with today's summary, details and `row-flag`s. The summary's first sentence stays visible as 12px muted text under the claim kind.
- Failed rows get a 2px `--danger` left rule and keep their summary expanded.

**Funds flow** (`#flow`; borrows mempool's bowtie, CipherScan's `TxHeroFlow` and Blockscout's `AddressFromTo`). It has two layers:
1. **Overview** (new `#flow-graph`, an SVG above the list). This is a left-to-right Sankey of the whole case:
   - columns are steps, in time order, and each transaction is a 6px-wide vertical node labelled `tx 5146f38c…` with its height
   - links are notes, with width ∝ value (mempool's `minWeight` floor of 2px, cap 24 strands)
   - sources on the far left are transparent funders and undisclosed shielded senders. Undisclosed senders are drawn as a hatched strand labelled `•••••`.
   - outputs on the far right are payments, with the assigned deposit address in `--success`
   - untraced notes or undisclosed spends get an amber dashed stroke
   - the bezier geometry is mempool's `makePath`; colours come from tokens via classes (`.link-note`, `.link-payment`, `.link-untraced`)
   - hovering a link selects the same `data-key` as the table (Otterscan)
   - it is rendered with `createElementNS`; there is no `style=""` attribute anywhere
2. **Step list** (`#flow > li.step`, kept). Each step becomes a section with no card border:
   - a header line `Step 2 · Moved within the wallet, and paid out`, with the `.step-tx` id and height on the right
   - CipherScan's one-line hero flow: `[n1 0.2000] → tx a51d1271… → [n2 0.14985] + [#3 0.0500 → tmXdyC…KPAR]`
   - a Blockscout-style transfer table: From | → | To | Amount | Claim, one row per edge, with the compact badge in the last cell (keeps `.edge` and `.edge .badge`)
   - the rail line and dot stay as a 1px line with 8px square markers in `--tone` (no `box-shadow` rings)

**Funders** (`#funders-card`): a Blockscout detail grid, with the label column `max-content` and the values as `.id` + amount. The "who holds an address is not proven" text goes into a hint on the column header.

**Challenge panel** (`#challenge`, moved to the right rail; borrows Safe's Audit log). It has three parts:
1. **Fields:** nonce (full width, mono), H₀ and network side by side, then the deposit address. Hints become single sentences, with the long explanations behind (?) icons. The "Generate a nonce" and "Beacon nonce" buttons are icon-plus-text secondary buttons on one row.
2. **Challenge log** (new; Safe's `AuditRow` grid, `28px 1fr auto`):
   - `+ Nonce issued` · `zeceipt-challenge-322b…` · `H₀ 4422300`
   - `✎ Control transaction mined` · `tx 14a9551d…` · `height 4422305`
   - `✓ Answer matches nonce` (or `⚠ Not matched: no nonce entered`)
   - `↘ Deposit to assigned address` · `#3 0.0500 TAZ` (or "not found")
   - Each row has a status icon in a 28px round neutral disc. This is the only place circles are kept, as in Safe.
   - The header reads `Challenge ✓ 2/3`.
   - The log replaces `#nonce-result` and the nonce and deposit lines' prose. The ids stay, as visually hidden live regions.
3. **Steps for the holder:** an `<ol>` of 4 one-line steps with a `Copy for case file` button.

**Case record panel** (rail, above the challenge): Reviewer, Case id and Date (`#case-fields`), then the actions. "Download report (JSON)" is the primary button; "Print / PDF" and "Copy summary" are secondary. The "Hide nullifiers" checkbox sits under Download.

**Input panel** (`#inputs`):
- Before a dossier is loaded it is the page's only content, a single 720px panel:
  - a drop zone, 1px dashed `--input-line` at a 6px radius, with no tinted fill
  - a paste field
  - "Check the dossier"
  - one sample line, with samples listed as plain links: "Open a sample case: Exchange deposit (testnet) · Faucet with three payments · Transparent round-trip · Beacon control". The amber `.flagship` box is removed.
- Offline files sit in a `<details>`.
- After a dossier is loaded the panel collapses to one topbar-like row: `dossier.json · sha256 902f9b6b… · [Open another]`.

**Loading, empty and error states** (borrows CipherScan's and Safe's skeletons, `shots/cipherscan-tx-dark.png` and `shots/safe-history.png`):
- `#status` becomes a quiet line under the page title: "Verifier ready (WASM sha256 f5234f8a…)". There is no coloured dot while idle.
- While checking, the claims table renders N skeleton rows (`--surface-2` bars) and the stat row shows `—`.
- Errors use the verdict band with a danger rule, and the technical detail is folded underneath (keep `#parse-detail` and `#parse-raw`).

**Glossary and limits:** "Terms used here", "What the holder disclosed", "What this does not prove" and "After the case" move into one tabbed section at the bottom of the main column. Tabs: Disclosed | Not established | After the case | Terms. Each "not established" item becomes a two-column row (Topic | Why), not an ✗ list.

**Print layout** (A4 case report; borrows the existing `@page` work):
- `@page { size: A4; margin: 16mm 14mm 18mm; }`, base 9.5pt Geist, mono 8pt.
- Page 1:
  1. a header block with Case id, Reviewer, Date and Result, as a 4-cell table with ruled cells
  2. the stat row
  3. the claims table at full width with full identifiers (`.print-full`); details are printed expanded
  4. the step list (the SVG prints, monochrome-safe, with the hatched and dashed strokes)
  5. Disclosed / Not established as two compact columns
  6. a signature line: `Reviewed by ________ Date ________`
- The footer on every page keeps the dossier sha256, the verifier sha256 and "Page x of y" (already in `case.css`).
- Use no tinted fills except the badges, with `print-color-adjust: exact`. Rails, inputs, buttons and the glossary are hidden.

### 4.3 Landing page (`index.html`, `home.css`)

**Topbar:** wordmark | Case review · Build a dossier · Specification · GitHub. Remove the "Runs in your browser" pill and put that fact in the hero meta line.

**Hero** (two columns at ≥1024px; borrows Range's landing)
- On the left:
  - H1 at 36/44: **Source-of-funds evidence for shielded ZEC.**
  - Sub at 16/24, about 30 words: "A holder discloses the notes in question, not a viewing key. A reviewer checks each claim against the chain in the browser and files a report with the dossier's hash."
  - Buttons: `Open the sample case` (primary, goes to `case/#sample-exchange`) and `Build a dossier` (secondary).
  - A meta line in 12px muted: "Open source (Apache-2.0) · runs in your browser · no accounts, nothing stored".
- On the right: a static HTML rendering of the sample case's verdict band, stat row and first three claim rows, built from the same component CSS. It is a real product snapshot, not an image, and links to the live case. It is captioned "Sample: testnet exchange deposit, checked live".

**How a case runs** (replaces the three numbered circles; borrows Safe's Audit log)
- A horizontal four-step sequence with Lucide icons and thin connectors: Reviewer issues a nonce (H₀) → Holder answers from their wallet → Holder builds a dossier (viewing key stays on their device) → Reviewer checks every claim and files the report.
- Each step has one sentence, set as a single row of text, not cards.

**Claim kinds:** a four-row table (Kind tag | What it shows | What it rests on). It replaces the `<dl class="kinds">`.

**Established / not established:** one two-column table, not ✓/✗ lists. Rename "Honest limits" to "Not established by a dossier".

**Also here:** footer links, not a card.

### 4.4 Case page

- **Title row:** `Case review` (h1, 24/32). After a dossier loads, it becomes `Case: <subject or case id>`. The lede is removed; its one useful sentence ("A dossier opened by a link stays after the '#' and is not sent to this site") moves into the input panel hint.
- **Main column**, in order: input panel (collapsed once loaded) → verdict band → claims table → funds flow (overview SVG, then steps) → funders → tabbed reference section.
- **Rail**, in order: Case record → Challenge (fields, log, holder steps) → Privacy (one paragraph about what this page fetched, with a live count, for example "5 transaction lookups to zjs.zec.rocks").

### 4.5 Build page

- **Title row:** `Build a dossier`. The NU7 notice becomes a one-line banner above the title (Blockscout's top notice style: a neutral `--surface-2` strip with an `info` icon and a "Details" disclosure). It is not a tinted card.
- **Main column** is a numbered form, using section headings rather than circles: `1 Network and viewing key` → `2 Transactions` (two segmented tabs: Paste ids | Scan from a height) → `3 Control (optional)` → `4 Subject (optional)` → Build. "Try with the sample customer's viewing key" becomes a text button next to the key label.
- **Rail:** a "What leaves this page" ledger, replacing the green `.promise` card. It is a Safe-style key-value list that updates live:
  - Viewing key: Stays here (never sent)
  - Requests: 0 lookups so far
  - Dossier discloses: — notes, — receipts, nk
  - Stored: Nothing

  After the build it fills in with real counts, and "nk lets anyone holding the dossier see when these notes are spent" is a one-line amber row with a disclosure.
- **After build:** `#built` takes the verdict band styling (success rule), a stat row (Claims, Notes disclosed, Payments, Control), then the actions:
  - Download (primary)
  - Open in Case review
  - Copy a review link. This is gated by a Zenvelope-style trust-boundary confirmation: "Anyone with this link can read what the dossier discloses" plus a checkbox, which replaces the always-visible `.link-warning`.

  Below them, `#preview-card` uses the claims-table component.

### 4.6 Copy tone

Write like Safe and Blockscout: short labels, sentence case, counts and nouns. Explanations go in hints, the glossary and the specification. Examples:

| Now | Proposed |
|---|---|
| "Claims verified — control not shown" | "4 of 4 claims verified" + tag "Control not matched" |
| "Prove where your shielded ZEC came from, without handing over your viewing key." | "Source-of-funds evidence for shielded ZEC." |
| "Honest limits" | "Not established by a dossier" |
| "Try an exchange deposit review" + 40-word aside | "Open the sample case (testnet exchange deposit)" |
| "Decision summary" + five paragraphs | Stat row; each detail in a hint |
| "Runs in your browser" pill + "Privacy: this page asks…" footnote | One meta line in the hero, plus a Privacy panel in the rail with live counts |
| "It fills in the nonce the sample's reviewer issued, and the height then (H₀), as a reviewer would." | Button "Use the sample's nonce and H₀" |

Rules:
- no em dashes in headings
- no "honest", "simply", "just" or "seamless"
- numbers before adjectives
- a hint is one sentence, and a longer explanation links to the specification section

---

## 5. Changes, in priority order

Effort assumes one maintainer. The full list adds up to about 10.5 days, so it does not fit the 10 days left in full. Items 1–8 (about 6.5 days) are the cut that changes how the product reads. Items 9–14 can be trimmed: 11 is done alongside the others, and 13 can shrink to the palette swap alone. The tests (`npm test`, `test:dossier-pages`, `test:page`), `scripts/check_design_tokens.py` and the console's contrast test must stay green after each step.

1. **Strip the generic look (0.5 day, CSS only):**
   - delete `--glow` and its use
   - make `.eyebrow`, `h3`, `.facts dt`, `.step-number` and `.claims-table th` sentence-case 12px sans
   - pages stop using `--radius-xl`: panels 8px, badges 4px
   - drop card shadows
   - remove `stamp`, `ring` and the topbar `.chip`
2. **Separate brand amber from warning (0.5 day):** samples, demo and offline mode move to `--info`. `--accent` is kept for the logo, focus ring and link underline only. At most one tinted callout per screen.
3. **Restructure the case page into main column and rail (1 day):** a 1280px grid with the case record, challenge and privacy in a sticky rail. The input panel collapses to one row once a dossier is loaded.
4. **Verdict band and stat row (1 day):** count-based headline, one badge, five stats with hint tooltips, and a mono meta line. The five note lines are merged into one callout slot.
5. **Identifier, amount and badge components, with hover linking (1 day):** mempool truncation, Safe head/tail bolding, Blockscout badges with a compact mode, tabular amounts, and Otterscan-style `data-key` selection across the table, the flow and the funders.
6. **Claims table redesign (0.5 day):** kind tags, transaction, notes and amount columns, expandable details, and one full badge per claim.
7. **Funds flow (1.5 days):** per-step transfer rows with CipherScan's one-line hero flow (keeps `.step`, `.edge` and `.badge`), then the mempool-geometry Sankey overview in `case/flow-svg.js`.
8. **Challenge log in the rail (0.5 day):** a Safe audit-log grid for nonce, H₀, control and deposit, replacing the prose lines (the ids stay as live regions).
9. **Landing rewrite (1 day):** split hero with a live HTML snapshot of the sample case, a four-step protocol sequence, a claim-kinds table and an established/not-established table. Copy per §4.6.
10. **Build page (1 day):** numbered sections, the "What leaves this page" ledger rail, an NU7 one-line banner, a trust-boundary gate on "Copy a review link", and a claims-table preview.
11. **Copy pass (0.5 day, alongside):** move explanations into hints and the glossary, and finish centralizing strings in `case/view.js` and `build/view.js`.
12. **Print layout (0.5 day):** A4 report with a header block, full identifiers, monochrome-safe SVG and a signature line.
13. **Palette and CSS layers (0.5 day):** sand neutrals in both `apps/console/app/globals.css` and the page tokens, then split into `r/tokens.css`, `base.css` and `components.css` with `@layer`, and point `check_design_tokens.py` at `r/tokens.css`. This can be done first if the maintainer prefers to restyle on the new tokens.
14. **Dark-mode and mobile check (0.5 day):** re-shoot with `raw/fe-refs/shoot.mjs zeceipt` and run the axe pass (`@axe-core/playwright` is already a dev dependency).
