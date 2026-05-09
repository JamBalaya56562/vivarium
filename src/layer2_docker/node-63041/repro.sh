#!/usr/bin/env bash
# Vivarium Layer 2 reproduction — Node.js Intl.DateTimeFormat with
# `calendar: 'iso8601'` silently drops the month name (and other
# month-related parts) from `dateStyle: 'full'` output.
#
# Upstream: https://github.com/nodejs/node/issues/63041
# Regression range: introduced in Node v24.13.0; reproduces on
# v24.13+, v25.x, and v26.x as of recipe creation. The bug lives
# in the bundled ICU; see issue body for trace.
#
# Verdict semantics (catalogue model from ADR-0010):
#   exit 0 -> reproduced — formatted string is missing the month
#                          name "September".
#   exit 1 -> unreproduced — month name present, fix has landed
#                            (or environment differs).

set -uo pipefail

node_version="$(node --version)"
echo "Runtime: node ${node_version}"
echo

# The reproduction. A `dateStyle: 'full'` formatter with
# `calendar: 'iso8601'` should include the month name; under the
# bug it is silently elided. We pick a date in September so the
# expected substring is unambiguous in en-US.
output="$(node -e "
const dtf = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'full',
  timeStyle: 'long',
  timeZone: 'UTC',
  calendar: 'iso8601',
});
process.stdout.write(dtf.format(new Date('2024-09-09T08:00:00Z')));
")"

echo "Formatted output: '${output}'"
echo

# Surprise reproduces iff the output does NOT contain the month
# name "September". A correctly-formatted `dateStyle: 'full'` for
# 2024-09-09 in en-US must include the month label, regardless of
# calendar choice.
reproduced=false
case "${output}" in
  *September*)
    ;;
  *)
    reproduced=true
    ;;
esac

# Escape the formatted output for embedding in JSON. node -p emits
# a JSON string literal (with surrounding quotes) for any input.
output_json="$(node -p "JSON.stringify(process.argv[1])" -- "${output}")"

cat <<JSON
{
  "node_version": "${node_version}",
  "formatted_output": ${output_json},
  "expected_substring": "September",
  "reproduced": ${reproduced}
}
JSON

if [ "${reproduced}" = "true" ]; then
  echo "verdict=reproduced — Intl.DateTimeFormat with calendar:'iso8601' dropped the month name (#63041)" >&2
  exit 0
fi

echo "verdict=unreproduced — month name present in formatted output, bug appears fixed" >&2
exit 1
