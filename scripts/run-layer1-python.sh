#!/usr/bin/env bash
set -euo pipefail
shopt -s nullglob
matched=0
failed=()
for f in src/layer1_wasm/*/repro.py; do
  matched=1
  echo "== $f =="
  code=0
  mise exec uv -- uv run "$f" || code=$?
  if [ "$code" -ne 0 ]; then
    echo "[repro:native:python] $f exited $code" >&2
    failed+=("$f")
  fi
done
if [ "$matched" -eq 0 ]; then
  echo "[repro:native:python] no src/layer1_wasm/*/repro.py found — nothing to run" >&2
fi
if [ "${#failed[@]}" -ne 0 ]; then
  echo "[repro:native:python] ${#failed[@]} script(s) did not exit 0:" >&2
  printf '  %s\n' "${failed[@]}" >&2
  exit 1
fi
