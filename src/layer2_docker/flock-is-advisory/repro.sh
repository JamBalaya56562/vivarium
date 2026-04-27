#!/usr/bin/env bash
# Vivarium Layer 2 reproduction — `flock(2)` is advisory only.
#
# Linux file locks created with `flock(2)` (and the `flock(1)`
# CLI on top of it) are **advisory**: only programs that
# explicitly call `flock` see the lock. Programs that don't —
# `cat`, `cp`, `grep`, every editor's "save", every web server's
# log writer — ignore the lock and read or write the file freely.
#
# Many developers assume the lock is mandatory. It is not. This
# page lets you confirm that, end-to-end, in seconds.
#
# Verdict semantics (catalogue model from ADR-0010):
#   exit 0 -> pass — surprise reproduces (lock held by flock,
#                    yet `cat` reads the file regardless)
#   exit 1 -> fail — kernel suddenly enforces flock as mandatory
#                    (it won't, but the verdict captures that
#                    branch honestly)

set -uo pipefail

LOCKFILE=/tmp/vivarium.lock
echo "secret content protected by flock" > "$LOCKFILE"

kernel_version="$(uname -r)"
flock_version="$(flock --version 2>&1 | head -1)"

# Hold an EXCLUSIVE flock on the file in the background for 2s.
( flock -x "$LOCKFILE" -c "sleep 2" ) &
LOCK_PID=$!

# Give the background process time to acquire the lock.
sleep 0.3

# Confirm the lock is genuinely held: a second `flock -n -x`
# (non-blocking exclusive) on the same file should fail.
if flock -n -x "$LOCKFILE" -c "echo 'unexpected: lock not held'" >/dev/null 2>&1; then
  lock_actually_held=false
else
  lock_actually_held=true
fi

# The surprise: `cat` does NOT call `flock`, so it reads the file
# despite our exclusive lock.
content_seen_by_cat="$(cat "$LOCKFILE")"

# Wait for the background lock holder to release.
wait "$LOCK_PID"

# Did `cat` see the file content? If yes, it bypassed the lock.
if [ -n "$content_seen_by_cat" ]; then
  cat_bypassed_lock=true
else
  cat_bypassed_lock=false
fi

# Reproduces iff (a) the lock was genuinely held and (b) cat read
# the file anyway.
if [ "$lock_actually_held" = "true" ] && [ "$cat_bypassed_lock" = "true" ]; then
  reproduced=true
else
  reproduced=false
fi

cat <<JSON
{
  "kernel_version": "$kernel_version",
  "flock_version": "$flock_version",
  "exclusive_lock_held": $lock_actually_held,
  "cat_read_locked_file": $cat_bypassed_lock,
  "content_seen_by_cat": "$content_seen_by_cat",
  "reproduced": $reproduced
}
JSON

if [ "$reproduced" = "true" ]; then
  echo "verdict=pass — flock(2) is advisory; cat(1) bypassed the exclusive lock" >&2
  exit 0
fi

echo "verdict=fail — unexpected (lock_held=$lock_actually_held, cat_bypassed=$cat_bypassed_lock)" >&2
exit 1
