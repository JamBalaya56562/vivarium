# Non-goals

> What Vivarium is *not* building, and why.
>
> Saying no is load-bearing on a lifelong project: explicit non-goals keep
> scope honest and make legitimate expansion distinguishable from drift.

A non-goal is not a "we can't do this" statement. It is a "we have
chosen not to do this" statement. Each entry below includes the
reasoning so that a future contributor can tell scope drift from a
genuine pivot.

---

## We are not a general code execution playground

Tools like StackBlitz, CodeSandbox, Replit, and GitHub Codespaces exist
to let people write and run code in a hosted environment. Vivarium does
not compete with them. Vivarium provides a narrower primitive —
reproduce a specific bug — and deliberately lacks editor ergonomics,
project scaffolding, or arbitrary-language IDE features.

**Why:** Conflating "run arbitrary code" with "reproduce a bug" leads
to surface-area inflation. The former is already served well by
several mature players; the latter is the underserved primitive
Vivarium exists to provide.

## We are not an AI code generator

Vivarium does not write fixes, propose patches, or generate pull
requests. It verifies whether a claim about a bug is reproducible.

**Why:** Generation is a crowded market (Copilot, Cursor, Claude
Code, Codex, Greptile, Sourcery). Verification is the complementary
primitive that closes the AI-generation-to-maintainer-trust loop. We
stay on the verification side so our output can be trusted regardless
of who or what wrote the original claim.

## We are not an IDE or editor

There is no authoring UX in Vivarium. Reproduction inputs come from
an Issue body, a PR diff, or a linked artifact — never from a live
editor pane that we maintain.

**Why:** Editors are a domain in themselves. The project would
consume itself building editor features long before it finished being
a good reproduction platform.

## We are not a CVE triage or security scanner

GitHub Security Lab, Snyk, Semgrep, and others classify
vulnerabilities and maintain advisories. Vivarium does not assign
severities, issue advisories, or maintain a CVE database. It only
answers "can this be reproduced?" — which a security workflow may
consume, but which is not itself a security product.

**Why:** Security classification requires specialist judgement and
regulatory alignment that sits outside our scope. Mixing the two
would dilute both.

## We are not a managed service with an SLA

Vivarium is OSS-first. A hosted convenience may exist, but the
product is the open-source platform; any hosted tier is a
convenience, not the contract.

**Why:** The primitive we care about — reproduction — only fulfils
its purpose if maintainers of open projects can run it on their own
infrastructure without asking permission. Closing the source to
sustain a managed tier would undermine the reason the project exists.

## We are not tied to any single technology

WebAssembly is not the product. Docker is not the product.
Record-replay is not the product. The product is reproduction, and
the technology is chosen by the problem.

**Why:** Every adjacent player is anchored to a single technology
(StackBlitz to WASM, Codespaces to Docker, `rr` to Linux ptrace).
The technology boundary becomes the product boundary — and the
unreachable categories become permanently unreachable. Vivarium
refuses that anchoring.

## We are not a three-year MVP

The roadmap spans years, not quarters. The project is built on the
assumption that lifelong scope requires lifelong patience: no
shipping-to-launch pressure, no feature quota to justify a round of
funding, no completion deadline.

**Why:** The techniques we respect — record-replay research,
deterministic simulation, mature WASM runtimes — took decades to
mature. Reproduction-as-a-primitive deserves the same timescale.

---

## See also

- [Vision](./vision.md) — what we *are* building.
- [Roadmap](./roadmap.md) — the per-phase plan.
