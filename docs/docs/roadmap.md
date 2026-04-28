# Roadmap

> Phase 0 through Phase 5 — what a visitor should expect to see land, in
> what order, framed in terms of the reproduction primitive.
>
> Phase titles mirror the GitHub Milestones in
> [`infra/github/milestones.tf`](https://github.com/aletheia-works/vivarium/blob/main/infra/github/milestones.tf);
> the Milestones are the canonical planning surface, and this document
> is the user-facing translation.

---

## A note on dates

You will not find a `due_date` column below. Phase durations on this
project are directional — months to years — not commitments. Inventing
calendar targets for a lifelong project would trade honesty for the
appearance of progress, and would drive every later decision toward
hitting a number rather than reproducing bugs correctly.

When a phase acquires a real deadline — for example, because a
conference talk, a grant, or a dependency release forces one — the date
will land alongside the phase, explained. Until then, the ordering and
the "what shipped" signals are the roadmap.

---

## Phase 0 — Bootstrap

**Milestone:** [Phase 0 — Bootstrap](https://github.com/aletheia-works/vivarium/milestone/3) *(closed 2026-04-26)*

**What lands:**

- Infrastructure-as-Code foundations (GitHub Settings, labels,
  milestones, branch protection).
- The AI-delegated development workflow
  ([`docs/ai-workflow.md`](./ai-workflow.md)): humans set direction and
  merge; AI agents implement and review.
- Vision, architecture stub, roadmap (this page), non-goals.
- Initial `src/` tree representing the three-layer architecture —
  scaffolding only, no product code.
- The documentation site you are reading.

**What a visitor sees:** a public repository that looks serious,
explains what the project is, and shows the process by which it will
grow. No reproducible bugs yet.

**Non-goals for this phase:** any product code; any language-specific
reproduction; any hosted service. See
[Non-goals](./non-goals.md#we-are-not-a-three-year-mvp).

## Phase 1 — Layer 1: data processing

**Milestone:** [Phase 1 — Layer 1: data processing](https://github.com/aletheia-works/vivarium/milestone/2)

**What lands:**

- The first real reproduction vertical: **Python + SQLite over
  WebAssembly**, via [Pyodide](https://pyodide.org).
- A handful of hand-picked upstream bugs (pandas / numpy / sqlite
  behavioural regressions) reproducible from a single browser tab.
- A minimal flow: bug description → linked reproduction page → click
  → pass/fail verdict — no accounts, no setup, no install.

**What a visitor sees:** a gallery where each card is a real bug from a
real upstream project, each linked to a page that reproduces it in
seconds in their browser. 10–100 early users is the target population.

**Non-goals for this phase:** non-Python languages; bugs requiring
filesystem or network; authoring UX. See
[Non-goals](./non-goals.md#we-are-not-an-ide-or-editor).

## Phase 2 — Layer 1: multi-language

**Milestone:** [Phase 2 — Layer 1: multi-language](https://github.com/aletheia-works/vivarium/milestone/4)

**What lands:**

- Layer 1 broadens: **Rust** (`wasm32-wasi`), **JavaScript/TypeScript**,
  **Ruby** ([Ruby.wasm](https://github.com/ruby/ruby.wasm)), **PHP**
  ([php-wasm](https://github.com/WordPress/wordpress-playground)).
- Upstream contributions where the WASM runtime gap blocks a
  reproduction — filed and landed in the runtime itself rather than
  worked around locally.
- Common browser-side scaffolding extracted so adding a language is a
  small per-runtime adapter, not a greenfield rewrite.

**What a visitor sees:** the gallery from Phase 1 stops being
Python-only. A Rust borrow-checker regression, a JavaScript `Array`
quirk, a Ruby regex edge case all reproduce the same way: open the
page, click, see the verdict.

**Non-goals for this phase:** OS-level reproduction; container images;
compiled-language builds requiring a host toolchain.

## Phase 3 — Layer 2: Docker

**Milestone:** [Phase 3 — Layer 2: Docker](https://github.com/aletheia-works/vivarium/milestone/5)

**What lands:**

- The second layer: **full-fidelity container-based reproduction** for
  bugs that need a real filesystem, real processes, real networking, or
  a real toolchain.
- A **catalogue model**, not a hosted execution service. Each
  reproduction ships a `Dockerfile` + `repro.sh` + a public
  pre-built image at `ghcr.io/aletheia-works/vivarium-<slug>`. The
  visitor reproduces the bug locally with one
  `docker run …` command, optionally one-click via "Open in
  Codespaces" if they have a GitHub account. Vivarium guarantees
  the recipe and the image; the runtime happens on the visitor's
  machine.
- A **CI-snapshot verdict** on each gallery page — "when CI ran
  today against this `Dockerfile`, the bug reproduced" — paired
  with the recipe and the registered image. Same verdict
  semantics as Layer 1; the live run is the visitor's local
  confirmation.

**What a visitor sees:** the gallery card for a Layer 2 bug shows
the upstream issue, a one-line `docker run` snippet, the latest CI
verdict snapshot, and (for some pages) an "Open in Codespaces"
button. Clicking through yields the bug reproduction in well
under five minutes — local Docker for the no-account path,
Codespaces for the no-Docker path. Multi-service, multi-process,
network-dependent bugs become as **linkable and as honest** as the
Layer 1 ones; the trade-off is that the run happens in the
visitor's environment rather than in the page itself.

**Non-goals for this phase:** arbitrary compute-as-a-service (see
[Non-goals](./non-goals.md#we-are-not-a-general-code-execution-playground));
per-user persistent environments; hosted SLAs; **paid sandbox
execution** — Vivarium does not run Layer 2 containers on its
own infrastructure or charge visitors to run them, intentionally.
This decision is recorded in ADR-0010 (private memo) and
forward-compatible with adding paid hosted execution later if
the project ever has the audience to justify it.

## Phase 4 — Layer 3: record-replay & deterministic

**Milestone:** [Phase 4 — Layer 3: record-replay & deterministic](https://github.com/aletheia-works/vivarium/milestone/6) *(closed 2026-04-28 with one recipe shipped; further Layer 3 entries deferred to later phases as candidates emerge)*

**What landed:**

- The third layer for bugs Layers 1 and 2 cannot reach on their own:
  **record-replay** ([rr](https://rr-project.org), Pernosco-style
  analysis) and **deterministic simulation**
  ([Antithesis](https://antithesis.com)-style). The opener vertical
  is `rr`.
- A **trace-shipped catalogue model**, mirroring Phase 3. Each
  reproduction ships a `Dockerfile` + `replay.sh` + a public
  pre-built image at `ghcr.io/aletheia-works/vivarium-<slug>` with
  the recorded trace **baked into the image**. The visitor reproduces
  the bug locally with one `docker run …` command — `rr replay`
  against the pinned trace, deterministic by construction.
- A **CI-snapshot verdict** on each gallery page — "when CI replayed
  the trace today, the bug reproduced" — paired with the recipe and
  the registered image. Same verdict semantics as Layers 1 and 2;
  the live run is the visitor's local confirmation.
- Honest scope — Layer 3 is expensive per *recipe* (the maintainer
  records once on a Linux/x86_64 host with a usable CPU performance
  counter); the visitor side is just `docker run`. Layer 3 lands a
  recipe only when the cheaper layers cannot observe the failure at
  all, not by default.

**What a visitor sees:** categories of bugs that were previously
"irreproducible" — the hardest ones — start having Vivarium entries.
The gallery card for a Layer 3 bug shows the upstream issue, a
one-line `docker run` snippet against the GHCR image, the latest CI
verdict snapshot from replaying the baked-in trace, and any "how it
was recorded" notes from the maintainer.

**Non-goals for this phase:** replacing specialist tools in their own
domains (`rr` for single-process Linux, Antithesis for distributed
simulation); becoming a general-purpose debugger; **live recording on
the visitor side or in CI** (the trace is recorded once by the
maintainer and shipped — see ADR-0011 for the rationale, in
particular why GitHub Actions hosted runners cannot record).

## Phase 5 — Ecosystem

**Milestone:** [Phase 5 — Ecosystem](https://github.com/aletheia-works/vivarium/milestone/1) *(closed 2026-04-29 with the contract / manifest / reusable-workflow surfaces published; Issue-triage tooling deferred without adoption)*

**What landed:**

- **Contract v1 published as an external standard** —
  [`docs/docs/spec/contract-v1.md`](./spec/contract-v1.md),
  [`verdict.schema.json`](https://aletheia-works.github.io/vivarium/spec/verdict.schema.json),
  and CI enforcement via `ajv-cli` against every Layer 2 and
  Layer 3 `verdict.json` on each write.
- **Manifest v1 published** —
  [`docs/docs/spec/manifest-v1.md`](./spec/manifest-v1.md),
  [`manifest.schema.json`](https://aletheia-works.github.io/vivarium/spec/manifest.schema.json),
  and three reference TOML manifests under
  [`src/external_examples/`](https://github.com/aletheia-works/vivarium/tree/main/src/external_examples).
  An external repository can now declare a Vivarium-runnable
  reproduction by shipping a single `.vivarium/manifest.toml`
  file — no bespoke glue required.
- **Reusable verdict-capture GitHub Actions workflow** —
  [`aletheia-works/.github/.github/workflows/vivarium-verdict.yml`](https://github.com/aletheia-works/.github/blob/main/.github/workflows/vivarium-verdict.yml).
  Any consumer repo can `uses:` this workflow to verify a
  Vivarium-hosted reproduction in their own CI; documented at
  [Consumer workflow](./spec/consumer-workflow.md).
- **Verdict drift detection on the weekly cron** — the
  `repro-regression.yml` workflow now contrasts the
  freshly-captured Layer 2 verdict against the deployed Pages
  snapshot; a divergence (upstream / runtime drift while the
  repo did not change) fails the workflow and surfaces via
  GitHub's native workflow-failure email.

**What did not adopt:** Issue triage tooling (Dosu replacement).
A research memo evaluated CodeRabbit Issue Enrichment, Sweep AI,
Greptile, Cody / Sourcegraph, GitHub-native Copilot for Issues,
and Anthropic's `claude-code-action`. The recommended primary
(CodeRabbit Issue Enrichment) was declined based on prior
free-tier experience on the PR-review side; the fallback's
per-issue API token cost did not match the zero-recurring-cost
constraint. **No Issue-triage tool is in place** as Phase 5
closes; if external Issue volume creates pressure later, the
research memo plus a fresh re-evaluation drives the next
decision.

**What a visitor sees:** reproduction has external surfaces —
contract, manifest, reusable workflow — that any project can
consume without changing how Vivarium itself is built.
Reproduction is on its way to becoming a capability the
ecosystem expects rather than a thing one project does.

**Non-goals for this phase:** a managed service with an SLA (see
[Non-goals](./non-goals.md#we-are-not-a-managed-service-with-an-sla));
closing the source; vendor lock-in of any kind.

---

## See also

- [Vision](./vision.md) — what we are building and why.
- [Non-goals](./non-goals.md) — what we are deliberately not building.
- [AI workflow](./ai-workflow.md) — how the phases get implemented.
- [Milestones on GitHub](https://github.com/aletheia-works/vivarium/milestones) —
  the live view of in-flight work.
