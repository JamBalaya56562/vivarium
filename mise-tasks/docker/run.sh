#!/usr/bin/env bash
#MISE description="Run a Layer 2 reproduction image built by docker:build"
#USAGE arg "<slug>" help="recipe slug under src/layer2_docker/ (e.g. postgres-lost-update)"
# shellcheck disable=SC2154  # usage_* are exported by mise from the #USAGE spec
set -euo pipefail
docker run --rm "vivarium-${usage_slug}:dev"
