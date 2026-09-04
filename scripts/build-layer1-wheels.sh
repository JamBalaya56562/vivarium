#!/usr/bin/env bash

set -euo pipefail
shopt -s nullglob

cd "$(dirname "$0")/.."

sources=(src/layer1_wasm/*/fix-candidate.json)
if [ ${#sources[@]} -eq 0 ]; then
  echo "[wheels:build] No src/layer1_wasm/*/fix-candidate.json found; nothing to build."
  exit 0
fi

for src_json in "${sources[@]}"; do
  slug_dir="$(dirname "$src_json")"
  slug="$(basename "$slug_dir")"
  wheels_dir="$slug_dir/wheels"
  mkdir -p "$wheels_dir"

  pkg=$(jq -r '.package' "$src_json")
  url=$(jq -r '.source.url' "$src_json")
  ref=$(jq -r '.source.ref' "$src_json")
  subdirectory=$(jq -r '.source.subdirectory // ""' "$src_json")
  upstream_pr=$(jq -r '.upstream_pr // ""' "$src_json")
  purpose=$(jq -r '.purpose // ""' "$src_json")

  if [ -z "$pkg" ] || [ "$pkg" = "null" ] || [ -z "$url" ] || [ "$url" = "null" ] || [ -z "$ref" ] || [ "$ref" = "null" ]; then
    echo "[wheels:build] $src_json missing required field (package / source.url / source.ref); skipping." >&2
    continue
  fi

  pip_spec="${pkg} @ git+${url}@${ref}"
  if [ -n "$subdirectory" ]; then
    pip_spec="${pip_spec}#subdirectory=${subdirectory}"
  fi

  echo "[wheels:build] $slug: building $pip_spec"

  rm -f "$wheels_dir"/*.whl "$wheels_dir/manifest.json"

  uv run --no-project --with pip -- \
    python -m pip wheel --no-deps \
    --wheel-dir "$wheels_dir" \
    "$pip_spec"

  whl=$(ls "$wheels_dir"/*.whl | head -1)
  if [ -z "$whl" ]; then
    echo "[wheels:build] $slug: pip wheel produced no .whl file." >&2
    exit 1
  fi
  filename=$(basename "$whl")
  version=$(echo "$filename" | sed -E 's/^[^-]+-([^-]+)-.*/\1/')
  commit=$(git ls-remote "$url" "$ref" | awk '{print $1}')
  fetched_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)

  jq -n \
    --arg pkg "$pkg" \
    --arg filename "$filename" \
    --arg version "$version" \
    --arg purpose "$purpose" \
    --arg url "$url" \
    --arg ref "$ref" \
    --arg subdirectory "$subdirectory" \
    --arg commit "$commit" \
    --arg pip_spec "$pip_spec" \
    --arg upstream_pr "$upstream_pr" \
    --arg fetched_at "$fetched_at" \
    --argjson schema_version 1 \
    '{
      schema_version: $schema_version,
      package: $pkg,
      filename: $filename,
      version: $version,
      purpose: $purpose,
      source: ({
        type: "git",
        url: $url,
        ref: $ref,
        commit: $commit,
        spec: $pip_spec
      } + (if $subdirectory == "" then {} else {subdirectory: $subdirectory} end)),
      upstream_pr: $upstream_pr,
      fetched_at: $fetched_at
    }' >"$wheels_dir/manifest.json"

  echo "[wheels:build] $slug: wrote $filename (commit $commit)"
done
