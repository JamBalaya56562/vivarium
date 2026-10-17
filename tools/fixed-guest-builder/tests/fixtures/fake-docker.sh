#!/bin/sh
set -eu
echo "$*" >> "$FAKE_DOCKER_LOG"

mount_for() {
  target=$1
  shift
  while [ $# -gt 0 ]; do
    if [ "$1" = "-v" ]; then
      host=${2%%:*}
      rest=${2#*:}
      if [ "${rest%%:*}" = "$target" ]; then
        echo "$host"
        return
      fi
      shift
    fi
    shift
  done
}

case "$1" in
  pull) exit "${FAKE_PULL_CODE:-0}" ;;
  image) echo "[\"docker.io/library/rust@${FAKE_REPO_DIGEST}\"]"; exit 0 ;;
  rm) exit 0 ;;
  run) ;;
  *) exit 64 ;;
esac

case "$*" in
  *"find /tree -mindepth 1 -delete"*)
    exit "${FAKE_REMOVE_CODE:-0}"
    ;;
  *"rustc -vV"*)
    printf 'rustc %s (x 2026-09-01)\nrelease: %s\n---\nrustc %s (x 2026-09-01)\ncargo %s (y 2026-08-05)\n' \
      "$FAKE_RUST" "$FAKE_RUST" "$FAKE_RUST" "$FAKE_RUST"
    exit 0
    ;;
  *"cargo fetch"*)
    home=$(mount_for /cargo "$@")
    mkdir -p "$home/registry"
    head -c "${FAKE_FETCH_BYTES:-100}" /dev/zero > "$home/registry/crates"
    exit "${FAKE_FETCH_CODE:-0}"
    ;;
  *"/builder/build.sh"*)
    if [ -n "${FAKE_BUILD_SLEEP:-}" ]; then
      sleep "$FAKE_BUILD_SLEEP"
    fi
    if [ "${FAKE_BUILD_CODE:-0}" != 0 ]; then
      echo "error: could not compile" >&2
      exit "$FAKE_BUILD_CODE"
    fi
    source=$(mount_for /work "$@")
    echo "compiling with fake cargo"
    if [ -n "${FAKE_BUILD_SYMLINK:-}" ]; then
      ln -s /mbx/targets/v1/fake "$source/target"
      exit 0
    fi
    mkdir -p "$source/target/$FAKE_TARGET/release"
    printf '\177ELFfake-binary' > "$source/target/$FAKE_TARGET/release/$FAKE_BINARY"
    exit 0
    ;;
esac
exit 65
