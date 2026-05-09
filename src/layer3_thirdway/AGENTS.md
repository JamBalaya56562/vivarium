# AGENTS.md — Layer 3 (rr / record-replay) recipe authoring

> Operational checklist for AI agents adding a new Layer 3 recipe.
> Read [`README.md`](README.md) first — especially §"Why no replay
> in CI" — and only then this file. Layer 3 has the most
> idiosyncratic workflow of the three layers; skipping the README
> will lead to a broken PR.

---

## 1. Hard preconditions (host capability)

Layer 3 recipe authoring requires a **maintainer host** with:

- Linux/x86_64 (rr does not support arm64 or Windows or macOS).
- A CPU with an exposed PMU (Intel/AMD bare metal, or VMs that
  pass through performance counters — Hyper-V / WSL2 / GHA hosted
  Ubuntu **do not** qualify; see ADR-0011).
- CPUID faulting enabled in the kernel (Intel Ivy Bridge+ or
  modern AMD with stock recent Linux meets this).

CI cannot record OR replay (both capabilities are missing on
GHA's Hyper-V runners — confirmed empirically Phase 4 Stage A,
2026-04-27). The maintainer records locally, ships the trace as a
GitHub Release asset, and commits a tracked `verdict.json`.

If your environment does not meet these preconditions, **stop
here and hand the recipe back to a maintainer** — agent-only
authoring of Layer 3 recipes is not currently supported.

## 2. Slug rules

Same regex as Layer 1 / 2: `^([a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)*?)-(\d+)$`.

Note: the existing `lost-update` recipe has no upstream issue
number (it reproduces a canonical race, not a tracker entry); it
relies on a `PROJECT_OVERRIDES` entry in
[`generate-recipes-index.ts`](../../docs/scripts/generate-recipes-index.ts)
to map `lost-update` → project `pthread`. Numeric-issue recipes
do not need an override; they parse cleanly.

## 3. Required files

Per [`README.md`](README.md) §"Per-page convention":

```text
src/layer3_thirdway/<slug>/
├── Dockerfile        ← installs rr, builds reproducer, ADD trace.url
├── record.sh         ← documents how the trace was captured (not run by CI)
├── replay.sh         ← visitor-facing rr replay; verdict semantics
├── trace.url         ← pinned URL of the GitHub Release asset (the trace)
├── README.md         ← upstream issue + docker run + verdict contract
├── verdict.json      ← TRACKED here (unique to Layer 3) — captured locally
└── out/              ← gitignored scratch for record.sh's local outputs
```

`verdict.json` being **tracked** is the key Layer 3 deviation
from Layer 2. CI does not regenerate it — see README §"Why no
replay in CI" for the full reasoning.

## 4. Data files to update

Same as the other layers:

```text
docs/data/recipe-facets.json   ← add a row keyed by <slug>
docs/data/projects.json        ← add a row keyed by <project> (if new)
```

Regenerate indices:

```bash
cd docs && mise exec -- bun run generate-index && mise exec -- bun run generate-project-pages
```

## 5. Authoring workflow (maintainer host)

```bash
# A. Write the reproducer + record.sh + replay.sh.
cd src/layer3_thirdway/<slug>

# B. Capture the trace locally (record.sh's job).
./record.sh                       # produces out/<name>.tar.zst

# C. Upload the trace as a GitHub Release asset under
#    aletheia-works/vivarium, tag-pinned (e.g. trace-<slug>-v1).
gh release create trace-<slug>-v1 out/<name>.tar.zst \
  --repo aletheia-works/vivarium \
  --notes "Layer 3 trace artefact for src/layer3_thirdway/<slug>"

# D. Pin the asset URL in trace.url. Never inline-include the
#    trace in git — they are large and content-addressable.
echo "https://github.com/aletheia-works/vivarium/releases/download/trace-<slug>-v1/<name>.tar.zst" \
  > trace.url

# E. Build the image locally (pulls the trace via Dockerfile ADD).
docker build -t vivarium-<slug>:dev .

# F. Replay locally to capture verdict.json.
docker run --rm \
  --cap-add=SYS_PTRACE --cap-add=PERFMON \
  --security-opt seccomp=unconfined \
  vivarium-<slug>:dev > /tmp/replay-stdout.txt
# Hand-craft verdict.json per Contract v1 schema — see
# docs/public/spec/verdict.schema.json. Validate locally:
ajv validate --spec=draft2020 -c ajv-formats \
  -s ../../docs/public/spec/verdict.schema.json \
  -d verdict.json
```

## 6. Local validation (before PR)

```bash
# 1. Image build (CI will do this too — fail fast locally).
cd src/layer3_thirdway/<slug>
docker build -t vivarium-<slug>:dev .

# 2. Replay locally (rr must work on the host — see §1).
docker run --rm \
  --cap-add=SYS_PTRACE --cap-add=PERFMON \
  --security-opt seccomp=unconfined \
  vivarium-<slug>:dev

# 3. Schema validation of tracked verdict.json (CI will repeat).
cd ../../.. && cd docs && \
  mise exec -- bun x ajv-cli@5 validate \
    --spec=draft2020 -c ajv-formats \
    -s public/spec/verdict.schema.json \
    -d ../src/layer3_thirdway/<slug>/verdict.json

# 4. Lint + docs build.
cd .. && mise run docs:check && mise run markdown:check
cd docs && mise exec -- bun run build
```

## 7. Commit + PR

- **Commit scope**: `feat(layer3)` — established by PR #106.
- **Commit subject template**:
  `feat(layer3): <slug> reproduction (<one-line bug summary>)`
- The PR diff includes the tracked `verdict.json`, but **not** the
  trace itself (which lives in the Release asset).

## 8. Common pitfalls

- **rr capability gaps on CI** — do not try to "make CI replay
  work". It will not. The maintainer-captured `verdict.json` is
  the verdict CI surfaces.
- **Container caps** — the visitor-facing `docker run` needs
  `--cap-add=SYS_PTRACE --cap-add=PERFMON --security-opt
  seccomp=unconfined`. Document this in the recipe README, not
  just in the AGENTS.md.
- **Trace asset versioning** — re-recording a trace requires
  bumping the Release asset tag (`trace-<slug>-v2` etc.) and
  updating `trace.url`. Mutating an existing tagged asset breaks
  reproducibility for visitors who already pulled the image.
- **Gitignored scratch** — `<slug>/out/` is gitignored
  (`.gitignore` line under "Layer 3 (rr record-replay) build
  artefacts"). Do not commit the trace or any intermediate output.

## 9. When this checklist is wrong

If you discover the checklist diverges from current behaviour
(e.g. ADR-0011's reasoning changes, GHA gains PMU exposure),
update this file in the same PR rather than working around it.
