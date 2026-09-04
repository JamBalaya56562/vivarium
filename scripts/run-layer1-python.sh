#!/usr/bin/env bash
set -euo pipefail
shopt -s nullglob
matched=0
for f in src/layer1_wasm/*/repro.py; do
  matched=1
  echo "== $f =="
  mise exec uv -- uv run "$f"
done
if [ "$matched" -eq 0 ]; then
  echo "[repro:native:python] no src/layer1_wasm/*/repro.py found — nothing to run" >&2
fi
