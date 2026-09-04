#!/usr/bin/env bash
set -euo pipefail
shopt -s nullglob
for dockerfile in src/layer2_docker/*/Dockerfile; do
  slug_dir=$(dirname "$dockerfile")
  slug=$(basename "$slug_dir")
  case "$slug" in _*) continue ;; esac
  tag="vivarium-${slug}:dev"
  echo "==> capture verdict.json for ${slug}"
  bash scripts/capture_layer2_verdict.sh "$tag" "${slug_dir}/verdict.json"
done
echo "Done. Refresh http://localhost:3000/vivarium/repro/<project>/<issue_path>/ to see captured verdicts."
