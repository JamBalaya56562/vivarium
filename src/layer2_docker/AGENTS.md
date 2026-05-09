# AGENTS.md — Layer 2 (Docker) recipe authoring

> Operational checklist for AI agents adding a new Layer 2 recipe.
> Read [`README.md`](README.md) first for the catalogue model and
> verdict semantics; this file fills the **agent-side gaps** the
> README does not cover (slug parser quirks, data-file plumbing,
> local validation orchestration).

---

## 1. Slug rules

Recipe directory name = slug. The slug is parsed by
[`docs/scripts/generate-recipes-index.ts`](../../docs/scripts/generate-recipes-index.ts)
(`parseSlug` function) using the regex
`^([a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)*?)-(\d+)$`.

The lazy quantifier means the **first** dash-separated segment that
admits the trailing `-(\d+)$` pattern wins as the project name.

| Slug | Parses as |
| ---- | --------- |
| `node-63041` | project=`node`, issue=63041 ✅ |
| `cpython-137205` | project=`cpython`, issue=137205 ✅ |
| `bash-local-shadows-exit` | project=`bash`, issue=0 (no trailing digits) ✅ |
| `node-iso8601-month-63041` | project=`node-iso8601-month`, issue=63041 ❌ |

**Rule of thumb:** for a recipe targeting a numeric upstream issue,
use exactly `<project>-<issue>`. Descriptive suffixes belong in the
README title, not the slug.

## 2. Required files

Per [`README.md`](README.md) §"Per-page convention". Four tracked
files; `verdict.json` is CI-generated and gitignored.

```text
src/layer2_docker/<slug>/
├── Dockerfile     ← pin the base image; copy repro.sh; set CMD
├── repro.sh       ← exit 0 = reproduced, exit 1 = unreproduced
├── README.md      ← upstream issue link + docker run + verdict contract
└── index.html     ← gallery page; mirror an existing recipe's structure
```

**Do not add `.vivarium/manifest.toml`.** That format is for
[`src/external_examples/`](../external_examples/) (third-party
repos declaring a Vivarium recipe). First-party recipes are
discovered by directory walking, not manifest.

## 3. Data files to update

Both are hand-curated; both must be edited in the same PR as the
recipe. They drive the gallery facet filters and per-project
landing pages.

```text
docs/data/recipe-facets.json   ← add a row keyed by <slug>
docs/data/projects.json        ← add a row keyed by <project> (only if new)
```

Then regenerate the public/api indices (these ARE tracked, so the
diff shows them):

```bash
cd docs && mise exec -- bun run generate-index && mise exec -- bun run generate-project-pages
```

The generators write `docs/public/api/{recipes,projects}.json` and
the auto-generated `docs/docs/{en,ja}/repro/<project>/index.mdx`
landing pages (the latter are gitignored — regenerated on every
build).

## 4. Local validation (mandatory before PR)

```bash
# 1. Build + run the recipe — verdict must be `reproduced` on the
#    pinned base image when the bug is live upstream.
cd src/layer2_docker/<slug>
docker build -t vivarium-<slug>:dev .
docker run --rm vivarium-<slug>:dev   # expect exit 0 + "verdict=reproduced"

# 2. Lint + format the recipe + data files.
cd ../../.. && mise run docs:check && mise run markdown:check

# 3. Docs build (regenerates indices, runs rspress build).
cd docs && mise exec -- bun run build

# 4. Schema-driven unit tests.
mise exec -- bun run test:unit
```

Skipping any of these means CI surfaces it after push, which burns
the human's review window. See [`AGENTS.md` § 4.14](../../AGENTS.md)
for the convergence-in-both-directions principle.

## 5. Commit + PR

- **Commit scope**: `feat(layer2)` — established by PRs #92 / #93
  / #94 / #98 / #194.
- **Commit subject template**:
  `feat(layer2): <slug> reproduction (<one-line bug summary>)`
- Include in the body: link to upstream issue, latest version
  reproduced against, verdict semantics, what data files were
  touched.
- The recipe selection must already match the policy in
  [`_context/strategy/issue_selection_policy.md`](../../_context/strategy/issue_selection_policy.md)
  if that file exists locally; selection criteria are not
  re-litigated at PR time.

## 6. Common pitfalls

- **Pinning** — pin the Docker base image to a major tag at
  minimum (`node:26-slim`, not `node:latest`). The image digest
  is captured in the CI-generated `verdict.json` for full
  determinism.
- **Verdict polarity** — exit 0 means *the bug reproduces*
  (positive identification of the surprise). This is the
  Contract v1 convention — different from the typical CI
  convention. Easy to invert by accident.
- **`bunx` vs `bun x`** — never write `bunx <pkg>` in scripts;
  Windows local has no `bunx.cmd`. Always `bun x <pkg>`.
- **Auto-generated files** — `docs/public/api/recipes.json` and
  `docs/public/api/projects.json` are tracked but generated.
  Always run the generators before committing; never hand-edit.

## 7. When this checklist is wrong

If you discover the checklist diverges from current behaviour
(e.g. a generator name changed, a new required field), update
this file in the same PR rather than working around it. The
checklist is load-bearing for the next agent.
