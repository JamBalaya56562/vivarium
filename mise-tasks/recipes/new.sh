#!/usr/bin/env bash
#MISE description="Scaffold a new Layer 2 recipe directory from src/layer2_docker/_template/"
#MISE dir="{{config_root}}/docs"
#USAGE arg "<project>" help="upstream project name (kebab-case, e.g. node, cpython)"
#USAGE arg "<issue>" help="upstream issue number"
#USAGE arg "<title>" help="bug title (one line)"
#USAGE flag "--base <image>" help="docker base image (e.g. node:26-slim)"
#USAGE flag "--repo <owner/repo>" help="upstream owner/repo override (default: heuristic per project)"
# shellcheck disable=SC2154  # usage_* are exported by mise from the #USAGE spec
set -euo pipefail
args=("${usage_project}" "${usage_issue}" "${usage_title}")
[ -n "${usage_base:-}" ] && args+=(--base "${usage_base}")
[ -n "${usage_repo:-}" ] && args+=(--repo "${usage_repo}")
bun run scripts/new-recipe.ts "${args[@]}"
