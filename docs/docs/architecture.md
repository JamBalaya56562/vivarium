# Architecture

> Technical design for the three-layer reproduction architecture.
> Audience: contributors and AI agents who need to choose where a new
> reproduction vertical lives.
>
> This page is the *technical* companion to the [Vision](./vision.md)
> (the public framing): the Vision answers *what* and *why*; this page
> answers *how* the pieces fit together in the current phase.

---

## Guiding principle: technology serves the problem

The layers exist because reproduction problems differ in kind, not
because the technologies are interesting. A bug that only needs a
Python interpreter to reproduce should not pay the startup cost of a
container. A bug that needs `fork()` must not be pretended into a WASM
sandbox that cannot run it. A heisenbug that fails to reproduce one in
ten runs cannot be solved by running it harder.

No layer is the right answer. **The problem chooses the layer.** The
three-layer split exists so that when a new reproduction domain shows
up, we already have a slot for it — and if we do not, that is the
signal that a fourth layer (or a new technique inside an existing
layer) might be warranted.

## Layer 1 — WebAssembly (browser-native)

### Target use cases

- Algorithmic bugs (sorting, parsing, text processing).
- Data-processing regressions (pandas / polars / numpy shape bugs).
- Database behavioural bugs (sqlite query anomalies, JSON path edge
  cases).
- Library-internal logic where the repro does not touch the filesystem,
  network, or process model.

### Startup-time characteristics

- Cold load (first visit, no service-worker cache): **1–10 seconds**,
  dominated by runtime download (Pyodide wheel bundle ≈ 10 MB
  compressed) and module instantiation.
- Warm load (cached runtime): **< 1 second** to ready state.
- Per-reproduction execution: **milliseconds to a few seconds**, in the
  regime where Layer 1 is the right fit.

### Known limits

- **Memory.** Browser WASM tabs cap out well below a modern laptop —
  Pyodide tabs commonly degrade past ~1 GB peak, 4 GB is an effective
  hard ceiling. Bugs that manifest only at production data scales
  belong in Layer 2.
- **System calls.** No real `fork`/`exec`, no real sockets, no real
  filesystem. Virtualised shims (Emscripten FS, WASI preview shims)
  cover common cases but not all.
- **Deterministic-interleaving bugs.** Single-threaded by default;
  shared-memory threading is behind COOP/COEP headers and still does
  not give you scheduler control. Race conditions belong in Layer 3.
- **Compiled-language toolchains.** Running a Rust bug in-browser is
  fine; rebuilding the Rust compiler to exhibit a compiler bug is not
  (host toolchain → Layer 2).

### Candidate runtimes

