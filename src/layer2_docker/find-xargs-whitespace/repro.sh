#!/usr/bin/env bash
# Vivarium Layer 2 reproduction — `find | xargs cmd` is unsafe for
# filenames with whitespace.
#
# `xargs` splits its stdin on whitespace by default; a filename
# like "file with space.txt" is interpreted as three arguments
# ("file", "with", "space.txt") and the downstream tool fails to
# find any of them. The fix — `find … -print0 | xargs -0 …` —
# uses NUL bytes as separators, which can never appear in a
# filename.
#
# Verdict semantics (catalogue model):
#   exit 0 -> pass — naive form mishandles whitespace AND -print0
#                    form handles it correctly. The surprise
#                    reproduces.
#   exit 1 -> fail — naive form silently happens to work (which
#                    would mean xargs default semantics changed),
#                    or runtime errored.

set -uo pipefail

TESTDIR=/tmp/vivarium-find-xargs
rm -rf "$TESTDIR"
mkdir -p "$TESTDIR"

# Create a file whose name contains spaces, with content the
# downstream `grep` is asked to match.
printf 'secret payload\n' > "$TESTDIR/file with space.txt"

# --- Naive pipeline: should mishandle the space. ---
# `find` prints the path on a single line. `xargs` then splits
# that line on whitespace, so `grep` is invoked as
#   grep secret /tmp/.../file with space.txt
# i.e. it tries to grep "secret" in four files: "file", "with",
# "space.txt", and the original full path is never reached.
naive_stdout="$(
  find "$TESTDIR" -name '*.txt' | xargs grep -l 'secret' 2>/dev/null
)"
naive_exit=$?

# --- NUL-separated pipeline: should handle the space cleanly. ---
nul_stdout="$(
  find "$TESTDIR" -name '*.txt' -print0 | xargs -0 grep -l 'secret' 2>/dev/null
)"
nul_exit=$?

# Surprise reproduces iff:
#   - naive form failed to find the file (output empty OR exit
#     non-zero from grep)
#   - NUL form found the file (output non-empty AND exit 0)
naive_found_file="false"
[ -n "$naive_stdout" ] && [ "$naive_exit" -eq 0 ] && naive_found_file="true"

nul_found_file="false"
[ -n "$nul_stdout" ] && [ "$nul_exit" -eq 0 ] && nul_found_file="true"

reproduced="false"
if [ "$naive_found_file" = "false" ] && [ "$nul_found_file" = "true" ]; then
  reproduced="true"
fi

xargs_version="$(xargs --version 2>&1 | head -1)"
find_version="$(find --version 2>&1 | head -1)"

cat <<JSON
{
  "find_version": "$find_version",
  "xargs_version": "$xargs_version",
  "test_dir": "$TESTDIR",
  "naive_pipeline": "find … -name '*.txt' | xargs grep -l 'secret'",
  "naive_found_file": $naive_found_file,
  "naive_exit_code": $naive_exit,
  "nul_pipeline": "find … -name '*.txt' -print0 | xargs -0 grep -l 'secret'",
  "nul_found_file": $nul_found_file,
  "nul_exit_code": $nul_exit,
  "reproduced": $reproduced
}
JSON

if [ "$reproduced" = "true" ]; then
  echo "verdict=reproduced — naive find|xargs splits on whitespace; -print0/-0 fixes it" >&2
  exit 0
fi

echo "verdict=unreproduced — pipelines behaved unexpectedly (naive=$naive_found_file, nul=$nul_found_file)" >&2
exit 1
