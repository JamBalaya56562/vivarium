#!/usr/bin/env bash
#MISE description="cargo fmt --check + cargo clippy --deny warnings on Layer 1 Rust crates"
set -euo pipefail
find src/layer1_wasm -name Cargo.toml -not -path '*/target/*' -print | sort | while IFS= read -r cargo_toml; do
  echo "==> cargo fmt --check + clippy $cargo_toml"
  cargo fmt --manifest-path "$cargo_toml" --check
  cargo clippy --manifest-path "$cargo_toml" --target wasm32-wasip1 --release -- -D warnings
done
