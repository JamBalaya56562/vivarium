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

## Phase 0 — Bootstrap *(current)*

**Milestone:** [Phase 0 — Bootstrap](https://github.com/aletheia-works/vivarium/milestone/3)

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
- Devcontainer images as the baseline, with [Firecracker](https://firecracker-microvm.github.io)
  microVMs explored for faster boot and stronger isolation.
- Routing: a bug that could run in Layer 1 still does; a bug that
  needs Layer 2 gets Layer 2 automatically.

**What a visitor sees:** reproducibility stops being gated by "does
this fit in WASM?" Multi-service, multi-process, network-dependent
bugs become as linkable as the Layer 1 ones — with a slower first-load
cost, honestly labelled.

**Non-goals for this phase:** arbitrary compute-as-a-service (see
[Non-goals](./non-goals.md#we-are-not-a-general-code-execution-playground));
per-user persistent environments; hosted SLAs.

## Phase 4 — Layer 3: record-replay & deterministic

**Milestone:** [Phase 4 — Layer 3: record-replay & deterministic](https://github.com/aletheia-works/vivarium/milestone/6)

**What lands:**

- The third layer for bugs Layers 1 and 2 cannot reach on their own:
  **record-replay** ([rr](https://rr-project.org), Pernosco-style
  analysis) and **deterministic simulation**
  ([Antithesis](https://antithesis.com)-style).
- Targeted verticals: heisenbugs, memory-ordering races, long-replay
  production traces, distributed-system interleavings.
- Honest scope — Layer 3 is expensive per reproduction; it runs when
  the cheaper layers cannot observe the failure at all, not by
  default.

**What a visitor sees:** categories of bugs that were previously
"irreproducible" — the hardest ones — start having Vivarium entries.
Often with a link to a recorded trace rather than a live run.

**Non-goals for this phase:** replacing specialist tools in their own
domains (`rr` for single-process Linux, Antithesis for distributed
simulation); becoming a general-purpose debugger.

## Phase 5 — Ecosystem

**Milestone:** [Phase 5 — Ecosystem](https://github.com/aletheia-works/vivarium/milestone/1)

**What lands:**

- Integrations with the tools on either side of the reproduction
  primitive: AI review (CodeRabbit, Greptile, etc.), Issue triage
  (Dosu), IDEs, CI systems.
- Third-party reproduction definitions — projects describing their own
  reproduction protocols in a format Vivarium runs without bespoke
  glue.
- Positioning the reproduction primitive as an industry-standard
  concept, not a single project's feature.

**What a visitor sees:** reproduction stops being a thing one project
does and starts being a capability the ecosystem expects — the way
"CI ran" is today. Vivarium is one implementation of the primitive, not
the primitive itself.

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
