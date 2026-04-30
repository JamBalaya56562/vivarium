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
  implement, review, and iterate. See [`docs/docs/ai-workflow.md`](docs/docs/ai-workflow.md).
- **Current phase: Phase 0 — Bootstrap.** Infrastructure-as-Code foundations
  only. Product code has not started.

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
   Full lifecycle in [`docs/docs/ai-workflow.md § 3.2`](docs/docs/ai-workflow.md).

## 4. Repository conventions

### 4.1 Layout

```
vivarium/
├── AGENTS.md              # this file — standing AI instructions
├── CLAUDE.md              # Claude Code-specific addenda
├── README.md              # public project overview
├── LICENSE                # Apache-2.0
├── .github/
│   ├── workflows/         # CI/CD — thin callers into aletheia-works/.github reusables
│   ├── dependabot.yml
│   ├── labeler.yml        # path-based label rules (mechanical)
│   └── release.yml
├── infra/
│   └── github/            # GitHub Settings-as-Code via OpenTofu
├── docs/                  # rspress docs site (config at top level, content in docs/docs/)
│   ├── package.json       # rspress + bun deps
│   ├── rspress.config.ts
│   ├── tsconfig.json
│   ├── bun.lock
│   └── docs/              # tracked public docs (vision, architecture, workflow)
└── _context/              # gitignored: private strategy memos, handoffs, drafts
```

### 4.2 `docs/` vs `_context/`

- `docs/` — tracked. The rspress documentation site lives here; its
  configuration (`package.json`, `rspress.config.ts`, `tsconfig.json`,
  `bun.lock`) sits at the top of `docs/`, and the markdown content
  itself lives one level deeper under `docs/docs/`. Every file under
  `docs/docs/` is something the project would be comfortable showing
  an outside contributor (vision, architecture, roadmap, non-goals,
  AI workflow).
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

The label is a disclosure mechanism documented in
[`docs/docs/ai-workflow.md § 4`](docs/docs/ai-workflow.md). It exists so
reviewers and downstream readers can see at a glance which changes are
AI-authored; missing it on an AI-authored PR is a defect, not a stylistic
choice. If a historical PR is found without it (whether merged or open),
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
action's maintainer last decided should be `v6`. The GitHub
security-hardening guide
(https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions#using-third-party-actions)
states explicitly that *"pinning an action to a full length commit
SHA is currently the only way to use an action as an immutable
release."* Always pin to the full 40-char commit SHA, with the
human-readable version (for marketplace actions) or branch name (for
reusable workflows) as a trailing comment for review:

```yaml
# Marketplace action — tag literal in trailing comment
uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2

# Reusable workflow on main — branch name in trailing comment
uses: aletheia-works/.github/.github/workflows/commitlint.yml@5212c0d0443cbe3ef25281d644f83d5edb0e9986 # main
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
