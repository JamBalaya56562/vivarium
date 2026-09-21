#!/usr/bin/env bash
#MISE description="ShellCheck — mise-tasks/ + scripts/ (read-only)"
set -euo pipefail
shopt -s globstar
# A recipe's repro.sh reproduces a shell footgun, so it trips the check
# that detects that footgun — SC2155 and SC2038 are the bugs two Layer 2
# recipes exist to demonstrate. src/ stays out for that reason.
shellcheck scripts/*.sh mise-tasks/**/*.sh
