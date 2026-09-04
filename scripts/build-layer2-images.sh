#!/usr/bin/env bash
set -euo pipefail
shopt -s nullglob
for dockerfile in src/layer2_docker/*/Dockerfile; do
  slug_dir=$(dirname "$dockerfile")
  slug=$(basename "$slug_dir")
  case "$slug" in _*) continue ;; esac
  echo "==> docker build vivarium-${slug}:dev"
  docker build -t "vivarium-${slug}:dev" "$slug_dir"
done
