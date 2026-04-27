# scripts/phase4

Helpers for **Phase 4** (Layer 3 — record-replay & deterministic).
The catalogue convention is in
[`src/layer3_thirdway/README.md`](../../src/layer3_thirdway/README.md);
this directory holds the maintainer-side scripts that the catalogue
itself does not need to ship.

## Stage A — `rr replay` PoC

Tracking issue:
[#100](https://github.com/aletheia-works/vivarium/issues/100).

Why a maintainer-side script is needed: GitHub Actions hosted Ubuntu
runners do not expose CPU performance counters, so `rr record`
cannot run there. Stage A proves that `rr replay` *can* run on
`ubuntu-latest`, against a trace recorded externally on a Linux/x86_64
host with a usable PMU.

### Flow

```
[ maintainer host ]                    [ aletheia-works/vivarium ]              [ ubuntu-latest GHA runner ]
─────────────────────                   ──────────────────────────                ──────────────────────────
record-poc-trace.sh                                                                
  └─ rr record /bin/true                                                          
     inside ubuntu:24.04 docker                                                   
  └─ tar.zst the trace dir                                                        
  └─ → out/phase4-poc-trace.tar.zst                                               
                                                                                  
gh release create phase4-poc-trace-v1                                             
   out/phase4-poc-trace.tar.zst   ──→  release asset stored                       
                                                                                  
gh workflow run phase4-rr-replay-poc.yml ─────────────────────────────────────→   .github/workflows/
                                                                                    phase4-rr-replay-poc.yml
                                                                                  ─ apt install rr
                                                                                  ─ gh release download
                                                                                  ─ tar -xf trace.tar.zst
                                                                                  ─ rr replay --autopilot
                                                                                  ─ verdict: PASS / FAIL
```

### Run

On a Linux/x86_64 host with Docker and a usable CPU PMU
(bare-metal or PMU-virt-enabled VM):

```bash
./scripts/phase4/record-poc-trace.sh
# → out/phase4-poc-trace.tar.zst

gh release create phase4-poc-trace-v1 out/phase4-poc-trace.tar.zst \
  --repo aletheia-works/vivarium \
  --title 'Phase 4 PoC trace v1' \
  --notes 'rr trace of /bin/true on ubuntu:24.04; for issue #100 Stage A'

gh workflow run phase4-rr-replay-poc.yml --repo aletheia-works/vivarium
```

### Exit criterion

- **PASS** — Stage A succeeds. Issue #100 proceeds to Stage B (first
  recipe under `src/layer3_thirdway/<slug>/`).
- **FAIL** — `rr replay` itself does not work on `ubuntu-latest`.
  ADR-0011 fallback applies: Layer 3 verdict snapshots move out of CI
  and become a maintainer-local artefact committed alongside each
  recipe. Update ADR-0011 and the layer3 catalogue contract
  accordingly.

## Stage B and beyond

Per-recipe recording will follow the same pattern but record an
upstream reproducer's failure, not `/bin/true`. The recording script
for each recipe lives at `src/layer3_thirdway/<slug>/record.sh` —
this `scripts/phase4/` directory is for cross-recipe helpers only
and is expected to stay small.
