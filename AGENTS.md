# AGENTS.md

> Standing instructions for any AI coding agent working in this repository.
> Follows the emerging [agents.md](https://agents.md) convention.
> Claude Code users: see also [`CLAUDE.md`](CLAUDE.md) for Claude-specific additions.

---

## 1. What this project is

**Vivarium** is the universal bug-reproduction platform of the
[`aletheia-works`](https://github.com/aletheia-works) organisation.

- **Problem-centred, not technology-centred.** The goal is "reproduce any bug,
  in any language, any environment, at any scale." WASM, Docker, microVM, and
  record-replay are *candidate means*, never the product.
- **Lifelong project.** Phases are measured in years, not sprints. Prefer
  durable decisions over quick wins.
- **AI-delegated development.** Humans set direction and merge; AI agents
  implement, review, and iterate.
- **Current phase: Phase 6 — Usability and visual layer.** Phases 0–5
  are closed (see [`docs/docs/roadmap.md`](docs/docs/roadmap.md) for
  what shipped). Phase 6 builds the interaction layer above the
  existing primitives: visual redesign, reproduction comparison,
  search, manifest authoring UX, MCP server, and i18n. Closure rule
  is V + R + at least one of S/M/X/L per ADR-0017 (private memo).

Deeper strategy context is in `_context/` (local-only, gitignored). Treat those
documents as canonical when they conflict with anything here.

## 2. Non-negotiable guardrails

AI agents **must not** take any of these actions — always hand off to the human:

- Creating accounts, entering credentials, or handling payments.
- Approving or merging pull requests on the human's behalf.
- Destructive operations on shared state: `tofu destroy`, production database
  writes, force-push to `main` once the first PR has been merged, deleting
  released tags, rewriting pushed history on a repo with collaborators.
- Rotating, exporting, or committing secrets. If a secret is needed at
  runtime, reference it via GitHub Actions secrets or environment variables;
  never inline.
- External contracts, legal judgements, or community-facing human dialogue
  (issue replies to real users, social posts, etc.).
- **Strategic pivots.** Scope, vision, phase ordering, and technology-stack
  choices at the architecture layer are human decisions. Implementation
  choices inside an agreed scope are fair game.

If unsure whether an action crosses the line, stop and ask.

## 3. Core working principles

1. **Problem first, technology second.** Before proposing WASM vs Docker vs
   anything else, state the reproduction problem being solved.
2. **Modern defaults, no legacy fallbacks.** Lead with fine-grained PATs,
   OIDC, OpenTofu (not Terraform), Sapling (not Git), Conventional Commits,
   etc. Do not add backwards-compatibility shims for tooling the user has
   already moved off.
3. **Mechanical over judgement.** Labels, versions, and routing come from
   path rules, Conventional-Commit parsing, or CI — never from ad-hoc AI or
   human judgement. If a signal cannot be derived mechanically, leave it
   unset rather than guessing.
4. **Small diffs, tight scope.** A bug fix does not bundle refactors. A
   one-shot script does not grow a plugin system. Three similar lines beat a
   premature abstraction.
5. **No invented future-proofing.** Do not add flags, hooks, or abstractions
   for requirements that are not yet on the roadmap.
6. **Verify before asserting.** When citing a file path, function, or flag,
   confirm it exists in the current tree. Memory and training data both go
   stale.
7. **Respect `status: blocked`.** Issues carrying the `status: blocked`
   label are off-limits for agent pick-up — something outside this repo
   gates them. Conversely, if you pick up an Issue in good faith and hit a
   blocker you cannot resolve within scope (upstream bug, unshipped
   dependency, required human action, missing credential, etc.), apply
   `status: blocked` with a comment summarising the blocker and the signal
   to watch for, then stop rather than inventing a partial implementation.

## 4. Repository conventions

### 4.1 Layout

```text
vivarium/
├── AGENTS.md              # this file — standing AI instructions
├── CLAUDE.md              # Claude Code-specific addenda
├── README.md              # public project overview
├── LICENSE                # Apache-2.0
├── mise.toml              # mise-en-place tool versions (bun, opentofu, etc.)
├── .github/
│   ├── workflows/         # CI/CD — thin callers into aletheia-works/.github reusables
│   ├── dependabot.yml
│   ├── labeler.yml        # path-based label rules (mechanical)
│   └── release.yml
├── infra/
│   └── github/            # GitHub Settings-as-Code via OpenTofu (labels, milestones, branch protection)
├── docs/                  # rspress docs site
│   ├── package.json       # rspress + bun deps
│   ├── rspress.config.ts
│   ├── tsconfig.json
│   ├── bun.lock
│   ├── scripts/           # build-time scripts (e.g. recipes-index generator)
│   ├── public/
│   │   ├── api/           # machine-readable endpoints — recipes.json, recipes.schema.json
│   │   └── spec/          # JSON Schemas — verdict.schema.json, manifest.schema.json
│   └── docs/              # tracked markdown content (vision, architecture, spec, roadmap, …)
├── packages/
│   └── mcp-server/        # @aletheia-works/vivarium-mcp (JSR + npm dual publish)
├── src/
│   ├── layer1_wasm/       # Layer 1 reproductions (Pyodide, Ruby.wasm, php-wasm, Rust wasm32-wasip1)
│   ├── layer2_docker/     # Layer 2 reproductions (Docker images, GHCR-published)
│   ├── layer3_thirdway/   # Layer 3 reproductions (record-replay, etc.)
│   └── external_examples/ # reference Manifest v1 fixtures, one per layer
└── _context/              # gitignored: private strategy memos, handoffs, ADRs, drafts
```

`src/` is reserved for reproduction recipes; runtime artefacts the
project publishes (npm / JSR packages, future CLI, etc.) live under
`packages/`.

### 4.2 `docs/` vs `_context/`

- `docs/` — tracked. The rspress documentation site lives here; its
  configuration (`package.json`, `rspress.config.ts`, `tsconfig.json`,
  `bun.lock`) sits at the top of `docs/`, and the markdown content
  itself lives one level deeper under `docs/docs/`. Every file under
  `docs/docs/` is something the project would be comfortable showing
  an outside contributor (vision, architecture, roadmap, guide, spec).
- `_context/` — gitignored. Private strategy memos, chat handoffs,
  half-formed drafts, and the project's Architecture Decision Records
  (`_context/decisions/`). AI agents may *read* these freely for
  context and *write* new notes here during exploration, but must
  never propose moving content from `_context/` into `docs/` without
  explicit human sign-off.

### 4.3 Source-control

- SCM is **Sapling (`sl`)**, not Git. Use `sl status`, `sl diff`, `sl commit`,
  `sl log`. Do not look for `.git/`; the repository metadata lives in `.sl/`.
- GitHub is the hosting remote; workflows and branch protection still apply
  normally.

### 4.4 Commits

- **Conventional Commits always.** Form: `type(scope)?: subject`, optionally
  with body and footer. Applies to the very first commit (`chore: initial
  bootstrap of vivarium`) and every squash commit thereafter.
- Enforced by the reusable workflow at
  `aletheia-works/.github/.github/workflows/commitlint.yml`, which this repo
  calls from `.github/workflows/commitlint.yml`. The config is the unmodified
  `@commitlint/config-conventional`.
- **Subject case is the most common AI trip-wire.** The subject (the part
  after `type(scope):`) must **start with a lowercase letter** —
  `@commitlint/config-conventional` rejects sentence-case, start-case,
  pascal-case, and upper-case via `subject-case`. So:
  - ❌ `feat(ci): Phase 4 Stage A — rr replay PoC scaffold` (sentence-case)
  - ✅ `feat(ci): phase 4 Stage A — rr replay PoC scaffold` (lowercase first
    char; mixed case later in the line is fine — proper nouns and acronyms
    only matter for the leading character)
- Other rules worth remembering: subject must not end with `.`, header must
  be ≤100 characters, `type` and `scope` must both be lowercase, the body
  (if present) must be separated from the subject by a blank line, and
  `type` must be one of the standard Conventional Commits set
  (`feat`/`fix`/`docs`/`style`/`refactor`/`perf`/`test`/`build`/`ci`/`chore`/`revert`).

### 4.5 Early-stage commit policy

> **Historical — kept for context.** Phase 6 is well past this gate;
> the first PR landed during Phase 0, and per-commit granularity has
> applied since then. Force-push to `main` is now strictly off-limits
> per §2. The text below is preserved so future bootstrap repos in
> the org can copy the policy.

Until the first PR has been merged, treat this repo as being in bootstrap
shape:

- Fold follow-up changes into the existing **initial commit** rather than
  stacking new commits.
- `sl amend` and `sl fold --from <initial-rev>` are the preferred mechanisms.
- Force-push to `main` is acceptable at this stage (no collaborators yet);
  state once per session that a history rewrite is happening.
- If Sapling's public-commit lockout blocks `amend`/`fold`, the nuclear-reset
  recipe (`rm -rf .sl/` → `sl init --git .` → re-commit → force-push) is
  accepted as a last resort. Working-copy file contents are preserved.

The transition signal is **the first PR opened on this repo**. After that,
normal per-commit granularity applies and force-push to `main` is off-limits.

### 4.6 Labels

- All labels use the `prefix: value` form with a space after the colon:
  `type: bug`, `scope: ci`, `priority: p0`, `status: triage`, `ai: generated`.
  Non-prefixed labels (`good-first-issue`, `help-wanted`, `discussion`) keep
  hyphenated single-word form.
- Label definitions live in [`infra/github/labels.tf`](infra/github/labels.tf).
  New labels are added by editing that file (and the matching path rule
  in [`.github/labeler.yml`](.github/labeler.yml) when `scope: *` is
  involved), never via the GitHub UI — the IaC apply propagates the
  change. Milestones follow the same pattern via
  [`infra/github/milestones.tf`](infra/github/milestones.tf).
- **Issue Type field is required.** Every Issue must carry a GitHub
  Issue Type (Bug / Feature / Task) set explicitly via the GraphQL
  `updateIssueIssueType` mutation. The `type: *` label alone is
  insufficient — Projects v2 swimlanes and queries dispatch on the
  Issue Type field, not on the label. AI agents may need a PAT with
  Issue Types: read+write to set this; if scope is missing, leave the
  Issue created and ask the human to set the field.
- **Mechanical labelling only.** `scope: *` comes from
  [`.github/labeler.yml`](.github/labeler.yml) path rules; `type: *` comes
  from the Conventional-Commit prefix of the PR; `priority: *` and
  `status: *` are set by CI or humans, never by AI guess.

### 4.7 AI authorship disclosure

Every PR opened or substantively edited by an AI agent **must** carry the
`ai: generated` label by the time the PR moves out of draft. The label is
a self-tag — the agent applies it; humans do not need to add it. CI also
applies it on `/claude`-triggered PRs via
[`.github/workflows/claude-implement.yml`](.github/workflows/claude-implement.yml),
but PRs opened through any other path (Sapling-direct submissions, web UI,
etc.) must still set the label explicitly. One-liner from the agent's
shell:

```bash
gh pr edit <num> --repo aletheia-works/vivarium --add-label "ai: generated"
```

The label is a disclosure mechanism. It exists so reviewers and
downstream readers can see at a glance which changes are AI-authored;
missing it on an AI-authored PR is a defect, not a stylistic choice. If
a historical PR is found without it (whether merged or open),
backfilling is a legitimate housekeeping task.

### 4.8 Organisation-level reusable workflows

Shared CI logic (commitlint, release notes, etc.) lives in
`aletheia-works/.github` as `workflow_call` reusables. Consuming repos —
including this one — host only thin caller workflows plus any
`workflow_run` listeners. If a workflow here starts duplicating logic that
would belong in the org, flag it for promotion rather than copying.

### 4.9 GitHub Actions: latest versions, pinned by SHA

Two coupled rules.

**(a) Latest at authoring time.** When adding a new GitHub Actions
workflow or editing an existing one, use the latest published version
of every action and runtime referenced. This applies to:

- Marketplace actions — the most recent published release at the
  time of authoring (e.g. `actions/checkout` v6.0.2,
  `oven-sh/setup-bun` v2.2.0). Do not copy older pins from a sibling
  workflow that is itself out of date.
- Runtime versions — Node.js, Deno, Bun, Python, Go, etc.: the
  current stable release.
- Reusable-workflow refs — call the `aletheia-works/.github`
  reusables at the latest commit on their tracked branch (usually
  `main`).

Do **not** ship a workflow that is already known to be one Dependabot
run behind. Dependabot opens its bumps daily; a stale-on-arrival
workflow just creates an immediate follow-up PR for no benefit.
Catching the version at authoring time costs one CI roundtrip;
catching it via Dependabot costs an extra review cycle and an extra
merge — strictly more expensive.

**(b) Pin by full commit SHA, not by tag or branch.** Marketplace tags
are mutable — `actions/checkout@v6` points at whatever commit the
action's maintainer last decided should be `v6`. The
[GitHub security-hardening guide](https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions#using-third-party-actions)
states explicitly that *"pinning an action to a full length commit
SHA is currently the only way to use an action as an immutable
release."* Always pin to the full 40-char commit SHA, with the
human-readable version (for marketplace actions) or branch name (for
reusable workflows) as a trailing comment for review:

```yaml
# Marketplace action — tag literal in trailing comment
uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2

# Reusable workflow on main — branch name in trailing comment
uses: aletheia-works/.github/.github/workflows/commitlint.yml@2869d127c99b5cd8bcfb22d7ade8a31d1204019c # main
```

The trailing `# vX.Y.Z` or `# main` comment is mandatory — the SHA
alone is unreviewable. Dependabot's `github-actions` ecosystem
rebumps the SHA on every release the same way it bumps tags, so SHA
pinning does not freeze updates; it just makes each update a
deliberate, reviewable change.

To resolve the latest SHA for a tag or branch from the shell:

```bash
gh api repos/<owner>/<repo>/commits/<tag-or-branch> --jq '.sha'
```

**Exception clause.** If a newer major bumps an action's interface
and the migration is non-trivial, pin the older major's latest SHA
**with a one-line comment** (`# pinned at v3 until <link to issue>`)
so the next maintainer sees the deliberate choice rather than
guessing it is an oversight.

### 4.10 Toolchain (mise-managed)

Local development tool versions are pinned in
[`mise.toml`](mise.toml) at the repo root. After cloning, run
`mise install` to materialise everything declared there. Currently
pinned: `bun` (the primary JS runtime — docs site and
`packages/mcp-server`), `opentofu` (infrastructure-as-code), `uv`
(Layer 1 native re-verification, Phase 5 manifest validation
toolchain), the Layer 1 native interpreters (`php`, `ruby`, plus
`rust` for `wasm32-wasip1` artefacts), and the polyglot Rust-based
formatter / linter toolchain (`mago` for PHP, `ruff` for Python,
`tombi` for TOML, `rumdl` for Markdown).

CI does **not** use mise for runtime versions (Bun, Node, Python,
Rust, etc.) — workflow steps spell out `oven-sh/setup-bun@…`,
`actions/setup-node@…`, etc. directly so each runtime is auditable
from the workflow YAML alone. Versions in `mise.toml` and CI
workflows should converge but are independently maintained: a CI
bump and a `mise.toml` bump can land in separate PRs.

**Documented exception — `test-lint-check.yml` and
`lint-autofix.yml`.** The polyglot Rust-based lint toolchain (Mago,
Ruff, Tombi, rumdl, plus the Rust toolchain for cargo fmt + clippy)
is installed in CI via `jdx/mise-action`, not by spelling out 5
per-tool actions. Justification: each tool would otherwise need an
independent third-party-action allowlist registration at the org
level; `jdx/mise-action` collapses that to one. Tool versions stay
auditable because `mise.toml` is in the repo and pins them
explicitly. The rule above still applies to runtimes.

When adding a new tool to the project, pin it in `mise.toml` first;
that establishes a single source of truth before any script or
README mentions the tool by name.

### 4.11 Spec evolution policy

Public specs (Contract v1, Manifest v1, Recipes index v1, future
spec pages) follow a two-tier evolution policy, codified by ADR-0018:

| Change shape | Verdict |
|---|---|
| New **optional** field that v1 consumers can ignore | Same-page **revision** — append to the spec page's revision-history footer with date and ADR reference; the version literal stays at `"v1"`. |
| Rename, remove, type change, semantics change, optional → required | **vN+1** — new spec page (`contract-v2.md`), new JSON Schema sibling (`verdict-v2.schema.json`), new ADR. Old spec page stays readable so consumers can dispatch on the version literal. |

Every spec page carries its version literal in the file the consumers
read (`<meta name="vivarium-contract">` for Contract v1,
`manifest = "v1"` for Manifest v1, `index = "v1"` for the recipes
index). Revisions never touch that literal; consumers feature-detect
new optional surface.

**Pre-adoption breaking-change carve-out (active as of 2026-05-05).**
The two-tier policy above presumes the spec already has external
consumers who would be harmed by a silent breaking change. As long as
this project has **no known external consumers** — a state explicitly
acknowledged through Phase 6 — breaking changes that would otherwise
require a major bump (`v2`) may instead be **absorbed in-place inside
v1**, provided that:

- The change is recorded in an ADR under `_context/decisions/` with
  the rationale and the in-v1 absorption decision.
- Every site within this repository (schemas, helpers, recipes, CSS,
  CI, tests, docs in both `ja` and `en`) is migrated atomically in
  the same change set; the spec is not allowed to be self-inconsistent.
- The Contract v1 / Manifest v1 spec page's revision history records
  the change with date and ADR reference, even though the version
  literal stays `"v1"`.

The carve-out **expires automatically** when any of the following
holds:

- A third party documents a Vivarium reproduction or imports the MCP
  server in a tracked downstream project, or
- Vivarium begins formally announcing the spec for outside consumption
  (blog post, conference talk, listing in a curated index, etc.), or
- Phase 7 opens (whichever comes first as project momentum picks up).

After expiry, breaking changes revert to the strict two-tier policy
(`v2` major bump). Until expiry, AI agents may exercise the carve-out
themselves only with explicit human authorisation captured in the
chat for that specific change — it is not standing approval. ADR-0029
(verdict vocabulary rename) is the first invocation.

### 4.12 Package distribution

Runtime artefacts the project publishes (Vivarium MCP server today,
future CLI / SDK tomorrow) follow ADR-0019's distribution pattern:

- **JSR canonical + npm fallback (dual publish).** Both registries
  carry the same package; JSR is the canonical source for supply-chain
  defences (no postinstall scripts in the spec, OIDC-only publish via
  Sigstore provenance, scope ↔ GitHub-org binding, source-only
  publish), npm carries `npx` ergonomics that AI agent clients
  expect. Same name, same version on both registries.
- **OIDC trusted publishing + Sigstore provenance** on both registries
  — no long-lived registry tokens stored as repo secrets.
- **Tag form**: `<package-name>-v<semver>` (e.g. `mcp-server-v0.1.0`),
  matching `semantic-release-monorepo`'s default for monorepo single-
  package tags. Each `packages/<name>/` directory has its own
  prefixed tags; the repo never carries an unprefixed `v…` tag once
  a second package is added.

### 4.13 Architecture decision records

Strategic and load-bearing decisions land as ADRs in
`_context/decisions/NNNN-<short-slug>.md`, using
`_context/decisions/_template.md` as the starting structure. Numbering
is sequential and never re-used; superseded ADRs keep their original
number with a `Status: Superseded by ADR-NNNN` note rather than being
deleted. ADRs are gitignored — they are private working memos, not
public docs. Reasoning that should be visitor-facing belongs in
`docs/docs/` (vision, architecture, roadmap, guide, spec).

Write an ADR when:

- The decision has meaningful alternatives a reasonable person could
  prefer.
- The decision affects multiple areas of the project (architecture,
  infrastructure, workflow).
- The decision is hard to reverse — changing it later costs more
  than a normal refactor.
- The decision is load-bearing on other decisions.

A trivial style choice or a day-to-day implementation pick does not
warrant an ADR; AGENTS.md or tooling configuration is the right home
for those.

### 4.14 Pre-PR local validation

**Run the matching CI checks locally before pushing a PR branch.**

Every PR triggers a set of CI workflows based on its file changes
(see each workflow's `paths:` filter under `.github/workflows/`).
Before opening or force-pushing to the PR branch, run the equivalent
steps locally for every triggered workflow.

The `mise run ci:*` tasks in [`mise.toml`](mise.toml) are the
canonical local entry points and mirror the workflows job-for-job:

- `mise run ci:docs` — `test-docs-build.yml`
- `mise run ci:repro` — `repro-regression.yml` (typecheck + build +
  Playwright; needs Linux for the Playwright browser fixture)
- `mise run ci:lint` — `test-lint-check.yml` (Mago + Ruff + Tombi +
  rumdl + cargo fmt + clippy across the whole repo)
- `mise run ci:commitlint` — commitlint on the latest commit
- `mise run ci:all` — the union of the above (excluding `ci:lint`,
  which has its own runner)

For one-off autofix passes during development, the matching
`*:check:fix` tasks (`mise run lint:all:fix`, or any per-language
variant like `mise run python:check:fix`) apply every safe fix in
place; CI's `lint-autofix.yml` runs the same set on each PR and
commits any residual fixes back to the branch.

If a `ci:*` task is missing for the workflow you triggered, transcribe
its `run:` steps from the YAML and execute them by hand — do **not**
skip the check. The cost of a PR that fails on something a local run
would have caught is multiple round-trips of red CI eating reviewer
attention; the cost of running the suite once locally is minutes.

**When CI catches something the local run missed** (an OS-specific
shell behaviour, a path-resolution edge case, a tool only setup-bun's
PATH wiring exposed, etc.), treat it as a gap in the local-validation
toolchain: extend the matching `ci:*` task — or add a new one — so
the next contributor catches it locally too. CI and local should
converge on the same surface, in both directions.

## 5. Three-layer architecture (reference)

Product-level technology choices are framed by these three layers. Do not
conflate "which layer does this problem fit" with "which library do we use."

- **Layer 1 — WASM (browser-native, instant).** Pyodide, sqlite-wasm, Rust
  `wasm32-wasi`, Ruby.wasm, PHP.wasm. Target: algorithms, data processing,
  parsers, in-memory DB operations. Startup: ms–s.
- **Layer 2 — Docker (full fidelity).** Devcontainer images, Firecracker
  exploration. Target: arbitrary projects, complex dependencies, network
  behaviour. Startup: s–min.
- **Layer 3 — Third way.** microVM (Firecracker, Kata), record-replay (rr,
  Pernosco-style), deterministic simulation (Antithesis-style), WASI Preview
  3+, snapshot-based (CRIU). Target: problems Layers 1 and 2 cannot reach.

Phase 0 focuses on Layer 1 with Python + SQLite as the first concrete
reproduction domain. Layer 2 and 3 are expected but not scheduled.

## 6. When in doubt

1. Re-read `_context/ambitious_integrated_platform_strategy.md` — the
   project's north star.
2. Re-read `_context/handoff_briefing_for_claude_code.md` — the operational
   briefing.
3. If still unclear, stop and ask the human. Deferring is cheaper than
   unwinding a wrong decision on a lifelong project.
