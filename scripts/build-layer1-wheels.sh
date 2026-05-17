#!/usr/bin/env bash
# Build Layer 1 fix-candidate wheels from each
# `src/layer1_wasm/<slug>/fix-candidate.json` spec.
#
# The spec lives at the recipe root (not under `wheels/`) so the same
# `fix-candidate.json` filename can describe a Ruby gem, a PHP package,
# a Rust crate, etc. in future non-Python recipes — only the per-format
# build branch in this script changes. Today the only format is the
# Python wheel below; output goes to a sibling `wheels/` directory:
#
#   <slug>/fix-candidate.json                       (TRACKED input)
#   <slug>/wheels/<package>-<version>-py3-none-any.whl  (gitignored)
#   <slug>/wheels/manifest.json   (filename + version + commit + fetched_at)
#
# Used by:
#   - `.github/workflows/deploy-docs.yml`     (CI; wheels ship in the Pages artefact)
#   - `mise run repro:build:wheels`           (local dev; wheels stay gitignored)
#
# Skips silently if no `fix-candidate.json` files exist. Per-spec
# failure halts the script (set -e) so CI surfaces the build error
# instead of deploying a stale page.
#
# See ADR-0040 (`_context/decisions/0040-layer1-fix-candidate-wheels-from-ci.md`).

set -euo pipefail
shopt -s nullglob

# Run from repo root so the glob below resolves regardless of caller cwd.
cd "$(dirname "$0")/.."

sources=(src/layer1_wasm/*/fix-candidate.json)
if [ ${#sources[@]} -eq 0 ]; then
  echo "[wheels:build] No src/layer1_wasm/*/fix-candidate.json found; nothing to build."
  exit 0
fi

for src_json in "${sources[@]}"; do
  slug_dir="$(dirname "$src_json")"
  slug="$(basename "$slug_dir")"
  # Python wheels land in a sibling `wheels/` dir; mkdir -p is
  # cheap and lets recipes that have never built before bootstrap
  # without a tracked placeholder directory.
  wheels_dir="$slug_dir/wheels"
  mkdir -p "$wheels_dir"

  pkg=$(jq -r '.package' "$src_json")
  url=$(jq -r '.source.url' "$src_json")
  ref=$(jq -r '.source.ref' "$src_json")
  # `source.subdirectory` is optional; monorepos that keep the
  # installable Python package under a subdirectory (e.g.
  # `package-python/`) rather than at the repo root need pip's PEP 508
  # `#subdirectory=<dir>` appended to the VCS spec to find
  # pyproject.toml there. Empty string = repo root (the common case).
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

  # Wipe any stale artefacts so the manifest never points at a wheel
  # filename that no longer exists.
  rm -f "$wheels_dir"/*.whl "$wheels_dir/manifest.json"

  # `uv run --no-project --with pip` spins up an ephemeral venv with
  # pip available; `pip wheel --no-deps` resolves the VCS spec and
  # builds a pure-Python wheel (Pyodide does not need a platform
  # wheel for pure-Python packages). Pinning Python 3.13 keeps the
  # build environment matched to the Pyodide runtime version this
  # project ships.
  uv run --no-project --with pip --python 3.13 -- \
    python -m pip wheel --no-deps \
    --wheel-dir "$wheels_dir" \
    "$pip_spec"

  whl=$(ls "$wheels_dir"/*.whl | head -1)
  if [ -z "$whl" ]; then
    echo "[wheels:build] $slug: pip wheel produced no .whl file." >&2
    exit 1
  fi
  filename=$(basename "$whl")
  # Wheel filename grammar: <name>-<version>-<python>-<abi>-<platform>.whl
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
