#!/usr/bin/env bash
#MISE description="Run every src/layer1_wasm/*/Cargo.toml baseline crate against the host Rust toolchain (auto-discovered)"
set -euo pipefail
shopt -s nullglob
matched=0
failed=()
for cargo_toml in src/layer1_wasm/*/Cargo.toml; do
  matched=1
  echo "== $cargo_toml =="
  code=0
  cargo run --release --manifest-path "$cargo_toml" || code=$?
  if [ "$code" -ne 0 ]; then
    echo "[repro:native:rust] $cargo_toml exited $code" >&2
    failed+=("$cargo_toml")
  fi
done
if [ "$matched" -eq 0 ]; then
  echo "[repro:native:rust] no src/layer1_wasm/*/Cargo.toml found — nothing to run" >&2
fi
if [ "${#failed[@]}" -ne 0 ]; then
  echo "[repro:native:rust] ${#failed[@]} crate(s) did not exit 0:" >&2
  printf '  %s\n' "${failed[@]}" >&2
  exit 1
fi
