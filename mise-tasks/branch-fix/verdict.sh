#!/usr/bin/env bash
#MISE description="Trigger aletheia-works/vivarium branch-fix-verdict.yml against a published image (thin wrapper over `gh workflow run`)"
#USAGE arg "<slug>" help="recipe slug under src/layer2_docker/"
#USAGE arg "<image>" help="published image ref (e.g. ghcr.io/<user>/vivarium-<slug>-fix:<sha>)"
#USAGE flag "--expected <verdict>" help="expected branch-fix verdict (default: unreproduced)" default="unreproduced"
# shellcheck disable=SC2154  # usage_* are exported by mise from the #USAGE spec
set -euo pipefail
slug="${usage_slug}"
image="${usage_image}"
expected="${usage_expected}"
gh workflow run branch-fix-verdict.yml \
  --repo aletheia-works/vivarium \
  --field "slug=${slug}" \
  --field "branch_image=${image}" \
  --field "expected_verdict=${expected}"
echo "Triggered. Tail with:"
echo "  gh run list --repo aletheia-works/vivarium --workflow=branch-fix-verdict.yml --limit 1"
echo "  gh run watch --repo aletheia-works/vivarium <run-id>"
