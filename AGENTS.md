# AGENTS.md

> Standing instructions for any AI coding agent working in this repository.
> Follows the emerging [agents.md](https://agents.md) convention.
> Claude Code users: see also [`.claude/CLAUDE.md`](.claude/CLAUDE.md) for
> Claude-specific additions; path-scoped operational rules live under
> [`.claude/rules/`](.claude/rules/).

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
- **Current phase: Phase 8.** Phases 0–7 are closed (see
  [`docs/docs/en/roadmap.mdx`](docs/docs/en/roadmap.mdx) and
  `_context/phase_summaries/` for what shipped).

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
7. **Respect `status: blocked`.** Issues with that label are off-limits
   for agent pick-up. If you hit an unresolvable blocker mid-task,
   apply the label with a comment summarising the blocker and the
   signal to watch for, then stop — do not invent a partial
   implementation.

## 4. Repository conventions

### 4.1 Layout

```text
vivarium/
├── AGENTS.md              # this file — standing AI instructions
├── README.md              # public project overview
├── LICENSE                # Apache-2.0
├── mise.toml              # mise-en-place tool versions (bun, opentofu, etc.)
├── .claude/                # Claude Code config (team-shared)
│   ├── CLAUDE.md          # Claude Code-specific addenda; auto-loads `@../AGENTS.md`
│   └── rules/             # path-scoped operational rules (e.g. recipe-authoring.md)
├── .github/
│   ├── workflows/         # CI/CD — mostly thin callers, plus Vivarium-owned reusable workflows
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

- **Conventional Commits always.** Form: `type(scope)?: subject`,
  enforced by the org-level commitlint reusable with the unmodified
  `@commitlint/config-conventional`.
- **Subject must start with a lowercase letter** — most common AI
  trip-wire (`subject-case` rejects sentence-case, start-case,
  pascal-case, upper-case):
  - ❌ `feat(ci): Phase 4 Stage A — rr replay PoC scaffold`
  - ✅ `feat(ci): phase 4 Stage A — rr replay PoC scaffold`
    (lowercase first char only; mixed case later is fine for proper
    nouns and acronyms)
- Other rules: subject ≤100 chars, no trailing `.`, lowercase
  `type`/`scope`, body separated by blank line, `type` from the
  standard set (`feat`/`fix`/`docs`/`style`/`refactor`/`perf`/`test`/`build`/`ci`/`chore`/`revert`).

### 4.5 Labels

- All labels use the `prefix: value` form with a space after the colon:
  `type: bug`, `scope: ci`, `priority: p0`, `status: triage`, `ai: generated`.
  Non-prefixed labels (`good-first-issue`, `help-wanted`, `discussion`) keep
  hyphenated single-word form.
- Label definitions live in [`infra/github/main.tf`](infra/github/main.tf).
  New labels are added by editing that file (and the matching path rule
  in [`.github/labeler.yml`](.github/labeler.yml) when `scope: *` is
  involved), never via the GitHub UI — the IaC apply propagates the
  change. Milestones follow the same pattern, also in `main.tf`.
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

### 4.6 AI authorship disclosure

Every PR opened or substantively edited by an AI agent **must** carry
the `ai: generated` label by the time it leaves draft. The agent
self-applies it; CI auto-applies on `/claude`-triggered PRs but
Sapling-direct / web-UI PRs need an explicit:

```bash
gh pr edit <num> --repo aletheia-works/vivarium --add-label "ai: generated"
```

Missing the label on an AI-authored PR is a defect; backfilling old
PRs is legitimate housekeeping.

### 4.7 Organisation-level reusable workflows

Shared cross-repo CI logic (commitlint, release notes, etc.) lives in
`aletheia-works/.github` as `workflow_call` reusables. Vivarium-specific
reusable workflows, such as verdict capture tied to Contract v1, live in this
repository. If a workflow here starts duplicating logic that would belong in
the org, flag it for promotion rather than copying.

### 4.8 GitHub Actions: latest versions, pinned by SHA

**(a) Latest at authoring time.** Use the most recent published
version of every action, runtime, and reusable-workflow ref when
editing a workflow. A stale-on-arrival workflow just creates an
immediate Dependabot follow-up PR.

**(b) Pin by full commit SHA, not tag or branch.** Marketplace tags
are mutable; per the
[GitHub security-hardening guide](https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions#using-third-party-actions),
SHA pinning is the only way to use an action as an immutable
release. Always pin to the full 40-char SHA with the
human-readable version or branch name as a trailing comment:

```yaml
uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
uses: aletheia-works/.github/.github/workflows/commitlint.yml@2869d127c99b5cd8bcfb22d7ade8a31d1204019c # main
```

The trailing comment is mandatory — the SHA alone is unreviewable.
Resolve the latest SHA with:

```bash
gh api repos/<owner>/<repo>/commits/<tag-or-branch> --jq '.sha'
```

If a newer major bumps an action's interface and migration is
non-trivial, pin the older major's latest SHA with a comment
explaining the deliberate hold (`# pinned at v3 until <link>`).

### 4.9 Toolchain (mise-managed)

Local development tool versions are pinned in
[`mise.toml`](mise.toml). Run `mise install` after cloning.

CI does **not** use mise for runtime versions (Bun, Node, Python,
Rust); each workflow step spells out the setup action directly so
the runtime is auditable from the workflow YAML alone. Versions in
`mise.toml` and CI workflows can drift; bumps land in separate PRs.

The lint workflows (`test-lint-check.yml`, `lint-autofix.yml`) are
the documented exception: they install the polyglot Rust-based
lint toolchain (Mago / Ruff / Tombi / rumdl + cargo fmt + clippy)
via `jdx/mise-action` to avoid five separate org-level third-party
action allowlist registrations.

When adding a new tool, pin it in `mise.toml` first.

### 4.10 Spec evolution policy

Public specs (Contract v1, Manifest v1, Recipes index v1) follow a
two-tier policy per ADR-0018:

| Change shape | Verdict |
|---|---|
| New **optional** field v1 consumers can ignore | Same-page **revision** — append to the revision-history footer with date and ADR reference; version literal stays `"v1"`. |
| Rename, remove, type change, semantics change, optional → required | **vN+1** — new spec page + JSON Schema sibling + new ADR. Old spec page stays readable so consumers can dispatch on the version literal. |

Every spec page carries its version literal in the file consumers
read (`<meta name="vivarium-contract">`, `manifest = "v1"`,
`index = "v1"`). Revisions never touch that literal; consumers
feature-detect new optional surface.

### 4.11 Package distribution

Per ADR-0019, runtime artefacts (Vivarium MCP today, future CLI /
SDK) dual-publish to JSR (canonical) and npm (npx ergonomics) with
OIDC trusted publishing + Sigstore provenance — no long-lived
registry tokens. Tag form: `<package-name>-v<semver>`
(e.g. `mcp-server-v0.1.0`).

### 4.12 Architecture decision records

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

### 4.13 Pre-PR local validation

**Run the matching CI checks locally before pushing.** Each PR triggers
the workflows under `.github/workflows/` whose `paths:` filter matches
the diff; the `mise run ci:*` tasks in [`mise.toml`](mise.toml) mirror
them job-for-job:

| Task                | Workflow                  |
| ------------------- | ------------------------- |
| `ci:docs`           | `test-docs.yml` (build is implicit in the E2E lane's `webServer.command`) |
| `ci:docs-unit`      | `test-docs.yml` (unit lane) |
| `ci:docs-e2e`       | `test-docs.yml` (E2E lane)  |
| `ci:repro`          | `repro-regression.yml`    |
| `ci:lint`           | `test-lint-check.yml`     |
| `ci:mcp`            | `test-mcp.yml`            |
| `ci:commitlint`     | `commitlint.yml`          |
| `ci:all`            | union of the above        |

For one-off autofix passes use the matching per-language `*:check:fix`
tasks (`docs:check:fix`, `python:check:fix`, etc.); CI's
`lint-autofix.yml` runs the same set on each PR and commits any
residual fixes back to the branch.

If a `ci:*` task is missing for the workflow you triggered, transcribe
its `run:` steps from the YAML and execute them by hand. **When CI
catches something local missed**, extend the matching `ci:*` task —
local and CI should converge on the same surface in both directions.

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

All three layers ship recipes today. See `src/layer{1,2,3}_*/README.md`
for the per-layer catalogue model.

## 6. When in doubt

1. Re-read `_context/strategy/ambitious_integrated_platform_strategy.md` —
   the project's north star.
2. Re-read the latest `_context/phase_summaries/phase*_*.md` for the
   most recent operational context.
3. If still unclear, stop and ask the human. Deferring is cheaper than
   unwinding a wrong decision on a lifelong project.
