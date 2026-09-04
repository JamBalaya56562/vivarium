#!/usr/bin/env bash
set -euo pipefail

zero='0000000000000000000000000000000000000000'
if [ "$EVENT_NAME" != 'push' ] || [ -z "$BEFORE_SHA" ] || [ "$BEFORE_SHA" = "$zero" ]; then
  echo 'slugs=*' >>"$GITHUB_OUTPUT"
  echo "No base commit to compare against (event=${EVENT_NAME}); republishing every recipe."
  exit 0
fi
if ! files="$(gh api "repos/${GITHUB_REPOSITORY}/compare/${BEFORE_SHA}...${GITHUB_SHA}" \
  --paginate --jq '.files[].filename')"; then
  echo 'slugs=*' >>"$GITHUB_OUTPUT"
  echo "::warning::compare API failed; republishing every recipe."
  exit 0
fi
slugs="$(printf '%s\n' "$files" \
  | sed -n 's#^src/layer2_docker/\([^/]*\)/.*#\1#p' \
  | sort -u | tr '\n' ' ')"
echo "slugs=${slugs}" >>"$GITHUB_OUTPUT"
echo "Changed Layer 2 recipes: ${slugs:-(none)}"
