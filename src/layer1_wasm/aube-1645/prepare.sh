#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

fetch() {
  local name=$1 rev=$2
  local dest=".aube/${name}"
  local stamp
  stamp="${rev} $(sha256sum wasm-compat.patch | cut -d" " -f1)"
  if [ -f "${dest}/.stamp" ] && [ "$(cat "${dest}/.stamp")" = "${stamp}" ]; then
    return
  fi
  echo "==> fetch aubepkg/aube@${rev} into ${dest}"
  rm -rf "${dest}"
  mkdir -p "${dest}"
  curl -fsSL "https://codeload.github.com/aubepkg/aube/tar.gz/${rev}" |
    tar -xz -C "${dest}" --strip-components=1 \
      --wildcards --no-wildcards-match-slash \
      '*/Cargo.toml' '*/Cargo.lock' \
      '*/crates/aube-codes' '*/crates/aube-util' '*/crates/aube-manifest' \
      '*/crates/aube-settings' '*/crates/aube-lockfile'
  (cd "${dest}" && patch -p1 --quiet) <wasm-compat.patch
  echo "${stamp}" >"${dest}/.stamp"
}

# v2.6.1 — the latest release.
fetch v2.6.1 bd94e42f54d3b5e3dd102716b7197f316cb5f4ed
# Head of aubepkg/aube#1645, the fix.
fetch pr-1645 8b56aa1ef2d120525f787169f6421302c1d8b80b
