# CLAUDE.md

> Claude Code-specific addenda to [`AGENTS.md`](AGENTS.md).
> Read `AGENTS.md` first — it is the authoritative, agent-agnostic instruction
> set. This file only captures what is different or extra for Claude Code.

---

## 1. Start-of-session checklist

Before acting on any non-trivial request, verify:

1. `AGENTS.md` has been loaded into context. If not, read it now.
2. The request is within scope for the current phase (Phase 0 — Bootstrap).
   Out-of-scope requests should be surfaced back to the user, not silently
   expanded into.
3. Any strategy claim you are about to make matches the current state of
   `_context/ambitious_integrated_platform_strategy.md` and
   `_context/handoff_briefing_for_claude_code.md`. Those are the
   tie-breakers for vision-level questions.

## 2. Tool preferences on this machine

- **Shell**: `bash` under Windows. Use POSIX syntax (`/dev/null`, forward
  slashes in paths), not `cmd.exe`/PowerShell idioms.
- **SCM**: Sapling (`sl`), not Git. The global user CLAUDE.md already covers
  this; repeated here because it is the most common miss.
- **Infra CLI**: OpenTofu (`tofu`), not Terraform. Never swap them even when
  muscle memory suggests `terraform …`.
- **GitHub CLI**: `gh` is available and authenticated.
- **Dedicated tools beat Bash.** Use `Read` / `Edit` / `Write` / `Glob` /
  `Grep` rather than `cat` / `sed` / `find` / `grep` invoked through Bash.

## 3. Memory is load-bearing

Claude Code persists memory under
`~/.claude/projects/C--Users-Jam-Documents-aletheia-works-vivarium/memory/`.
Notable entries already recorded:

- `project_naming.md` — repo is `vivarium`, org is `aletheia-works`.
- `project_vision.md` — problem-centred, three-layer, lifelong.
- `user_profile.md` — SRE mindset, AI-delegation-first, Japanese, Sapling.
- `feedback_modern_defaults.md` — no legacy-compat fallbacks.
- `feedback_early_stage_commits.md` — pre-PR squash-into-initial policy.
- `feedback_docs_dir_convention.md` — `docs/` vs `_context/`.
- `feedback_commit_and_label_conventions.md` — Conventional Commits +
  `prefix: value` labels.
- `feedback_mechanical_labeling.md` — no ad-hoc AI/human labelling.
- `project_org_reusable_workflows.md` — org-level reusable workflows pattern.

These memories are authoritative for behaviour; conflicts with this file
should be resolved toward whichever is more recent, and the stale one
updated.

## 4. Communication style

- Respond in **Japanese**, per the user's global preference.
- Keep inter-tool-call text ≤25 words; final responses ≤100 words unless the
  task genuinely needs more.
- No trailing "what I just did" summaries when the diff already shows it.
- Flag destructive or hard-to-reverse actions before executing. One-time
  approval is not standing approval.

## 5. Autonomous-loop mode

When invoked via `/loop` (either with a fixed interval or in dynamic
self-paced mode), the same guardrails from [`AGENTS.md § 2`](AGENTS.md) apply
unchanged. Specifically, the loop **must not**:

- Merge or approve PRs.
- Force-push to `main` once the first PR has landed.
- Create new GitHub secrets, rotate tokens, or invoke `tofu apply` against
  production state without a human in the loop.
- Pivot scope without pausing for human confirmation.

If the loop reaches a natural stopping point (work complete, ambiguous
decision, blocked on human action), end the loop rather than inventing
filler tasks.

## 6. Where the full cycle is defined

The end-to-end Issue → implementation → review → merge flow — including how
Claude Code (as both implementer and reviewer), Dosu, Dependabot, and
GitHub Actions compose — is documented in
[`docs/ai-workflow.md`](docs/ai-workflow.md). Defer to it for process
questions.
