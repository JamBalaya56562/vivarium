# Vivarium Layer 3 reproduction — canonical pthread lost-update race.
#
# Single-stage build: install rr, compile the reproducer, pull the
# pre-recorded trace from the pinned release asset (see trace.url),
# bake everything into the image. Visitor runs:
#
#   docker run --rm \
#     --cap-add=SYS_PTRACE --cap-add=PERFMON \
#     --security-opt seccomp=unconfined \
#     ghcr.io/aletheia-works/vivarium-lost-update:latest
#
# which executes `replay.sh` → `rr replay --autopilot` against the
# baked-in trace. The three flags exist because `rr replay` opens
# perf counters (CAP_PERFMON + the unconfined seccomp profile to
# allow `perf_event_open(2)`) and uses `ptrace(2)` (SYS_PTRACE);
# none of these are in the default Docker capability + seccomp set.
# Verdict comes from `replay.sh` parsing the recorded stderr for
# the race marker (see `replay.sh` for why the replay exit code
# alone is not enough).
#
# The image is built and pushed by CI. The trace is recorded once
# by the maintainer on a Linux/x86_64 host with a usable PMU (see
# `record.sh`). Per ADR-0011, GitHub Actions hosted runners cannot
# record (no PMU virtualisation) and cannot replay (no CPUID
# faulting); the verdict snapshot in `verdict.json` is generated
# locally by the maintainer on the same host that recorded the
# trace, then committed alongside this recipe.

FROM ubuntu:24.04

RUN set -eux; \
    apt-get update -qq; \
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
      software-properties-common >/dev/null; \
    add-apt-repository -y universe >/dev/null; \
    apt-get update -qq; \
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
      build-essential rr zstd ca-certificates >/dev/null; \
    rm -rf /var/lib/apt/lists/*; \
    rr --version

WORKDIR /recipe

COPY repro.c replay.sh trace.url ./
RUN gcc -O2 -pthread -o repro repro.c && chmod +x replay.sh

# Pull the pinned trace artifact at build time. Keep this URL in
# sync with `trace.url`; the file is the human-readable pin, this
# `ADD` is the build-time fetch.
ADD https://github.com/aletheia-works/vivarium/releases/download/lost-update-trace-v1/lost-update-trace.tar.zst /trace.tar.zst
RUN mkdir -p /trace && tar --zstd -xf /trace.tar.zst -C /trace && rm /trace.tar.zst

ENTRYPOINT ["/recipe/replay.sh"]
