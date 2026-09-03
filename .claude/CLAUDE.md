# CLAUDE.md

> Claude Code-specific addenda to [`AGENTS.md`](../AGENTS.md). The line
> below imports `AGENTS.md` so it is auto-loaded into the session
> context (per Claude Code's `@<path>` import syntax). The rest of
> this file captures only what is different or extra for Claude
> Code; everything else is in the imported `AGENTS.md`.
>
> Detailed operational checklists for specific subsystems (e.g.
> recipe authoring under `src/layer*_*/`) live as path-scoped
> rules under [`.claude/rules/`](rules/) and auto-load only when
> Claude reads files matching their `paths:` frontmatter. This
> keeps both `AGENTS.md` and this `CLAUDE.md` lean (the
> "write effective instructions" guidance from
> <https://code.claude.com/docs/en/memory.md>).

@../AGENTS.md

---

## 1. Tool preferences on this machine

- **Shell**: `bash` under Windows. Use POSIX syntax (`/dev/null`, forward
  slashes in paths), not `cmd.exe`/PowerShell idioms.
- **SCM**: Sapling (`sl`), not Git. The global user CLAUDE.md already covers
  this; repeated here because it is the most common miss.
- **Infra CLI**: OpenTofu (`tofu`), not Terraform.
- **GitHub CLI**: `gh` is available and authenticated.
- **Dedicated tools beat Bash.** Use `Read` / `Edit` / `Write` / `Glob` /
  `Grep` rather than `cat` / `sed` / `find` / `grep` invoked through Bash.

## 2. Communication style

- Respond in **Japanese**, per the user's global preference.
- Keep inter-tool-call text ≤25 words; final responses ≤100 words unless the
  task genuinely needs more.
- No trailing "what I just did" summaries when the diff already shows it.
- Flag destructive or hard-to-reverse actions before executing. One-time
  approval is not standing approval.

## 3. Autonomous-loop mode

When invoked via `/loop`, the same §2 guardrails from `AGENTS.md`
apply unchanged. The loop **must not** merge / approve PRs,
force-push to `main`, create or rotate secrets, run `tofu apply`
against production state, or pivot scope without human
confirmation. End the loop at natural stopping points rather than
inventing filler tasks.

## 4. Comments

`AGENTS.md` §4.13 is the rule; these are the agent-specific failure
modes it exists to stop.

- Do not annotate your own work. Why you chose an approach, what you
  changed, and what you verified belong in the commit message body and
  the PR description — never in a comment next to the code.
- When you touch a region that already carries a comment, delete the
  comment unless it passes one of §4.13's two tests. A half-true
  comment beside an edited line is worse than either keeping or
  removing the whole thing.
- Do not restore a comment an earlier pass removed.
- Docstrings and JSDoc are comments. The same two tests apply.
