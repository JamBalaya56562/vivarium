# ADR-0003: Use OpenTofu instead of Terraform

## Status

Accepted

## Context

Infrastructure-as-Code tooling underwent a licensing fracture in 2023
when HashiCorp relicensed Terraform from MPL to the Business Source
License (BSL). [OpenTofu](https://opentofu.org) forked from
MPL-licensed Terraform and remains Apache 2.0.

The `aletheia-works` organisation is OSS-philosophy-first: its
infrastructure tooling must not be encumbered by a non-OSS license
that could constrain contribution, redistribution, or the
organisation's own ability to self-host.

## Decision

All Infrastructure-as-Code in this project uses OpenTofu (`tofu`
CLI). HashiCorp Terraform binaries and features gated behind the BSL
license are not used. Provider configuration remains compatible with
providers published via the
`integrations/terraform-provider-github`-style ecosystem, which
continues to publish to both OpenTofu and Terraform registries.

## Consequences

### Positive

- License-clean OSS toolchain throughout.
- Aligns with the organisation's broader OSS philosophy.
- Avoids dependence on a single vendor that has demonstrated
  willingness to change license terms.

### Negative

- Smaller ecosystem than Terraform. Some third-party modules lag on
  OpenTofu compatibility.
- Documentation and tutorials occasionally assume the `terraform`
  command; contributors must translate.

### Neutral

- Day-to-day commands and HCL syntax are near-identical. The
  cognitive load of the switch is minimal.

## Alternatives considered

- **HashiCorp Terraform (BSL):** rejected — license conflict with
  the OSS-first posture.
- **Pulumi:** rejected — requires a full programming language rather
  than declarative HCL, which is more cognitive load for
  infrastructure the project wants to keep boringly declarative.
- **CDK for Terraform:** rejected — same BSL issue as Terraform
  proper.

## References

- [OpenTofu project](https://opentofu.org)
- `infra/github/versions.tf`
- `AGENTS.md` § 3 — "Modern defaults, no legacy fallbacks"
