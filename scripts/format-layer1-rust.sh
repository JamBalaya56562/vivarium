#!/usr/bin/env bash
set -euo pipefail
find src/layer1_wasm -name Cargo.toml -not -path '*/target/*' -print | sort | while IFS= read -r cargo_toml; do
  echo "==> cargo fmt + clippy --fix $cargo_toml"
  cargo fmt --manifest-path "$cargo_toml"
  cargo clippy --manifest-path "$cargo_toml" --target wasm32-wasip1 --release --fix --allow-no-vcs --allow-dirty --allow-staged
done
