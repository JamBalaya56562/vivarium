# Layer 3 — "Third way" (record-replay, microVM, deterministic)

> Reproduction for bugs Layers 1 and 2 cannot reach on their own:
> heisenbugs, races, memory-ordering bugs, time-travel debugging.
> The visitor `docker run`s a recipe and `rr replay`s a recorded
> trace baked into the image. Vivarium guarantees the recipe and
> the registered image; the replay happens on the visitor's machine.
>
> See [Phase 4 — Layer 3: record-replay & deterministic](../../docs/docs/roadmap.md#phase-4--layer-3-record-replay--deterministic)
> for the visitor-facing description and the design rationale.

---

## What routes here

- **Heisenbugs** — race conditions, memory-ordering bugs, use-after-free
  where a naive rerun will not reproduce the failure.
- **Long-replay scenarios** — an hour of production load condensed into
  a replayable trace.
- **Deterministic-simulation bugs** — distributed-system bugs where the
  failure depends on a specific message interleaving across nodes
  (Antithesis-style).
- **Post-mortem forensic replay** — stepping backwards through a
  captured execution, not forwards from a fresh run.

## What does **not** route here

- A bug you can reliably reproduce by running the program once → Layer 1
  or Layer 2.
- A bug whose fix is obvious from a single stack trace — Layer 3's cost
  (capture-time overhead, storage, tooling) is only justified when
  cheaper layers cannot observe the failure at all.

## Candidate runtimes

| Runtime / approach                              | Target                         |
|-------------------------------------------------|--------------------------------|
| [rr](https://rr-project.org)                    | Single-process record-replay    |
| [Pernosco](https://pernos.co)-style analysis    | Hosted backward-step debugging  |
| [Antithesis](https://antithesis.com)-style      | Deterministic distributed sim   |
| WASI Preview 3+ with snapshot hooks             | Replayable WASM executions      |
| CRIU                                            | Process snapshot & restore      |
| Firecracker snapshots                           | microVM-level time travel       |

The Phase 4 opener is **`rr`** — single-process Linux x86_64 record-replay.
The catalogue convention below is shaped around it. CRIU / Firecracker
snapshots / Antithesis-style simulators are expected to land later as
sibling subdirectories with the same per-recipe shape.

## Per-page convention

Every reproduction lives in its own subdirectory of this folder named
`<project>-<issue>` (mirroring the Layer 1 / Layer 2 slug shape). Each
directory ships:

| File           | Role                                                                                                                                | Required?    |
|----------------|-------------------------------------------------------------------------------------------------------------------------------------|--------------|
| `Dockerfile`   | Pinned base image with `rr` installed and the upstream reproducer compiled. Pulls the trace artifact via `ADD <trace.url>` so the image is self-contained. Pin everything: base image by digest, package versions explicit. | ✅           |
| `record.sh`    | Documents how the maintainer recorded the trace locally on a Linux/x86_64 host with a usable PMU. Not invoked by CI or visitors — reproducibility note for future maintainers. | ✅           |
| `replay.sh`    | The visitor-facing replay invocation. Runs `rr replay /trace …` and exits 0 on `pass` (bug reproduces in the trace) or 1 on `fail`. Same verdict semantics as Layer 1 / Layer 2. | ✅           |
| `trace.url`    | Pinned URL of the trace artifact (a GitHub Release asset under `aletheia-works/vivarium`, tag-pinned and content-addressable).      | ✅           |
| `README.md`    | Bug description (with upstream issue link), the exact `docker run …` command, expected output, the CI-snapshot verdict, and any "why this bug" notes. | ✅           |
| `verdict.json` | *Generated locally by the maintainer*, alongside the trace, then committed to the recipe. Captures the `pass` / `fail` snapshot from `rr replay` + run timestamp + the local-build image ID. Surfaced on the gallery. CI does not regenerate this — see "Why no replay in CI". | ✅ (tracked) |
| Fixtures       | Whatever the recipe needs *outside* the trace. Kept minimal; the trace itself is the heavyweight artifact and lives in the Release asset, not in git. | ⏳           |

## Why no replay in CI

`rr` hits **two** capability gaps on GitHub Actions hosted Ubuntu
runners (Azure Hyper-V), confirmed empirically during Phase 4
Stage A:

1. **Record is unreachable** — Hyper-V does not expose CPU
   performance counters to the guest. `rr record` aborts; sysctl
   tuning does not help because the counter hardware itself is
   absent. The maintainer records on a PMU-equipped Linux/x86_64
   host instead, uploads the trace as a Release asset, and pins
   the URL in `trace.url`.
2. **Replay is also unreachable** — `rr` needs CPUID faulting on
   the replay side whenever the record-side CPU and the
   replay-side CPU differ, so the recorded program sees the
   recorded CPUID instead of the runner's. Hyper-V does not expose
   CPUID faulting to the guest either; replay aborts with
   `[FATAL] Trace was recorded on a machine with different CPUID
   values and CPUID faulting is not enabled` ([Stage A run](https://github.com/aletheia-works/vivarium/actions/runs/24992650815)).

So the verdict snapshot pipeline cannot mirror Layer 2's. Layer 3
ships `verdict.json` as a **tracked file**, generated by the
maintainer on the same host that recorded the trace (a `docker
run` against the locally-built image, JSON-wrapped output
captured), and committed to the recipe.

CI's role for Layer 3 is reduced to:

- Build the image (verifies the `Dockerfile` still works and the
  trace ADD URL still resolves).
- Push to GHCR (`ghcr.io/aletheia-works/vivarium-<slug>`) on push
  to main.
- Surface `verdict.json` in the gallery artefact at
  `/repro/<slug>/verdict.json` (no CI write, just a copy of the
  tracked file).

Visitor replay still works on every realistic visitor host
(Intel Ivy Bridge+ / modern AMD with stock Linux + Docker, where
the kernel enables CPUID faulting automatically). The verdict
snapshot a visitor sees on the page is what the maintainer
captured; the visitor's own `docker run` is the live
confirmation. Divergence between the snapshot and a visitor's
run is itself signal — typically meaning the visitor's host CPU
or kernel does not support CPUID faulting, or their `rr` build
diverges from the recording side.

The reasoning trail and the falsified prior assumptions ("Free
CI runner viable", then "replay alone might still work in CI")
are recorded in ADR-0011 (private memo).

## Image distribution

CI builds and pushes one image per page on every push that touches the
directory:

```
ghcr.io/aletheia-works/vivarium-<slug>:latest      # tracks main
ghcr.io/aletheia-works/vivarium-<slug>:<git-sha>   # immutable per-commit
```

The image is self-contained: it includes `rr`, the upstream
reproducer binary, and the recorded trace. Visitors run:

```bash
docker run --rm \
  --cap-add=SYS_PTRACE --cap-add=PERFMON \
  --security-opt seccomp=unconfined \
  ghcr.io/aletheia-works/vivarium-<slug>:latest
```

The three flags are required because `rr replay` uses `ptrace(2)`
(`SYS_PTRACE`) and opens `perf_event_open(2)` (`PERFMON` cap +
the unconfined seccomp profile to permit the syscall). None of
the three are in Docker's default profile.

## Verdict semantics

A Layer 3 page reports the **maintainer-captured** verdict
snapshot from the time the recipe was lifted (or last
re-recorded). The page surfaces:

- The verdict (`pass` / `fail`).
- The local-build image ID the snapshot ran against.
- The capture timestamp.
- The exit code and a short stdout snippet from `replay.sh`.

The visitor's own run is the **live confirmation**. A divergence
between the visitor's `docker run` and the committed snapshot is
itself a signal worth investigating — typically meaning the
visitor's host CPU lacks CPUID faulting, or their `rr` build /
kernel / container runtime is incompatible with the trace in
some way.

## Adding a new reproduction

1. Locally on a Linux/x86_64 host with a usable PMU and CPUID
   faulting, write the reproducer, run `record.sh` to capture
   the trace, verify `replay.sh` against it locally.
2. Upload the trace as a release asset under
   `aletheia-works/vivarium`, tag-pinned. Pin the URL in `trace.url`.
3. Create `<project>-<issue>/` with the files above (including a
   committed `verdict.json` from a real local container run).
4. Open a PR. CI builds the image (pulling the trace via `ADD`)
   and pushes to GHCR. CI does **not** regenerate `verdict.json` —
   the committed snapshot is what ships.
5. The gallery's index page picks up the new entry from the
   directory shape (mechanically — no per-page edit to the index).

## Phase scope

The catalogue model is settled (ADR-0011, private memo). Phase 4
landed the first concrete reproduction (`lost-update`); subsequent
recipes follow the convention above. Cross-recipe helpers will
materialise as `_layer3-shared/` once a second recipe makes the
shared shape obvious.
