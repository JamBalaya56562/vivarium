#!/usr/bin/env bash
# Phase 4 Stage A — record a trivial rr trace for the GHA replay PoC.
#
# Records `rr record /bin/true` inside an `ubuntu:24.04` Docker
# container so the libc / kernel ABI matches the `ubuntu-latest` GHA
# runner that will replay it. Outputs a tarball ready to upload as a
# GitHub Release asset.
#
# Why this script lives outside CI: GitHub Actions hosted runners do
# not expose CPU performance counters to the guest, so `rr record`
# cannot run there. The maintainer records once on a Linux/x86_64
# host with a usable PMU; CI only replays. See ADR-0011 (private
# memo) and `_context/decisions/0011-phase4-first-vertical-rr.md`.
#
# Prerequisites (host):
#   - Linux/x86_64
#   - CPU PMU exposed (bare-metal or PMU-virt-enabled VM)
#   - Docker Engine running, current user able to invoke it
#
# Usage:
#   ./scripts/phase4/record-poc-trace.sh
#   # → ./out/phase4-poc-trace.tar.zst
#
# Then upload + dispatch the workflow:
#   gh release create phase4-poc-trace-v1 ./out/phase4-poc-trace.tar.zst \
#     --repo aletheia-works/vivarium \
#     --title 'Phase 4 PoC trace v1' \
#     --notes 'rr trace of /bin/true on ubuntu:24.04; for issue #100 Stage A'
#   gh workflow run phase4-rr-replay-poc.yml --repo aletheia-works/vivarium

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT_DIR="${OUT_DIR:-$REPO_ROOT/out}"
mkdir -p "$OUT_DIR"
OUT_DIR="$(cd "$OUT_DIR" && pwd)"

UBUNTU_TAG="${UBUNTU_TAG:-24.04}"
TARBALL_NAME="${TARBALL_NAME:-phase4-poc-trace.tar.zst}"

if ! command -v docker >/dev/null; then
  echo "error: docker not found in PATH" >&2
  exit 2
fi

echo "Recording rr trace inside ubuntu:${UBUNTU_TAG} (host: $(uname -m))"
echo "Output: ${OUT_DIR}/${TARBALL_NAME}"
echo

docker run --rm \
  --privileged \
  -e TARBALL_NAME="$TARBALL_NAME" \
  -e HOST_UID="$(id -u)" \
  -e HOST_GID="$(id -g)" \
  -v "$OUT_DIR:/out" \
  "ubuntu:${UBUNTU_TAG}" \
  bash -c '
    set -euo pipefail

    echo "[1/4] Enabling universe + installing rr + zstd ..."
    apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
      software-properties-common >/dev/null
    add-apt-repository -y universe >/dev/null
    apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq rr zstd >/dev/null
    rr --version

    echo "[2/4] Tuning kernel.perf_event_paranoid (best-effort) ..."
    sysctl -w kernel.perf_event_paranoid=1 >/dev/null || true

    echo "[3/4] rr record /bin/true ..."
    export _RR_TRACE_DIR=/tmp/rr-traces
    mkdir -p "$_RR_TRACE_DIR"
    rr record /bin/true

    echo "[4/4] Packing trace into /out/${TARBALL_NAME} ..."
    tar --zstd -cf "/out/${TARBALL_NAME}" -C "$_RR_TRACE_DIR" .
    chown "${HOST_UID}:${HOST_GID}" "/out/${TARBALL_NAME}"
    ls -la "/out/${TARBALL_NAME}"
  '

echo
echo "Done. Next steps:"
echo
echo "  gh release create phase4-poc-trace-v1 \"${OUT_DIR}/${TARBALL_NAME}\" \\"
echo "    --repo aletheia-works/vivarium \\"
echo "    --title 'Phase 4 PoC trace v1' \\"
echo "    --notes 'rr trace of /bin/true on ubuntu:${UBUNTU_TAG}; for issue #100 Stage A'"
echo
echo "  gh workflow run phase4-rr-replay-poc.yml --repo aletheia-works/vivarium"