| Language | Runtime                                          | Status             |
|----------|--------------------------------------------------|--------------------|
| Python   | [Pyodide](https://pyodide.org)                   | Phase 1 target     |
| SQLite   | [sqlite-wasm](https://sqlite.org/wasm/)          | Paired with Pyodide |
| Rust     | `wasm32-wasi` / `wasm32-unknown-unknown`         | Phase 2            |
| JavaScript | Native browser (no extra runtime)              | Phase 2            |
| Ruby     | [Ruby.wasm](https://github.com/ruby/ruby.wasm)   | Phase 2            |
| PHP      | [php-wasm](https://github.com/WordPress/wordpress-playground) | Phase 2 |

Concrete runtime pairings (e.g. Pyodide × which SQLite build) land as
ADRs once the bug being solved demands one.

## Layer 2 — Docker / microVM (full-fidelity environment)

### Target use cases

- Whole-project reproductions — the bug needs the project's actual
  dependency resolver to run against a real package index.
- System-call-dependent bugs — real `fork`, real sockets, real file
  locking, real signals.
- Toolchain-specific bugs — a particular GCC, a particular glibc, a
  particular kernel ABI quirk.
- Multi-process / multi-container bugs where the interaction *between*
  processes is the bug.

### Startup-time characteristics

- Cold image pull + boot: **seconds to tens of seconds**, depending on
  image size and registry proximity.
- Warm microVM boot (Firecracker): **hundreds of milliseconds** for
  minimal images — the closest Layer 2 gets to Layer 1 latency.
- Per-reproduction execution: **seconds to minutes**, because the whole
  environment is real.

### Known limits

- **First-load latency.** Even cached, Layer 2 will not match Layer 1's
  sub-second feel. Reproductions that *could* run in Layer 1 always
  should.
- **Sandboxing trust boundary.** Arbitrary code in a real container is
  a weaker isolation boundary than arbitrary code in a browser WASM
  sandbox. Host-level hardening (Firecracker, gVisor) pushes the line
  but never removes it — Layer 2 runs untrusted code in a more
  capable jail than Layer 1, never a looser one.
- **Cost.** Container minutes are not free. Layer 2 runs when the
  reproduction needs it, not by default.

### Candidate runtimes

| Runtime                                          | Role                        |
|--------------------------------------------------|-----------------------------|
| OCI image + standard container runtime (devcontainer baseline) | Portable default |
| [Firecracker](https://firecracker-microvm.github.io) microVM  | Fast boot, stronger isolation (exploration) |
| [Kata Containers](https://katacontainers.io)                  | OCI-compat microVM (exploration) |
| [gVisor](https://gvisor.dev)                                   | User-space kernel for sharper sandboxing (exploration) |

## Layer 3 — Third-way (record-replay, deterministic, snapshot)

### Target use cases

- Heisenbugs: data races, memory-ordering bugs, use-after-free where
  a naive rerun does not reproduce the failure.
- Long-replay scenarios: hours of captured execution replayed in
  minutes, with time-travel debugging.
- Distributed-system bugs where the failure depends on a specific
  message interleaving.
- Post-mortem forensic analysis — stepping backwards through a
  recorded trace rather than forwards from a fresh run.

### Startup-time characteristics

- **Capture phase** (on the reporter's side or in a controlled rig):
  typically **2×–5× slowdown** over native execution. This is not a
  user-facing number — it is the price the recording system pays.
- **Replay / analysis phase** (for Vivarium visitors): interactive,
  typically **faster than the original execution** because forward
  and backward stepping replaces re-execution.
- End-to-end "from Issue link to observed failure" latency depends on
  whether a trace is already recorded (seconds to view) or needs to
  be generated on demand (minutes).

### Known limits

- **Cost per reproduction is high.** Layer 3 runs only when Layers 1
  and 2 cannot observe the failure at all — not as a default upgrade
  path.
- **Tool-specific coverage gaps.** `rr` targets single-process Linux
  x86_64; distributed simulation tools target distributed systems;
  neither covers the other. Layer 3 will feel more like a portfolio
  of specialist rigs than a single runtime for the foreseeable
  future.
- **Storage.** Traces are large. Any hosted tier needs an explicit
  retention policy; Phase 4 will not pretend traces are free.

### Candidate runtimes / approaches

| Approach                                        | Target                        |
|-------------------------------------------------|-------------------------------|
| [rr](https://rr-project.org)                    | Single-process Linux record-replay |
| [Pernosco](https://pernos.co)-style             | Hosted backward-step debugging |
| [Antithesis](https://antithesis.com)-style      | Deterministic distributed sim   |
| WASI Preview 3+ with snapshot hooks             | Replayable WASM executions      |
| [CRIU](https://criu.org)                        | Process snapshot & restore      |
| Firecracker snapshots                           | microVM-level time travel       |

## How a reproduction request is routed

Routing is a first-class concern, not a side effect. In Phase 0 there
is no routing logic yet — the PoC is hand-coded to Layer 1. The design
below is what routing looks like once it exists; it is included here so
new verticals know what shape they need to declare.

```
┌────────────────────┐
│ Reproduction spec  │   (from Issue body, PR diff, or manifest file)
│  - language        │
│  - required syscalls?
│  - determinism need?
│  - data scale?
└─────────┬──────────┘
          │
          ▼
┌────────────────────┐
│ Layer selection    │   Mechanical, not judgement. Hard filters first,
│  - Layer 1 possible?│   cheapest layer wins among the feasible set.
│  - Layer 2 needed?  │
│  - Layer 3 required?│
└─────────┬──────────┘
          │
          ▼
┌────────────────────┐
│ Runtime dispatch   │   Within a layer, pick the runtime that has
│  (per layer)       │   already proven out for this language /
└─────────┬──────────┘   toolchain / OS combination.
          │
          ▼
┌────────────────────┐
│ Execute & emit     │   Output must mechanically distinguish
│  verdict            │   "reproduced" vs "did not reproduce" — not
└────────────────────┘   just "here is some stdout."
```

The selection rules are intentionally conservative:

1. **If Layer 1 can run the reproduction faithfully, Layer 1 wins.**
   Faster first paint, cheaper to host, runs without an account.
2. **Otherwise, if Layer 2 covers the requirements, Layer 2 wins.**
   Real OS, real processes, at the cost of startup latency.
3. **Layer 3 runs only when Layers 1 and 2 cannot observe the failure**
   — concurrency, non-determinism, time-travel needs. Layer 3 is not
   an "upgrade" on Layer 2; it is a different product for different
   bugs.

Ambiguous cases (e.g. "this could run in Layer 1 but with memory
pressure") stay in the cheapest feasible layer until evidence says
otherwise. Routing is mechanical: promoting a reproduction to a more
expensive layer requires a concrete failure signal, not a hunch.

## Interface between layers

A reproduction declares itself via a small, layer-agnostic spec. The
intent is that the *same* declaration shape works whether the
reproduction runs in a browser tab or a Firecracker microVM:

- **Identity** — upstream repo + issue / commit / version being
  reproduced.
- **Inputs** — deterministic inputs required to trigger the bug.
- **Expected failure signal** — what "reproduced" looks like (exit
  code, specific error text, structured verdict).
- **Runtime hints** — minimum runtime requirements (Python 3.12+,
  glibc ≥ 2.36, network: no, filesystem: read-only, etc.).
- **Preferred layer (optional)** — only set when the reporter has a
  specific reason; the router's default decision is expected to be
  right.

The concrete schema is deliberately not defined in Phase 0. It will
emerge from implementing the first several verticals and observing
what they actually need, rather than from up-front design.

## Phase 0 scope

Phase 0 focuses exclusively on **Layer 1 with Pyodide + SQLite** as the
first concrete reproduction domain, implemented as a single
hand-coded PoC — see
[Issue #13](https://github.com/aletheia-works/vivarium/issues/13). No
routing, no layer selection, no runtime dispatch: just one bug, fully
reproduced in a browser tab.

Layer 2 and Layer 3 are **expected but unscheduled**. They will gain
real files in `src/layer2_docker/` and `src/layer3_thirdway/` only
when a concrete Issue proposes a vertical; they exist now as empty
subdirectories with READMEs so the architectural slot is visible.

This phasing is deliberate: committing to specific runtimes beyond
Phase 0 before the Phase 0 PoC has validated the primitive end-to-end
would be the same tech-anchor mistake the project's
[problem-first principle](./vision.md#core-principle-problem-first)
exists to avoid.

## See also

- [Vision](./vision.md) — why this matters.
- [Roadmap](./roadmap.md) — when each layer is expected to land.
- [Non-goals](./non-goals.md) — what this architecture deliberately
  will not become.
- [AGENTS.md § 5](https://github.com/aletheia-works/vivarium/blob/main/AGENTS.md) — short layer summary for AI agents.
