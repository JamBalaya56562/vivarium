#!/usr/bin/env bash
# Vivarium Layer 2 verdict capture — single-source helper.
#
# Runs the given Docker image, captures stdout / stderr / exit code,
# and writes a Vivarium Contract v1 `verdict.json` to the requested
# output path. The same logic is used by:
#
#   - .github/workflows/repro-regression.yml — captures the in-tree
#     recipe's verdict on every push / PR / weekly cron.
#   - .github/workflows/branch-fix-verdict.yml — Phase 6 R.2 build &
#     verify pipeline; captures a contributor-supplied branch-fix
#     image's verdict for side-by-side comparison against the
#     deployed original.
#
# Contract v1 reference:
#   docs/docs/spec/contract-v1.md
#   docs/public/spec/verdict.schema.json
#
# Usage:
#   capture_layer2_verdict.sh <image_ref> <output_path>
#       [--image-tag <tag>] [--image-digest <digest>]
#
# Required arguments:
#   <image_ref>     The image to `docker run` (e.g. "vivarium-foo:test"
#                   or "ghcr.io/contributor/foo-fix:branch").
#   <output_path>   Where to write the verdict.json file.
#
# Optional flags:
#   --image-tag     Value for verdict.json#image_tag. Defaults to
#                   <image_ref>.
#   --image-digest  Value for verdict.json#image_digest. Defaults to
#                   the empty string (Contract v1 allows "" when
#                   neither RepoDigest nor local ID is meaningful).
#
# Exit code:
#   0  — verdict.json written and schema-validated successfully.
#        The captured verdict itself ("reproduced" or "unreproduced")
#        is recorded inside the file; this script does not assert
#        which it should be — that is the caller's responsibility.
#   non-zero — could not run the image, could not write the file, or
#        the produced JSON failed schema validation.
#
# Verdict semantics (catalogue model from ADR-0010, private memo;
# vocabulary updated in Contract v1 Revision 3 by ADR-0029):
#   container exit 0 → verdict "reproduced" (bug reproduces)
#   container exit ≠ 0 → verdict "unreproduced" (bug did not reproduce)
#
# Schema validation requires `ajv` (ajv-cli) on PATH and
# `docs/public/spec/verdict.schema.json` reachable via $REPO_ROOT
# (default: the repository this script lives in).

set -euo pipefail

usage() {
  sed -n '2,40p' "$0"
}

if [ "$#" -lt 2 ]; then
  usage >&2
  exit 64
fi

image_ref="$1"
output_path="$2"
shift 2

image_tag="$image_ref"
image_digest=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --image-tag)
      image_tag="${2:?--image-tag requires a value}"
      shift 2
      ;;
    --image-digest)
      image_digest="${2:?--image-digest requires a value}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "::error::Unknown argument: $1" >&2
      usage >&2
      exit 64
      ;;
  esac
done

# Locate the repository root. Honour an explicit override
# ($REPO_ROOT) so callers from arbitrary working directories can
# reuse the helper, then fall back to the script's own location.
if [ -z "${REPO_ROOT:-}" ]; then
  REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
fi
schema="${REPO_ROOT}/docs/public/spec/verdict.schema.json"
if [ ! -f "$schema" ]; then
  echo "::error::Contract v1 schema missing at ${schema}" >&2
  exit 1
fi

# `mktemp -d` to keep stdout / stderr capture on the same volume,
# trapped for cleanup so a mid-run failure does not leak files.
tmp_dir="$(mktemp -d)"
stdout_file="${tmp_dir}/stdout"
stderr_file="${tmp_dir}/stderr"
trap 'rm -rf "$tmp_dir"' EXIT

set +e
docker run --rm "$image_ref" >"$stdout_file" 2>"$stderr_file"
exit_code=$?
set -e

if [ "$exit_code" -eq 0 ]; then
  verdict="reproduced"
else
  verdict="unreproduced"
fi

captured_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

mkdir -p "$(dirname "$output_path")"
jq -n \
  --arg verdict "$verdict" \
  --arg image_tag "$image_tag" \
  --arg image_digest "$image_digest" \
  --arg captured_at "$captured_at" \
  --arg stdout "$(cat "$stdout_file")" \
  --arg stderr_tail "$(tail -c 4096 "$stderr_file")" \
  --argjson exit_code "$exit_code" \
  '{
    contract: "v1",
    verdict: $verdict,
    exit_code: $exit_code,
    image_tag: $image_tag,
    image_digest: $image_digest,
    captured_at: $captured_at,
    stdout: $stdout,
    stderr_tail: $stderr_tail
  }' >"$output_path"

# Schema-validate the freshly-written verdict.json. Single-sources
# clause 4 of the Contract v1 conformance check; same predicate as
# the in-line ajv invocation in repro-regression.yml.
ajv validate \
  --spec=draft2020 \
  -c ajv-formats \
  -s "$schema" \
  -d "$output_path"

echo "Captured Layer 2 verdict: image=${image_ref} verdict=${verdict} exit=${exit_code} → ${output_path}"
