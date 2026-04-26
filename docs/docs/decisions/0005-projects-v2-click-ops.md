# ADR-0005: Projects v2 is click-ops; Milestones and Labels are IaC

## Status

Accepted

## Context

GitHub Projects v2 (the GraphQL-based, organisation-level project
boards introduced in 2022) has **no OpenTofu provider resource** as
of `integrations/terraform-provider-github` v6.11.x. The tracking
issue ([#2916](https://github.com/integrations/terraform-provider-github/issues/2916))
is open; the first partial implementation
([#2898](https://github.com/integrations/terraform-provider-github/pull/2898))
was closed unmerged.

Projects v2's functional surface — board config, custom fields,
views, and workflows — is tightly bound to its GraphQL schema, which
evolves quickly. Rolling a custom `graphql`-provider configuration
or a `null_resource` + `gh` hack would be brittle and produce no
meaningful drift detection.

Milestones and labels, by contrast, are first-class provider
resources (`github_repository_milestone`, `github_issue_label`) that
work cleanly today and are stable.

## Decision

- The **Project v2 board** is click-ops — created and configured
  through the GitHub UI. Its URL and initial configuration are
  documented in [AI workflow § 1](../ai-workflow.md).
- **Milestones** are managed as IaC via
  [infra/github/milestones.tf](https://github.com/aletheia-works/vivarium/blob/main/infra/github/milestones.tf).
- **Labels** are managed as IaC via
  [infra/github/labels.tf](https://github.com/aletheia-works/vivarium/blob/main/infra/github/labels.tf).
- **Branch protection** is managed as IaC via
  [infra/github/branch_protection.tf](https://github.com/aletheia-works/vivarium/blob/main/infra/github/branch_protection.tf).

Revisit this decision when the provider ships a
`github_project_v2_*` resource.

## Consequences

### Positive

- Avoids brittle custom code for a rapidly-evolving click-ops
  surface.
- The parts AI-agent workflows depend on most — Milestones and
  Labels — are auditable in version control.
- Low switching cost when provider support eventually lands; most
  of our config can migrate incrementally.

### Negative

- Project board drift is possible and not detectable by `tofu plan`.
- Re-creating the board (if accidentally deleted) requires manual
  replay from documentation rather than a `tofu apply`.

## Alternatives considered

- **Full IaC via a custom GraphQL provider:** brittle, high
  maintenance burden, no drift detection worth the name.
- **Full click-ops for everything:** would lose the auditability of
  Milestones and Labels — which ARE cleanly IaC-able today — for no
  real benefit.

## References

- [infra/github/milestones.tf](https://github.com/aletheia-works/vivarium/blob/main/infra/github/milestones.tf), [labels.tf](https://github.com/aletheia-works/vivarium/blob/main/infra/github/labels.tf), [branch_protection.tf](https://github.com/aletheia-works/vivarium/blob/main/infra/github/branch_protection.tf)
- Provider tracking issue:
  [integrations/terraform-provider-github#2916](https://github.com/integrations/terraform-provider-github/issues/2916)
- [AI workflow § 1](../ai-workflow.md)
