<!--
Thanks for opening a PR on vivarium. A few notes so CI and reviewers can
move quickly:

- Title MUST follow Conventional Commits:
    <type>(<scope>)?: <subject>
  Types: feat, fix, docs, refactor, test, chore, build, ci, perf.
  The repo's commitlint workflow will fail the check otherwise.

- The scope-based `scope: *` label is applied automatically by
  `.github/labeler.yml` from file paths. Do not hand-add it.

- Labels are mechanical only (see ADR-0006). If you are about to apply a
  label by judgement, stop and ask.
-->

## Summary

<!-- 1–3 bullets on what this PR changes and why. -->

Closes #<issue-number>.

## Review focus

<!-- A checklist of specific things you want the reviewer to verify. -->
- [ ]
- [ ]
- [ ]

## Process notes

<!-- Delete the bullets that do not apply. -->
- AI-authored? If yes, the `ai: generated` label must be set on this PR.
- Scope-creep check: the diff still matches the title and linked Issue.
- Claude's automated review agrees, or you have pushed back with a specific
  justification on each disagreement (silent capitulation corrupts the
  review signal).
