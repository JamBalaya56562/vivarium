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
docs/site/_data/projects.json           ← add a row keyed by <project> (only if new)
```

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
`generate-validators` → `generate-index` → `generate-project-pages`
→ `generate-site-stats`. Outputs:

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

- **Pyodide version drift.** Pyodide currently bundles Python 3.13
  / sqlite 3.39.0. A bug fixed in Python 3.14+ that does not exist
  in 3.13 will show `verdict=unreproduced` here even though
  upstream considers it valid. Layer 2 (`python:3.14-slim`) is
  the right home for those.
- **WASM memory cap.** Browsers cap WASM at ~4 GB. Bugs that need
  GB-scale data → Layer 2.
- **System calls.** Pyodide ships an MEMFS-like virtual FS, not
  the real one. Anything depending on real filesystem semantics,
  fork/exec, sockets, or signals → Layer 2.

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

- **Pinning.** Pin the Docker base image to a major tag at minimum
  (`node:26-slim`, not `node:latest`). The image digest is
  captured in the CI-generated `verdict.json` for full
  determinism.
- **Verdict polarity.** Exit 0 means *the bug reproduces*
  (positive identification of the surprise). This is the Contract
  v1 convention — different from typical CI green/red framing.
  Easy to invert by accident.

---

## Layer 3 (rr / record-replay) specifics

**Hard preconditions** — Layer 3 recipe authoring requires a
maintainer host with:

- Linux/x86_64 (rr does not support arm64, Windows, or macOS).
- A CPU with an exposed PMU (Intel/AMD bare metal, or VMs that
  pass through performance counters — Hyper-V / WSL2 / GHA hosted
  Ubuntu **do not** qualify).
- CPUID faulting enabled in the kernel (Intel Ivy Bridge+ or
  modern AMD with stock recent Linux meets this).

CI cannot record OR replay (both capabilities are missing on GHA's
Hyper-V runners — confirmed empirically Phase 4 Stage A,
2026-04-27). The maintainer records locally, ships the trace as a
GitHub Release asset, and commits a tracked `verdict.json`. **If
your environment does not meet these preconditions, stop and hand
the recipe back to a maintainer.**

**Required files**:

```text
src/layer3_thirdway/<slug>/
├── Dockerfile        ← installs rr, builds reproducer, ADD trace.url
├── record.sh         ← documents how the trace was captured (not run by CI)
├── replay.sh         ← visitor-facing rr replay; verdict semantics
├── trace.url         ← pinned URL of the GitHub Release asset
├── README.md         ← upstream issue + docker run + verdict contract
├── verdict.json      ← TRACKED here (unique to Layer 3) — captured locally
└── out/              ← gitignored scratch for record.sh's local outputs
```

`verdict.json` being **tracked** is the key Layer 3 deviation from
Layer 2. CI does not regenerate it.

**Authoring workflow** (maintainer host):

1. Write the reproducer + `record.sh` + `replay.sh`.
2. Run `record.sh` locally → produces `out/<name>.tar.zst`.
3. Upload the trace as a Release asset under
   `aletheia-works/vivarium`, tag-pinned (`trace-<slug>-v1`). Pin
   the URL in `trace.url`.
4. Build the image locally (the Dockerfile pulls the trace via
   `ADD`).
5. Replay locally to capture stdout, hand-craft `verdict.json`
   per Contract v1, validate it against
   `docs/site/public/spec/verdict.schema.json` with `ajv-cli`.

**Commit scope**: `feat(layer3)` — established by PR 106.

**Pitfalls**:

- **rr capability gaps on CI.** Do not try to "make CI replay
  work". It will not. The maintainer-captured `verdict.json` is
  the verdict CI surfaces.
- **Container caps.** Visitor-facing `docker run` needs
  `--cap-add=SYS_PTRACE --cap-add=PERFMON --security-opt
  seccomp=unconfined`. Document this in the recipe README.
- **Trace asset versioning.** Re-recording requires bumping the
  Release asset tag (`trace-<slug>-v2` etc.) and updating
  `trace.url`. Mutating an existing tagged asset breaks
  reproducibility for visitors who already pulled the image.

---

## Cross-cutting pitfalls (all layers)

- **`bunx` vs `bun x`.** Never write `bunx <pkg>` in scripts;
  Windows local has no `bunx.cmd`. Always `bun x <pkg>`
  (subcommand form).
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
(e.g. a generator name changed, a Pyodide version bumped,
ADR-0011's reasoning becomes invalid), update this rule file in
the same PR rather than working around it. The checklist is
load-bearing for the next agent.
