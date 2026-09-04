#!/usr/bin/env bash
set -euo pipefail
slug="${1}"
image="${2}"
expected="${3}"
gh workflow run branch-fix-verdict.yml \
  --repo aletheia-works/vivarium \
  --field "slug=${slug}" \
  --field "branch_image=${image}" \
  --field "expected_verdict=${expected}"
echo "Triggered. Tail with:"
echo "  gh run list --repo aletheia-works/vivarium --workflow=branch-fix-verdict.yml --limit 1"
echo "  gh run watch --repo aletheia-works/vivarium <run-id>"
