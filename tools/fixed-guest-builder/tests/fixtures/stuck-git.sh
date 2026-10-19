#!/bin/sh
# A clone that writes past the size limit and then ignores SIGTERM, as a git
# caught in its signal handler does; every other command goes to the real git.
set -eu
if [ "$1" = "clone" ]; then
  # Ignored before anything is written, so the stop always meets it.
  trap '' TERM
  for target; do :; done
  mkdir -p "$target"
  echo 'more than ten bytes' > "$target/pack"
  while :; do sleep 1; done
fi
exec "$FAKE_REAL_GIT" "$@"
