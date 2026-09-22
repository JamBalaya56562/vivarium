#!/usr/bin/env bash
#MISE description="Run a Layer 2 image, write its Contract v1 verdict.json, and validate it against the schema"
#USAGE arg "<image>" help="image ref to run (e.g. ghcr.io/aletheia-works/vivarium-<slug>:latest)"
#USAGE arg "<output>" help="path to write the verdict.json to"
#USAGE flag "--image-tag <tag>" help="image_tag to record in the verdict (default: the image ref that was run)"
#USAGE flag "--image-digest <digest>" help="image_digest to record in the verdict (default: empty)"
# shellcheck disable=SC2154  # usage_* are exported by mise from the #USAGE spec
set -euo pipefail

image_ref="${usage_image}"
output_path="${usage_output}"
image_tag="${usage_image_tag:-$image_ref}"
image_digest="${usage_image_digest:-}"

schema="docs/site/public/spec/verdict.schema.json"
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

jsonschema validate --format-assertion "$schema" "$output_path"

echo "Captured Layer 2 verdict: image=${image_ref} verdict=${verdict} exit=${exit_code} → ${output_path}"
