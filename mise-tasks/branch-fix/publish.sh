#!/usr/bin/env bash
#MISE description="Build a branch-fix image and push to ghcr.io/<user>/vivarium-<slug>-fix:<tag>; auto-logout after push"
#MISE depends=["ghcr:login"]
#USAGE arg "<slug>" help="recipe slug under src/layer2_docker/ (e.g. node-63041)"
#USAGE arg "<tag>" help="image tag, typically the fix commit SHA (e.g. 04d86dab)"
#USAGE arg "<dockerfile>" help="path to the branch-fix Dockerfile"
#USAGE arg "<context>" help="docker build context dir"
# shellcheck disable=SC2154  # usage_* are exported by mise from the #USAGE spec
set -euo pipefail
slug="${usage_slug}"
tag="${usage_tag}"
dockerfile="${usage_dockerfile}"
context="${usage_context}"
user="${GHCR_USER:-$(gh api user --jq .login)}"
img="ghcr.io/${user,,}/vivarium-${slug}-fix:${tag}"
echo "==> docker build $img"
docker build -t "$img" -f "$dockerfile" "$context"
echo "==> docker push $img"
docker push "$img"
docker logout ghcr.io
echo "$img"
