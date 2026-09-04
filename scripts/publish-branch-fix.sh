#!/usr/bin/env bash
set -euo pipefail
slug="${1}"
tag="${4}"
dockerfile="${2}"
context="${3}"
user="${GHCR_USER:-$(gh api user --jq .login)}"
img="ghcr.io/${user,,}/vivarium-${slug}-fix:${tag}"
echo "==> docker build $img"
docker build -t "$img" -f "$dockerfile" "$context"
echo "==> docker push $img"
docker push "$img"
docker logout ghcr.io
echo "$img"
