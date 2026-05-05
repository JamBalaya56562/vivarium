#!/usr/bin/env bash
# Vivarium Layer 3 reproduction — canonical pthread lost-update race.
#
# Visitor-facing replay invocation. Runs `rr replay --autopilot`
# against the trace baked into the image at /trace and emits the
# gallery verdict by parsing the recorded program's stderr.
#
# Verdict semantics (match Layer 1 / Layer 2 — Contract v1 Revision 3):
#
#   exit 0 → `reproduced`   — bug reproduces; the recorded race
#                             re-fires deterministically on replay.
#   exit 1 → `unreproduced` — bug did not reproduce; either the trace
#                             replayed clean (no lost increments —
#                             should be impossible for this trace,
#                             captured here defensively) or
#                             `rr replay` itself errored.
#
# Why we parse stderr instead of the replay exit code:
# `rr replay --autopilot` exit code reports whether the replay run
# completed successfully (no rr-internal divergence), NOT the
# recorded program's exit code. Verified against `rr` 5.7:
# `rr record /bin/false` (exits 1) → `rr replay --autopilot` exits
# 0. So we look at the recorded stderr — `repro.c` prints
# `counter = N, expected = M, lost = K` on every run, and `K` is
# non-zero exactly when the race fired during recording (which is
# what we recorded with `rr record --chaos` on purpose).

set -uo pipefail

TRACE_DIR=$(find /trace -mindepth 1 -maxdepth 1 -type d | head -n1)
if [ -z "$TRACE_DIR" ]; then
  echo "unreproduced: no rr trace found under /trace/" >&2
  exit 1
fi

echo "Replaying trace at: $TRACE_DIR"

# Capture replay output (stdout+stderr) so we can both stream it
# back to the visitor and inspect it for the race marker.
REPLAY_LOG=$(mktemp)
trap 'rm -f "$REPLAY_LOG"' EXIT

set +e
rr replay --autopilot "$TRACE_DIR" >"$REPLAY_LOG" 2>&1
RP_EXIT=$?
set -e

# Print replay output, filtering known-benign "Metadata changed"
# replay-divergence warnings. These fire when the recording-side fs
# and the replay-side fs assign different inodes to the same library
# files (Docker layer fs vs the recording host's tmpfs); contents
# match so the replay still reproduces the recorded execution. The
# verdict check below operates on the unfiltered log, so an actual
# divergence would still be caught by the absence of the `lost = N`
# marker.
grep -vE 'TraceStream\.cc.*Metadata of .* changed: replay divergence likely, but continuing anyway' "$REPLAY_LOG" || true

if [ "$RP_EXIT" -ne 0 ]; then
  echo "unreproduced: rr replay errored (exit $RP_EXIT)" >&2
  exit 1
fi

# `repro.c` prints: `counter = N, expected = M, lost = K`. K > 0
# means the race fired during recording. The replay reproduces the
# exact same stderr deterministically, so the marker is reliable.
if grep -qE 'lost = [1-9][0-9]*' "$REPLAY_LOG"; then
  echo "reproduced: lost-update race observed in recorded trace"
  exit 0
fi

if grep -q 'lost = 0' "$REPLAY_LOG"; then
  echo "unreproduced: trace replayed clean (counter == 2*N — race did not fire during recording)" >&2
  exit 1
fi

echo "unreproduced: replay produced no recognisable lost-counter line" >&2
exit 1
