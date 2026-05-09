# AGENTS.md — Layer 1 (WASM) recipe authoring

> Operational checklist for AI agents adding a new Layer 1 recipe.
> Read [`README.md`](README.md) first for the runtime menu and the
> in-page verdict contract; this file fills the **agent-side gaps**
> the README does not cover (slug parser quirks, data-file plumbing,
> Playwright validation orchestration).

---

## 1. Slug rules

Same regex as Layer 2 / 3: `^([a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)*?)-(\d+)$`.

For numeric upstream issues use `<project>-<issue>`
(e.g. `pandas-56679`, `cpython-137205`). The slug feeds the URL
path `/repro/<project>/<issue>/` and the gallery card.

See [`src/layer2_docker/AGENTS.md`](../layer2_docker/AGENTS.md) §1
for the parser gotcha around descriptive suffixes — the same trap
applies here.

## 2. Required files

```text
src/layer1_wasm/<slug>/
├── index.html             ← Vivarium Contract v1 entry point
├── repro.<lang>           ← the actual repro (e.g. repro.py, repro.rb)
├── repro.ts               ← TypeScript driver loaded by index.html
├── README.md              ← bug description + upstream issue link
└── (auto-generated)
    repro.js, repro.js.map, repro.highlighted.html  ← gitignored
```

The `.ts` driver is the source of truth; `tsc` emits `.js` /
`.js.map` next to it (gitignored, see top-level `.gitignore`
§"JavaScript / TypeScript"). The Shiki-rendered
`repro.highlighted.html` is also gitignored and produced by
`scripts/highlight-repros.ts`.

**Verdict surface** is in-page (no `verdict.json`):

- `<meta name="vivarium-contract" content="v1">` in `<head>`
- `#verdict[data-verdict]` element in the body
- `__VIVARIUM_VERDICT__` / `__VIVARIUM_RESULT__` JS globals

Use the helpers in [`_shared/verdict.ts`](_shared/verdict.ts) so
DOM and globals stay in sync. The Playwright suite at
[`tests/repro.spec.ts`](tests/repro.spec.ts) asserts conformance.

## 3. Data files to update

Same as Layer 2:

```text
docs/data/recipe-facets.json   ← add a row keyed by <slug>
docs/data/projects.json        ← add a row keyed by <project> (if new)
```

Regenerate indices:

```bash
cd docs && mise exec -- bun run generate-index && mise exec -- bun run generate-project-pages
```

## 4. Local validation (mandatory before PR)

```bash
# 1. TypeScript / unit-level checks for the recipe driver.
cd src/layer1_wasm
mise exec -- bun install --frozen-lockfile
mise exec -- bun run tsc --noEmit          # type-check only

# 2. Playwright suite — drives the recipe in a headless browser
#    and asserts the verdict surface conforms to Contract v1.
mise run ci:repro

# 3. Lint + format on docs side.
cd .. && mise run docs:check && mise run markdown:check

# 4. Full docs build.
cd docs && mise exec -- bun run build
```

`ci:repro` = `repro-regression.yml` local equivalent. It runs
typecheck + Playwright (Chromium + Firefox + WebKit by default).
A push that fails any browser will fail in CI too.

## 5. Commit + PR

- **Commit scope**: `feat(wasm)` — Layer 1 IS WASM. Established
  by PRs #180 / #189 / #192.
- **Commit subject template**:
  `feat(wasm): <slug> reproduction (<one-line bug summary>)`
- For Pyodide-bundled libraries (numpy, pandas, sqlite via
  Python): Pyodide's bundled version pins the recipe's effective
  Python version. The recipe must reproduce against that pinned
  version; recipes targeting a Python version Pyodide does not
  ship belong in Layer 2.

## 6. Common pitfalls

- **Pyodide version drift** — Pyodide currently bundles Python
  3.13 / sqlite 3.39.0. A bug fixed in Python 3.14+ that doesn't
  exist in 3.13 will show `verdict=unreproduced` here even though
  upstream considers it valid. Layer 2 (`python:3.14-slim`) is
  the right home for those.
- **WASM memory cap** — browsers cap WASM at ~4 GB. Bugs that
  need GB-scale data → Layer 2.
- **System calls** — Pyodide ships an MEMFS-like virtual FS, not
  the real one. Anything depending on real filesystem semantics,
  fork/exec, sockets, signals → Layer 2.
- **`bunx` vs `bun x`** — never write `bunx <pkg>`; Windows local
  has no `bunx.cmd`. Always `bun x <pkg>` (subcommand form).

## 7. When this checklist is wrong

If you discover the checklist diverges from current behaviour
(e.g. a generator name changed, a Pyodide version bumped),
update this file in the same PR rather than working around it.
