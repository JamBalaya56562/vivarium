---
description: Operational checklist for AI agents adding a new reproduction recipe to vivarium (Layer 1 / 2 / 3).
paths:
  - "src/layer1_wasm/**"
  - "src/layer2_docker/**"
  - "src/layer3_thirdway/**"
  - "docs/site/_data/projects.json"
  - "docs/scripts/generate-recipes-index.ts"
  - "docs/scripts/generate-project-pages.ts"
  - "docs/scripts/new-recipe.ts"
---

# Recipe authoring — operational checklist

> Path-scoped rule: this file auto-loads when Claude Code edits any
> recipe directory under `src/layer*_*/` or the recipe-related data
> files under `docs/`. It is NOT loaded for unrelated work, keeping
> the base CLAUDE.md / AGENTS.md context lean per Claude Code's
> "write effective instructions" guidance
> (<https://code.claude.com/docs/en/memory.md>).
>
> Read the layer's `src/layer*_*/README.md` first for the catalogue
> model and visitor-facing conventions; this rule fills the
> agent-side gaps (slug parser quirks, data-file plumbing, local
> validation, commit conventions, common pitfalls).

---

## Conventions shared across layers

### Slug rules

Recipe directory name = slug. Parsed by
[`docs/scripts/generate-recipes-index.ts`](../../docs/scripts/generate-recipes-index.ts)
(`parseSlug` function) using regex
`^([a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)*?)-(\d+)$`.

The lazy quantifier means the **first** dash-separated segment that
admits the trailing `-(\d+)$` pattern wins as the project name.

| Slug                          | Parses as                                          |
| ----------------------------- | -------------------------------------------------- |
| `node-63041`                  | project=`node`, issue=63041 ✅                     |
| `cpython-137205`              | project=`cpython`, issue=137205 ✅                 |
| `bash-local-shadows-exit`     | project=`bash`, issue=0 (no trailing digits) ✅    |
| `node-iso8601-month-63041`    | project=`node-iso8601-month`, issue=63041 ❌       |

For numeric upstream issues use exactly `<project>-<issue>`.
Descriptive suffixes belong in the README title, not the slug.

### Data files to update

Per-recipe metadata lives **inside the recipe directory** as
`recipe.json` (schema: [`recipe.schema.json`](../../docs/site/public/spec/recipe.schema.json)).
The only out-of-recipe edit is `projects.json`, and only when the
recipe debuts a new upstream project:

```text
src/layer{1,2,3}_*/<slug>/recipe.json   ← author this file with the recipe
src/layer{1,2}_*/<slug>/i18n.ja.json    ← Japanese for every data-i18n key (Layer 1/2 only)
docs/site/_data/projects.json           ← add a row keyed by <project> (only if new)
```

### Bilingual reproduction pages (Layer 1 / Layer 2)

`index.html` is **generated** and gitignored:
`docs/scripts/generate-repro-pages.ts` renders it from the layer's
`page.template.html` plus the recipe's `page.en.html`. You edit
`page.en.html` — the slots only your recipe knows — and run
`mise run repro:pages`. The generated English page is the input to the
Japanese one: visitor-facing prose nodes carry `data-i18n="<key>"`, the
Japanese lives in `i18n.ja.json` next to it, and `mise run repro:i18n`
splices them into a gitignored `index.ja.html` served at
`/vivarium/ja/repro/<project>/<issue>/`.

Rules:

- **Key sets must match exactly.** A `data-i18n` with no entry, or an
  entry with no `data-i18n`, fails the generator and
  `docs/scripts/__tests__/reproI18n.test.ts`.
- **Never put an attribute-bearing node in a translated string.** Links
  and inline SVG come through numbered slots — `{0}`, `{1}`, … are the
  source element's child elements in document order, inserted verbatim.
  So `<h1>Reproducing <a …>numpy#28287</a></h1>` translates as
  `"{0} を再現する"`, and the href never reaches the translator.
  To translate a link's *label*, put `data-i18n` on the `<a>` itself —
  nested keys are resolved before the parent's slot is filled.
- Allowed inline tags in a value: `<code> <em> <strong> <br> <kbd>
  <abbr> <span>`, all attribute-free. `page.title` must be plain text
  (markup inside `<title>` renders literally).
- Keys are **structural, not content-derived**: `page.title`, `page.h1`,
  `page.lede`, `drawer.body.p1`…, `section.*.h2`, `footer.note`.
- Don't translate technical labels that are the same in both locales
  (the `.kicker`, drawer meta values like `Pyodide v314.0.6`); leave them
  unannotated.
- Register: follow `src/layer1_wasm/_shared/path_a.ts`'s
  `DEFAULT_STRINGS_JA` — plain form (常体), technical terms (verdict,
  fix, runtime, baseline) left in English.
- `recipes.json` gains `page_url_ja` **only** for recipes that ship
  `i18n.ja.json`. Its absence is the signal that no Japanese page
  exists, so never derive that URL by inserting `/ja/`.
- **The Japanese page is executed by the regression suite**, not just
  key-checked. `tests/repro-ja.spec.ts` opens every `page_url_ja` and
  asserts the verdict settles, the fix pane settles, and that nothing
  under `/repro/` 404s. It is served by `docs/scripts/serve-repro.ts`,
  which reproduces the deployed shape: the `/ja/` tree holds the page
  and nothing else, so every asset has to resolve through the page's
  `<base>` back into the English directory. A broken `<base>` shows up
  as a 404, which is how a wheel that resolved into `/ja/` went
  unnoticed until it was looked for.
- The suite therefore needs `mise run repro:i18n` to have run —
  `index.ja.html` is gitignored and is not built by `repro:build`.
  `ci:repro` and `repro-regression.yml` both run it, after
  `repro:build` so the Shiki inlining is already in place.

`recipe.json` is the single source of truth for the gallery facets
(`language` / `symptom` / `severity` / `tags`) and the regression
suite's expectations (`expected_verdict` / `expected_runtime`).
[`generate-recipes-index.ts`](../../docs/scripts/generate-recipes-index.ts)
reads it directly; there is no overlay layer to register the recipe in.

Before **deleting** a recipe, also check the landing-page hero for a
pinned reference:

```bash
grep -F "<slug>" docs/site/_components/VivariumHero.tsx
```

If the slug appears, it is intentionally pinned to the hero and is
paired with hand-written copy (`title` / `lede` / `verdictText` /
`pulling` / `ready` / `okLine`) that the recipe metadata cannot
supply. Pick a same-layer replacement and rewrite the matching
`STRINGS` block in **both** `en` and `ja` before the deletion lands.
Visitor-facing MDX references go through the data-driven
[`LiveExamples`](../../docs/site/_components/LiveExamples.tsx)
component and self-heal — only the hero needs manual handover.

Then regenerate every derived artefact in one shot:

```bash
mise run recipes:index
```

This task runs `bun run generate` inside `docs/`, which chains
`generate-repro-chrome` → `generate-validators` → `generate-index` →
`generate-repro-i18n` → `generate-project-pages` → `generate-site-stats`.
Outputs:

- `docs/site/public/api/recipes.json` (**tracked**) — the diff shows
  every recipe addition.
- `docs/site/public/api/projects.json` (**tracked**) — generated from
  the `_data/projects.json` overlay; the diff shows every new project.
- `docs/site/_generated/site-stats.json` (**gitignored**) — site KPI
  counts consumed by the roadmap MDX.
- `docs/site/{en,ja}/repro/<project>/index.mdx` (**gitignored**) —
  auto-generated project landing pages.
- `docs/site/_generated/validators/*.mjs` (**gitignored**) — ajv
  standalone validators built from `docs/site/public/spec/`.
- `src/layer1_wasm/_assets/chrome-data.js` (**tracked**) — the
  reproduction-page nav, generated from `docs/site/{en,ja}/_nav.json`.
  A stale copy fails the unit suite; regenerate and commit it.
- `src/layer{1,2}_*/<slug>/index.ja.html` (**gitignored**) — the
  Japanese page, spliced from `index.html` + `i18n.ja.json`. Note this
  one needs the Shiki inlining from `mise run repro:build` to have
  happened first, which is why it also has its own `mise run repro:i18n`.

Do not fall back to bare `bun run generate-index` (or any single
sub-step): partial runs leave at least one of the four outputs stale,
which the roadmap page or recipe gallery surfaces on local preview.

### Scaffolding (Layer 2 only currently)

```bash
mise run recipes-new -- <project> <issue> "<title>" --base <docker-image>
```

See [`docs/scripts/new-recipe.ts`](../../docs/scripts/new-recipe.ts).
Layer 1 / Layer 3 scaffolders are not yet implemented; copy from
an existing recipe in those layers.

---

## Layer 1 (WASM) specifics

**Required files**:

```text
src/layer1_wasm/<slug>/
├── index.html             ← Vivarium Contract v1 entry point
├── repro.<lang>           ← the actual repro (e.g. repro.py, repro.rb)
├── repro.ts               ← TypeScript driver loaded by index.html
├── README.md              ← bug description + upstream issue link
└── (auto-generated)
    repro.js, repro.js.map, repro.highlighted.html  ← gitignored
```

**Verdict surface** is in-page (no `verdict.json`):

- `<meta name="vivarium-contract" content="v1">` in `<head>`
- `#verdict[data-verdict]` element in the body
- `__VIVARIUM_VERDICT__` / `__VIVARIUM_RESULT__` JS globals

Use the helpers in
[`src/layer1_wasm/_shared/verdict.ts`](../../src/layer1_wasm/_shared/verdict.ts)
so DOM and globals stay in sync.

**Output section — two panes, always**:

Every Layer 1 page shows the buggy behaviour and the corrected
behaviour side by side. There is no single-pane variant; a recipe
with no fix to run still ships both panes and says so in the second
one. Copy the block from
[`dateutil-1478/index.html`](../../src/layer1_wasm/dateutil-1478/index.html):

```html
<section class="vh-main__col vh-main__col--output vh-output-multi">
  <header class="vh-variant-head" data-variant="baseline">
    <h2 class="vh-variant-head__title" data-i18n="section.baseline.h2">Baseline output</h2>
  </header>
  <div class="vh-variant-stage vh-output-section" data-variant="baseline">
    <div class="vh-progress">
      <div class="vh-progress__bar"><div class="vh-progress__fill"></div></div>
      <div class="vh-progress__row">
        <span class="vh-progress__label">Initialising…</span>
        <span class="vh-progress__bytes"></span>
      </div>
    </div>
    <pre id="output" class="vh-variant-output vh-output" data-i18n="output.pending">(pending)</pre>
  </div>

  <header class="vh-variant-head vh-variant-head--secondary" data-variant="fix-candidate">
    <h2 class="vh-variant-head__title" data-i18n="section.fix.h2">Fix-candidate output</h2>
  </header>
  <pre id="output-fix" class="vh-variant-output" data-i18n="output.waitingBaseline">(waiting for baseline)</pre>
</section>
```

- `.vh-variant-stage` around `#output` is **required**.
  [`_assets/chrome.js`](../../src/layer1_wasm/_assets/chrome.js) drives
  `<div class="vh-progress">` inside `#output`'s parent; without the
  wrapper the loading overlay pushes the fix pane down the page.
- All styling lives in
  [`_shared/style.css`](../../src/layer1_wasm/_shared/style.css)
  (`.vh-output-multi`, `.vh-variant-*`). Per-recipe CSS is not needed.
- Three ways to fill the fix pane, in order of preference:
  1. **Fork wheel** — `fix-candidate.json` + the helpers in
     [`_shared/fix-candidate.ts`](../../src/layer1_wasm/_shared/fix-candidate.ts).
     Pure-Python packages only. `dateutil-1478` uses those helpers;
     `lark-1585` fetches and resolves its own manifest inline. Both
     install the resolved wheel into a Pyodide Web Worker.
  2. **A second artefact built from a fixed dependency version** —
     e.g. a second `wasm32-wasip1` binary, or a different runtime build.
  3. **No candidate** — when no fixed build can be executed in the
     browser. Use `data-i18n="output.noFixCandidate"` plus the
     `vh-variant-output--note` class (which wraps prose instead of
     scrolling it), and name the upstream status in the text. **Never
     hand-write an "expected" output**: the pane must only ever show
     something that actually ran.
- The top-level `#verdict` pill mirrors the **baseline only**. A red
  pill driven by the fix pane would flag its desired `unreproduced`
  as a failure.
- The two panes come from the layer template, so no recipe can omit
  them. `scripts/validate-page-slots.ts` requires the `fix-pane` slot
  on **every** recipe at build time and rejects the retired single-pane
  keys (`section.output.h2`, `output.placeholder`) — those slip past
  `reproI18n.test.ts`, which only checks that the two key sets agree
  with each other. If you adopt a new variant mechanism, extend that
  script in the same PR rather than carving the recipe out.
- A **secondary** runtime load — a fix-candidate artefact fetched after
  the baseline verdict has settled — must pass `announceVerdict: false`
  to the `_shared/*_loader.ts` helper. Otherwise it knocks `#verdict`
  back to `pending` on entry, and a 404 on the second artefact flips a
  correct `reproduced` to `unreproduced`, reporting a fix nobody
  observed. See `regex-779/repro.ts`.

**Output shape — the script prints, the page shows what it printed**:

The pane exists so a visitor can read what the script did. It must show
the script's **real stdout**, never a JSON blob the driver assembled out
of values it read back. The shape:

- The script must read as ordinary code in its own language, and must
  not end in a bare expression that exists only for the host to pick
  up — that is what made the first generation of these pages
  unreadable: the visitor could not see why running the script
  produced JSON.
- It `print`s a short human-readable summary: the inputs, the answer
  each one produced, and a marker on the ones that show the bug.
- It leaves the machine-readable values in a named global — `result`
  for a single mapping, `results` for a list of rows, `$result` in Ruby
  where a local would not survive to the next `eval`. The driver reads
  that global for the verdict and the Contract v1 envelope, and puts
  the captured stdout into `#output` unchanged.
- Capture stdout with `setStdout({ batched })` under Pyodide,
  `consolePrinter({ stdout, stderr })` under Ruby.wasm, or
  `ConsoleStdout.lineBuffered` under the WASI shim. Ruby.wasm's
  `DefaultRubyVM` cannot do it — it hardcodes its fds and installs a
  printer that writes to `console.log`, so `_shared/ruby_loader.ts`
  builds the WASI itself and calls `RubyVM.instantiateModule`.
- **Delete the global before every run.** One Pyodide namespace spans
  every run, including the ones a visitor triggers from the Edit box.
  Without `globals.delete`, a script that no longer assigns the global
  is judged on the previous run's values.
- Treat a missing global as `unreproduced` with a message that says so,
  not as a crash. An edited script is the expected way to reach it.
- The native variant (`repro.py` / `repro.rb`) keeps the **same body**
  as the browser script, adding only its header, docstring, `verdict=`
  line on stderr and exit code. Run the repo formatter over the native
  file and mirror what it does back into the driver's string literal —
  otherwise the next autofix pass silently drifts the two apart.

Two recipes cannot take the rule literally, and neither is a licence to
go back to JSON:

- **The reproducing run never finishes.** `lark-1585`'s bug is an
  infinite loop, so the script emits no stdout and the worker is
  terminated. Its driver composes the pane text itself, using one
  layout for all three outcomes so the timeout and the fix-candidate
  panes read as a pair.
- **A WASI command module has no globals to leave behind.** `regex-779`
  prints its table to stdout and one JSON line to stderr; the driver
  shows stdout and parses the first stderr line starting with `{` for
  the envelope. stderr is the machine channel there, the way a named
  global is under Pyodide.

Every other Layer 1 recipe follows the shape above. There is no
remaining recipe to copy the old JSON-pane handling from.

**Local validation**:

```bash
cd src/layer1_wasm && mise exec -- bun install --frozen-lockfile && mise exec -- bun run tsc --noEmit
mise run ci:repro                                  # Playwright on Chromium / Firefox / WebKit
cd .. && mise run docs:check && mise run markdown:check
cd docs && mise exec -- bun run build
```

**Commit scope**: `feat(wasm)` — Layer 1 is WASM; established by
PRs 180 / 189 / 192.

**Pitfalls**:

- **Pyodide version drift.** Pyodide currently bundles Python 3.14
  / sqlite 3.39.0. A bug fixed in Python 3.14+ that does not exist
  in 3.13 will show `verdict=unreproduced` here even though
  upstream considers it valid. Layer 2 (`python:3.14-slim`) is
  the right home for those.
- **WASM memory cap.** Browsers cap WASM at ~4 GB. Bugs that need
  GB-scale data → Layer 2.
- **System calls.** Pyodide ships an MEMFS-like virtual FS, not
  the real one. Anything depending on real filesystem semantics,
  fork/exec, sockets, or signals → Layer 2.
- **Pyodide belongs in a Web Worker.** Booting it and resolving a
  micropip install are pure CPU work; on the main thread they land as
  one task tens of seconds long and Chrome offers to kill the tab.
  `dateutil-1478` measured 19.9 s of main-thread blocking with a
  15.0 s worst task before the runtime moved into a worker, and 353 ms
  after. A worker cannot import `_shared/verdict.ts`, `loader.ts` or
  `runner.ts` — all three reach `_assets/chrome.js`, which touches
  `document` at module-evaluation time — so it loads Pyodide itself and
  posts results back. See `dateutil-1478/repro.worker.ts`.
  `cpython-137205` and `pandas-56679` followed: 18.3–20.1 s and 25.8 s
  of blocking became 259 ms and none. The cost is the runtime, not the
  packages — cpython loads none and still blocked for 18 s. Measure
  before assuming a recipe is light: `numpy-28287` blocks 2.5 s and is
  deliberately left on the main thread.
- **One worker per page, not one per variant.** A second worker is a
  second Pyodide — another download, another WASM compile, another
  micropip. `dateutil-1478` shipped that for one release and the
  fix-candidate pane took 45.5 s to appear; swapping the wheel inside
  the one worker with `micropip.uninstall` + `install` (purging
  `sys.modules` between, or the old module stays imported) brought it
  to 2.8 s. Measure time-to-fix-pane, not just main-thread blocking —
  the first version of that change measured only the latter and shipped
  a regression.
- **A worker cannot use the page's `rel="preload"`.** The preload cache
  belongs to the document, so those tags download the runtime a second
  time and Chrome warns that nothing used them.
  `generate-repro-pages.ts` emits them only for recipes with no
  `repro.worker.ts`; `preconnect` stays for everyone, since warming the
  connection is per-origin.

---

### Page shell — the chrome must ship in the HTML

`chrome.js` fills the shell; it must never create it. Anything it has
to create arrives after first paint and moves the page under the
reader. The layer template therefore ships it once, and
`validate-page-slots.ts` enforces it there:

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&amp;family=Inter:wght@400;500;600&amp;family=JetBrains+Mono:wght@400;500;700&amp;display=swap" />
<link rel="stylesheet" href="../_shared/style.css" />
<script type="module" src="../_assets/chrome.js"></script>
...
<body>
  <header class="vh-topnav"></header>
  <main class="vh-main">…</main>
  <footer class="vh-footer"></footer>
```

The font stylesheet is linked from the page, never `@import`-ed from
`style.css`: an `@import` is a second round trip that blocks first
paint, and the page renders unstyled until it lands. The empty
`vh-topnav` and `vh-footer` reserve their final height from CSS
(`.vh-topnav` is a fixed height, `.vh-footer:empty::before` holds one
line), so filling them shifts nothing.

This block lives in `_shared/page.template.html` (Layer 1) and
`_layer2-shared/page.template.html` (Layer 2). A recipe never repeats
it; a recipe that needs a shape the template cannot express gets a new
template rather than a hand-written page.

---

## Layer 2 (Docker) specifics

**Required files** — four tracked; `verdict.json` is CI-generated
and gitignored:

```text
src/layer2_docker/<slug>/
├── Dockerfile     ← pin the base image; copy repro.sh; set CMD
├── repro.sh       ← exit 0 = reproduced, exit 1 = unreproduced
├── README.md      ← upstream issue link + docker run + verdict contract
└── index.html     ← gallery page; mirror an existing recipe's structure
```

**Do not add `.vivarium/manifest.toml`.** That format is for
[`src/external_examples/`](../../src/external_examples/) (third-party
repos declaring a Vivarium recipe). First-party recipes are
discovered by directory walking, not manifest.

**Local validation**:

```bash
cd src/layer2_docker/<slug>
docker build -t vivarium-<slug>:dev .
docker run --rm vivarium-<slug>:dev    # expect exit 0 + "verdict=reproduced"
cd ../../.. && mise run docs:check && mise run markdown:check
cd docs && mise exec -- bun run build
mise exec -- bun run test:unit
```

**Commit scope**: `feat(layer2)` — established by PRs
92, 93, 94, 98, 194 (the `feat(layer2):` historical thread).

**Pitfalls**:

- **Base images track the latest release.** A Layer 2 recipe
  claims a bug is reachable on current software, so the base moves
  forward rather than staying where it was authored. Name a
  concrete release tag (`node:26-slim`, `alpine:3.24`) and bump it
  — never `:latest`, which would change the image with no commit
  to point at and no verdict re-run. Dependabot's `docker`
  ecosystem opens those bumps; the run that lands them is what
  re-verifies the reproduction. The digest CI built from is
  recorded in the generated `verdict.json`.
- **A bump that flips the verdict is a result, not a breakage.**
  The Playwright suite asserts `expected_verdict`, so a fixed
  upstream shows up as a red check. Decide whether the recipe
  moves to the last reproducing tag or the recipe is retired —
  do not pin backwards to keep CI green without saying why.
- **Verdict polarity.** Exit 0 means *the bug reproduces*
  (positive identification of the surprise). This is the Contract
  v1 convention — different from typical CI green/red framing.
  Easy to invert by accident.

---

## Layer 3 (third way) specifics

**No recipes ship here today, and there is no authoring convention
yet.** The previous one was built around `rr` record-replay and was
removed with it: `rr` is Linux/x86_64 only, needs an exposed PMU and
CPUID faulting, and so could not be verified by a contributor on
Windows or macOS — which breaks Vivarium's requirement that a reader
can reproduce and check a recipe themselves.

Whoever authors the first recipe here defines the shape and updates
both this section and
[`src/layer3_thirdway/README.md`](../../src/layer3_thirdway/README.md)
in the same PR. Apply the same admission test first: if the runtime
cannot be exercised on a reviewer's own machine, it does not belong in
the catalogue.

---

## Cross-cutting pitfalls (all layers)

- **Auto-generated files.** `docs/site/public/api/recipes.json` and
  `docs/site/public/api/projects.json` are tracked but generated.
  Always run the generators before committing; never hand-edit.
- **Recipe selection policy.** Must already match
  [`upstream-issue-selection.md`](upstream-issue-selection.md)
  (Vivarium-internal operating rule, auto-loaded by Claude Code
  for the same paths as this checklist). Selection criteria are
  not re-litigated at PR time.

## When this checklist is wrong

If you discover the checklist diverges from current behaviour
(e.g. a generator name changed, a Pyodide version bumped, a layer
gains or loses a recipe), update this rule file in
the same PR rather than working around it. The checklist is
load-bearing for the next agent.
