#!/usr/bin/env bash
#MISE description="Build every Layer 2 image + capture verdict.json into the slug dir (local dev parity with the CI snapshot — lets `bun --cwd docs run dev` show real verdicts)"
#MISE depends=["docker:build"]
set -euo pipefail
shopt -s nullglob
for dockerfile in src/layer2_docker/*/Dockerfile; do
  slug_dir=$(dirname "$dockerfile")
  slug=$(basename "$slug_dir")
  case "$slug" in _*) continue ;; esac
  tag="vivarium-${slug}:dev"
  echo "==> capture verdict.json for ${slug}"
  mise run verdict:capture-layer2 "$tag" "${slug_dir}/verdict.json"
done
echo "Done. Refresh http://localhost:3000/vivarium/repro/<project>/<issue_path>/ to see captured verdicts."
