#!/usr/bin/env bash
set -euo pipefail

dest="docs/doc_build/repro"
ja_dest="docs/doc_build/ja/repro"
if [ ! -d src/layer2_docker ]; then
  echo "No src/layer2_docker/ directory; skipping Layer 2 bundling."
  exit 0
fi
shopt -s nullglob
mkdir -p "$dest"
pages_prefix="https://${GITHUB_REPOSITORY_OWNER}.github.io/${GITHUB_REPOSITORY##*/}/repro/"
layer2_projects="$(jq -r '.recipes[] | select(.layer == 2) | .project' \
  docs/site/public/api/recipes.json | sort -u)"
for project in $layer2_projects; do
  mkdir -p "$dest/$project"
  for shared in src/layer2_docker/_*/; do
    [ -d "$shared" ] || continue
    shared_name="$(basename "$shared")"
    case "$shared_name" in _template|_assets|_shared) continue ;; esac
    echo "Staging Layer 2 shared module: ${shared_name} → ${dest}/${project}/${shared_name}"
    cp -R "${shared%/}" "$dest/$project/$shared_name"
  done
  if [ -d "src/layer1_wasm/_shared" ]; then
    echo "Staging Layer 1 _shared/ for Layer 2 project: ${dest}/${project}/_shared"
    cp -R "src/layer1_wasm/_shared" "$dest/$project/_shared"
  fi
  if [ -d "src/layer1_wasm/_assets" ]; then
    echo "Staging Layer 1 _assets/ for Layer 2 project: ${dest}/${project}/_assets"
    cp -R "src/layer1_wasm/_assets" "$dest/$project/_assets"
  fi
done
for entry in src/layer2_docker/*/; do
  slug="$(basename "$entry")"
  case "$slug" in
    _*)
      continue
      ;;
  esac
  if [ ! -f "${entry}Dockerfile" ]; then
    echo "Skipping ${entry} (no Dockerfile)"
    continue
  fi
  page_url="$(jq -r --arg s "$slug" \
    '.recipes[] | select(.slug == $s) | .page_url' \
    docs/site/public/api/recipes.json)"
  if [ -z "$page_url" ] || [ "$page_url" = "null" ]; then
    echo "ERROR: ${slug} not found in docs/site/public/api/recipes.json"
    exit 1
  fi
  rel="${page_url#"${pages_prefix}"}"
  rel="${rel%/}"
  echo "Bundling Layer 2 reproduction: ${slug} → ${dest}/${rel}/"
  mkdir -p "$dest/$rel"
  cp -R "${entry}." "$dest/$rel/"
  if [ -f "${entry}index.ja.html" ]; then
    echo "Bundling JA reproduction: ${slug} → ${ja_dest}/${rel}/"
    mkdir -p "$ja_dest/$rel"
    cp "${entry}index.ja.html" "$ja_dest/$rel/index.html"
    rm -f "$dest/$rel/index.ja.html"
  fi
done
ls -la "$dest" || true
