#!/usr/bin/env bash
# Vivarium Layer 2 reproduction — bash `local` shadows the exit
# code of command substitution, defeating `set -e`.
#
# Documented behaviour, not a code defect: `local` is a builtin
# whose own exit code (0 on successful local-variable creation)
# overrides the exit code of the right-hand-side command
# substitution. `set -e` only sees `local`'s 0, so a failing
# command on the RHS goes silent.
#
# Verdict semantics (catalogue model from ADR-0010):
#   exit 0 -> pass — the surprise reproduces (set -e bypassed when
#                    using `local`)
#   exit 1 -> fail — bash now propagates the RHS exit code through
#                    `local`, or runtime errored
#
# Two parallel demos are run inside subshells so a non-zero exit
# from the demo doesn't kill our wrapper before we can compare.

set -uo pipefail

bash_version="$(bash --version | head -1)"
echo "Runtime: ${bash_version}"
echo

# Demo 1: bare assignment with command substitution.
# `set -e` should kill the subshell when `false` runs, since the
# assignment statement carries `false`'s exit code (1).
echo "=== Demo 1: bare assignment ==="
(
  set -e
  x=$(false)
  echo "this should NOT print — set -e should have killed us at the assignment"
)
status_bare=$?
echo "subshell exited with status ${status_bare}"
echo

# Demo 2: `local` assignment with command substitution.
# `local` is the most recent command; its own exit code (0) shadows
# the RHS `false`'s exit code, so `set -e` does NOT trigger and
# the function continues silently.
echo "=== Demo 2: local assignment inside a function ==="
demo_with_local() {
  local x=$(false)
  echo "this DID print — local masked false's exit code, set -e was bypassed"
  echo "value of x: '${x}'"
}
(
  set -e
  demo_with_local
)
status_local=$?
echo "subshell exited with status ${status_local}"
echo

# Verdict: bug reproduces iff
#   (a) bare assignment + set -e correctly killed the subshell
#       (status_bare != 0), AND
#   (b) `local` + set -e silently continued (status_local == 0).
reproduced=false
if [ "${status_bare}" -ne 0 ] && [ "${status_local}" -eq 0 ]; then
  reproduced=true
fi

cat <<JSON
{
  "bash_version": "${bash_version}",
  "status_bare_assignment": ${status_bare},
  "status_local_assignment": ${status_local},
  "reproduced": ${reproduced}
}
JSON

if [ "${reproduced}" = "true" ]; then
  echo "verdict=reproduced — \`local\` shadows command-substitution exit code; set -e silently bypassed" >&2
  exit 0
fi

echo "verdict=unreproduced — bash did not exhibit the surprise (bare=${status_bare}, local=${status_local})" >&2
exit 1
