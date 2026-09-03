#!/usr/bin/env bash

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

if [ -z "${REPO_ROOT:-}" ]; then
  REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
fi
schema="${REPO_ROOT}/docs/site/public/spec/verdict.schema.json"
if [ ! -f "$schema" ]; then
  echo "::error::Contract v1 schema missing at ${schema}" >&2
  exit 1
fi

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

"${AJV_BIN:-ajv}" validate \
  --spec=draft2020 \
  -c ajv-formats \
  -s "$schema" \
  -d "$output_path"

echo "Captured Layer 2 verdict: image=${image_ref} verdict=${verdict} exit=${exit_code} → ${output_path}"
