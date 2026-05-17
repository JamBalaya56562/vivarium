---
description: Vivarium-internal operating rule for picking which upstream issues to reproduce. NOT a public Vivarium policy — visitors using Vivarium as a tool follow their own selection criteria; this file describes how the maintainers decide. Auto-loads when Claude works on the upstream-search MCP tool, the scaffold-recipe-from-issue skill, or any recipe directory.
paths:
  - "packages/mcp-server/src/tools/search_upstream_issues.ts"
  - "packages/mcp-server/src/tools/prepare_new_recipe.ts"
  - ".claude/skills/scaffold-recipe-from-issue/**"
  - "src/layer1_wasm/**"
  - "src/layer2_docker/**"
  - "src/layer3_thirdway/**"
---

# Upstream-issue selection — Vivarium operating preferences

> Path-scoped rule: this file auto-loads when Claude Code works on
> the upstream-search MCP tool, the scaffold-recipe-from-issue
> skill, or any recipe directory under `src/layer*_*/`. It is NOT
> loaded for unrelated work.
>
> **Vivarium-internal operating rule for picking which upstream issues
> to reproduce. NOT a public Vivarium policy**: visitors using
> Vivarium as a tool have their own goals, and this file does not
> constrain them. The MCP server enforces only the slug regex; this
> file describes how the maintainers decide.

---

## Filters (AND)

A candidate upstream issue is in scope only when all six checks
below pass:

### 1. Latest version reproducible

The bug still reproduces against the upstream project's current
release. Old-only reproductions are out of scope — the goal is
"what's hurting upstream right now", not historical bug
preservation.

Carve-out: a reproduction can pin to a specific buggy version
(language / library) when the bug-firing version is what matters,
provided the bug still triggers on that version's latest release.

### 2. No related PR yet

If a PR already exists for the issue (linked via GitHub's
`linked:pr` relation), skip — someone is already working on it.
Overriding in-flight work does not grow the merged-fix count.

`search_upstream_issues` applies this server-side via the
`-linked:pr` query qualifier in strict mode.

### 3. Bug, not feature request

Vivarium's verdict semantics (YES / NO) match bug reproduction.
Feature requests ("this should exist") map poorly to that shape.

### 4. No equivalent in-house tooling on the upstream side

Some ecosystems run automated reproduction bots that cover the
same ground; Vivarium's added value is low there. Pass those repos
to `search_upstream_issues` via the `exclude_repos` argument:

```jsonc
{
  "selection_policy": "strict",
  "exclude_repos": ["oven-sh/bun"]
}
```

This is a **"complementary tooling exists in this ecosystem"**
judgement — not a quality assessment. The MCP server itself ships
no built-in list, and the entry above is an example, not a
maintained registry.

### 5. Layer 2 build budget tractable

Branch-fix verification needs the contributor to build an upstream
fix as a Docker image. If that build cannot finish on a free-tier
CI runner or a developer-class machine (a few GB of RAM, tens of
minutes), Layer 2 is the wrong tier. Options:

- **Layer 1 carve-out**: if the bug reproduces in WASM (Pyodide,
  Ruby.wasm, php-wasm), use Layer 1 instead.
- **PAT-push branch-fix**: for the rare case where Layer 2 is the
  only option and the build is heavy, use the
  `mise run branch-fix:publish` path — the contributor builds
  locally and pushes to GHCR.

Recipe-side images that wrap a pre-built upstream image
(`python:3.13-slim`, `node:26-slim`, etc.) are not affected — only
the branch-fix image build matters here.

### 6. Project is actively maintained

No PRs land = no path to the merged outcome the core loop needs.
Concrete check (calibrate the threshold to your own workflow):

```bash
gh pr list --repo <owner>/<repo> \
  --state merged \
  --search "merged:>=$(date -d '90 days ago' +%Y-%m-%d)" \
  --json number,author \
  --limit 50 \
  | jq '[.[] | select(.author.is_bot == false)] | length'
```

The maintainers running this rule use **≥ 5 human-merged PRs in 90
days** as the threshold, cached 30 days per project. Pick a
number that suits the upstream you target — a niche tool moves
slower than a major runtime, and both can be healthy.

Also scan the README, pinned issues, and discussions for explicit
maintainer signals ("on hiatus", "looking for new maintainer",
"unmaintained"). Those override the count.

If an upstream you already authored a recipe against later goes
dormant: keep the recipe in the catalogue (it still documents a
real bug), but do not add new ones from that project.

---

## Ranking among candidates

Multiple issues passing all six filters → prefer the project with
the **highest activity score** (90-day human merge count). Star
counts and ecosystem popularity are tiebreakers only — popular
projects often have backlogged PR queues, while smaller actively-
maintained projects land contributions faster, which matters more
for the core loop's merge-time KPI.

Tiebreaking on near-equal activity scores:

1. More recent default-branch commit wins.
2. Then ecosystem reach (e.g. wheel / image availability for
   Layer 1 carve-out feasibility).
3. Then maintainer responsiveness signals from recent PR threads
   (review latency, willingness to accept external contributions).

Vivarium-side ergonomics (recipe authoring effort, Layer 1 vs
Layer 2 fit) can override ranking — author the easier recipe first
when the activity scores tie.

---

## What this file is NOT

- **Not a Vivarium contract or guarantee.** Vivarium ships the tool
  (MCP server, skill, CI scaffolding); the policy here is one
  workflow for using it.
- **Not enforced by the MCP server.** `search_upstream_issues` has
  a generic `selection_policy` mode (`strict` adds `-linked:pr` and
  applies caller-supplied `exclude_repos`; `permissive` does
  neither) and ships no built-in skip list or hard-coded
  thresholds.
- **Not a public stance on listed projects.** Any `exclude_repos`
  entry reflects a "complementary tooling exists in this
  ecosystem" judgement, not a quality assessment.
- **Not loaded for visitors.** Vivarium documentation (`docs/site/`)
  intentionally omits this rule. Visitors using Vivarium as a tool
  have their own goals; this file is for the maintainers' workflow
  only.

---

## When this rule is wrong

If a check above diverges from how recipes are actually authored
today (a new exception path, a tooling change, an upstream
changing how it is maintained), update this file in the same PR
that introduces the divergence. Path-scoped rules are load-bearing
for the next agent.
