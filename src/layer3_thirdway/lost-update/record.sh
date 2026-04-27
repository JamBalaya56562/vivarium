#!/usr/bin/env bash
# Vivarium Layer 3 reproduction — maintainer-side trace recorder.
#
# Records `repro` under `rr record --chaos` until a failing run is
# captured (counter < 2*N, i.e. `repro` exits 1), then packages
# the trace dir as a tar.zst ready to upload as a release asset.
#
# Run on a Linux/x86_64 host with Docker and a usable CPU PMU.
# CI cannot run this — see ADR-0011 / `src/layer3_thirdway/README.md`.
#
# Usage:
#   ./record.sh
#   # → out/lost-update-trace.tar.zst
#
# Then upload as a release asset and pin the URL in trace.url:
#   gh release create lost-update-trace-v1 out/lost-update-trace.tar.zst \
#     --repo aletheia-works/vivarium \
#     --title 'lost-update recipe trace v1' \
#     --notes 'Recorded with rr --chaos on ubuntu:24.04; for src/layer3_thirdway/lost-update/'
#
# After the release exists, rebuild the image and run it once on
# this host to regenerate verdict.json (see README.md).

set -euo pipefail

# Git Bash / MSYS auto-translates Unix-style paths to Windows
# paths when invoking native Docker, which mangles the `-v` mount.
# Disable that here so the script works the same on Windows hosts.
if [ -n "${MSYSTEM:-}" ]; then
  export MSYS_NO_PATHCONV=1
fi

RECIPE_DIR="$(cd "$(dirname "$0")" && pwd)"
OUT_DIR="${OUT_DIR:-$RECIPE_DIR/out}"
mkdir -p "$OUT_DIR"
OUT_DIR="$(cd "$OUT_DIR" && pwd)"

UBUNTU_TAG="${UBUNTU_TAG:-24.04}"
TARBALL_NAME="${TARBALL_NAME:-lost-update-trace.tar.zst}"
MAX_ATTEMPTS="${MAX_ATTEMPTS:-50}"

if ! command -v docker >/dev/null; then
  echo "error: docker not found in PATH" >&2
  exit 2
fi

# Convert the recipe source to base64 so we don't need a bind-mount
# for it (bind-mounts of source paths are the part of this script
# most likely to fight Windows / WSL2 path translation).
REPRO_B64=$(base64 -w0 < "$RECIPE_DIR/repro.c")

echo "Recording lost-update race trace inside ubuntu:${UBUNTU_TAG}"
echo "Will retry up to ${MAX_ATTEMPTS} times until rr captures a failing run."
echo "Output: ${OUT_DIR}/${TARBALL_NAME}"

docker run --rm \
  --privileged \
  -e MAX_ATTEMPTS="$MAX_ATTEMPTS" \
  -e TARBALL_NAME="$TARBALL_NAME" \
  -e REPRO_B64="$REPRO_B64" \
  -e HOST_UID="$(id -u)" \
  -e HOST_GID="$(id -g)" \
  -v "$OUT_DIR:/out" \
  "ubuntu:${UBUNTU_TAG}" \
  bash -c '
    set -euo pipefail

    apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
      software-properties-common >/dev/null
    add-apt-repository -y universe >/dev/null
    apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
      build-essential rr zstd >/dev/null

    sysctl -w kernel.perf_event_paranoid=1 >/dev/null || true

    echo "$REPRO_B64" | base64 -d > /tmp/repro.c
    gcc -O2 -pthread -o /tmp/repro /tmp/repro.c

    export _RR_TRACE_DIR=/tmp/rr-traces
    mkdir -p "$_RR_TRACE_DIR"

    captured=""
    for i in $(seq 1 "$MAX_ATTEMPTS"); do
      rm -rf "$_RR_TRACE_DIR"/*
      echo "[attempt $i/$MAX_ATTEMPTS] rr record --chaos /tmp/repro"
      set +e
      rr record --chaos /tmp/repro
      EXIT=$?
      set -e
      if [ "$EXIT" -eq 1 ]; then
        echo "[attempt $i] race captured (exit 1)"
        captured=1
        break
      fi
      echo "[attempt $i] no race (exit $EXIT); retrying"
    done

    if [ -z "$captured" ]; then
      echo "ERROR: ${MAX_ATTEMPTS} attempts exhausted without capturing the race." >&2
      echo "Try raising ITERATIONS in repro.c or MAX_ATTEMPTS." >&2
      exit 3
    fi

    tar --zstd -cf "/out/${TARBALL_NAME}" -C "$_RR_TRACE_DIR" .
    chown "${HOST_UID}:${HOST_GID}" "/out/${TARBALL_NAME}"
    ls -la "/out/${TARBALL_NAME}"
  '

echo
echo "Done. Trace: ${OUT_DIR}/${TARBALL_NAME}"
echo
echo "Next: upload to GitHub Release, build the Docker image, and"
echo "regenerate verdict.json — see README.md."
