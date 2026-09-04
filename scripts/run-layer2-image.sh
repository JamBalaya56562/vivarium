#!/usr/bin/env bash
if [ -z "${SLUG:-}" ]; then
  echo "usage: SLUG=<recipe> mise run docker:run"
  echo "available:"
  for d in src/layer2_docker/*/; do
    name="$(basename "$d")"
    case "$name" in _*) continue ;; esac
    echo "  $name"
  done
  exit 1
fi
docker run --rm "vivarium-${SLUG}:dev"
