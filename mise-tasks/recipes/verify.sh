#!/usr/bin/env bash
#MISE description="Verify a single Layer 2 recipe end-to-end (build + run + verdict + schema + indices + lint + docs build)"
#USAGE arg "<slug>" help="recipe slug under src/layer2_docker/ (e.g. node-63041)"
# shellcheck disable=SC2154  # usage_* are exported by mise from the #USAGE spec
set -euo pipefail

slug="${usage_slug}"
recipe_dir="src/layer2_docker/${slug}"

if [ ! -d "${recipe_dir}" ]; then
  echo "Error: ${recipe_dir} does not exist."
  echo "Available Layer 2 recipes:"
  for d in src/layer2_docker/*/; do
    name=$(basename "$d")
    case "$name" in _*) continue ;; esac
    echo "  $name"
  done
  exit 1
fi
if [ ! -f "${recipe_dir}/Dockerfile" ]; then
  echo "Error: ${recipe_dir}/Dockerfile is missing."
  exit 1
fi

echo "==> [1/6] ensure docs/ deps installed"
(cd docs && bun install --frozen-lockfile)

echo "==> [2/6] docker build ${slug}"
tag="vivarium-${slug}:dev"
docker build -t "${tag}" "${recipe_dir}"

echo "==> [3/6] docker run + capture verdict + schema-validate"
bash scripts/capture-layer2-verdict.sh "${tag}" "${recipe_dir}/verdict.json"

echo "==> [4/6] regenerate recipes / projects indices + site stats + biome check"
(cd docs && bun run generate)
mise run docs:check

echo "==> [5/6] markdown lint"
mise run markdown:check

echo "==> [6/6] docs build (rspress)"
(cd docs && bun run build)

verdict=$(jq -r '.verdict' "${recipe_dir}/verdict.json")
exit_code=$(jq -r '.exit_code' "${recipe_dir}/verdict.json")
echo
echo "✓ Recipe ${slug} verified end-to-end"
echo "  verdict: ${verdict}"
echo "  exit_code: ${exit_code}"
