#!/usr/bin/env bash
set -euo pipefail
find src/layer1_wasm -name Cargo.toml -not -path '*/target/*' -print | sort | while IFS= read -r cargo_toml; do
  crate_dir=$(dirname "$cargo_toml")
  if [ -f "${crate_dir}/recipe.json" ]; then
    recipe_dir="$crate_dir"
  else
    recipe_dir=$(dirname "$crate_dir")
  fi
  echo "==> cargo build $crate_dir"
  cargo build --release --target wasm32-wasip1 --manifest-path "$cargo_toml"
  for wasm in "${crate_dir}"/target/wasm32-wasip1/release/*.wasm; do
    cp "$wasm" "${recipe_dir}/$(basename "$wasm")"
  done
done
