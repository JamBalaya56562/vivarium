#!/usr/bin/env bash
set -euo pipefail

dest="docs/doc_build/repro"
ja_dest="docs/doc_build/ja/repro"
if [ ! -d src/layer1_wasm ]; then
  echo "No src/layer1_wasm/ directory; skipping bundling."
  exit 0
fi
mkdir -p "$dest"
pages_prefix="https://${GITHUB_REPOSITORY_OWNER}.github.io/${GITHUB_REPOSITORY##*/}/repro/"
layer1_projects="$(jq -r '.recipes[] | select(.layer == 1) | .project' \
  docs/site/public/api/recipes.json | sort -u)"
for project in $layer1_projects; do
  mkdir -p "$dest/$project"
  for shared in src/layer1_wasm/_*/; do
    [ -d "$shared" ] || continue
    shared_name="$(basename "$shared")"
    echo "Staging Layer 1 shared module: ${shared_name} → ${dest}/${project}/${shared_name}"
    cp -R "${shared%/}" "$dest/$project/$shared_name"
  done
done
for recipe in src/layer1_wasm/*/; do
  slug="$(basename "$recipe")"
  case "$slug" in
    _*)
      continue
      ;;
  esac
  if [ ! -f "${recipe}index.html" ]; then
    echo "Skipping ${recipe} (no index.html)"
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
  echo "Bundling reproduction: ${slug} → ${dest}/${rel}/"
  mkdir -p "$dest/$rel"
  cp -R "${recipe}." "$dest/$rel/"
  if [ -f "${recipe}index.ja.html" ]; then
    echo "Bundling JA reproduction: ${slug} → ${ja_dest}/${rel}/"
    mkdir -p "$ja_dest/$rel"
    cp "${recipe}index.ja.html" "$ja_dest/$rel/index.html"
    rm -f "$dest/$rel/index.ja.html"
  fi
done
ls -la "$dest" || true
