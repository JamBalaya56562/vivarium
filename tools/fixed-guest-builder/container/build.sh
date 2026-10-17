#!/bin/sh
set -eu

expected_rustc=$1
expected_cargo=$2
shift 2

restore_owner() {
  if [ -n "${FGB_OWNER:-}" ]; then
    chown -R "$FGB_OWNER" /work /cargo
    if [ -d /mbx ]; then chown -R "$FGB_OWNER" /mbx; fi
  fi
}
trap restore_owner EXIT

if [ "$(rustc --version)" != "$expected_rustc" ]; then
  echo "rustc in the image differs from the key input" >&2
  exit 90
fi
if [ "$(cargo --version)" != "$expected_cargo" ]; then
  echo "cargo in the image differs from the key input" >&2
  exit 90
fi

for package in /dependency/apk/*.apk; do
  [ -e "$package" ] || continue
  apk --no-network add "$package" >/dev/null
done

if [ -n "${FGB_MBX_ARCHIVE:-}" ]; then
  mkdir -p /tmp/mbx
  tar -xzf "$FGB_MBX_ARCHIVE" -C /tmp/mbx
  mbx=$(find /tmp/mbx -type f -name mbx | head -n 1)
  if [ -z "$mbx" ]; then
    echo "mbx archive does not contain an mbx binary" >&2
    exit 91
  fi
  "$mbx" "$@"
  exit
fi

cargo "$@"
