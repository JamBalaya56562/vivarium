#!/bin/sh
set -eu

package=$1
target=$2

restore_owner() {
  if [ -n "${FGB_OWNER:-}" ]; then chown -R "$FGB_OWNER" /cargo /out; fi
}
trap restore_owner EXIT

mkdir -p /tmp/cargo-about
tar -xzf /dependency/cargo-about.tar.gz -C /tmp/cargo-about
about=$(find /tmp/cargo-about -type f -name cargo-about | head -n 1)
if [ -z "$about" ]; then
  echo "cargo-about archive does not contain a cargo-about binary" >&2
  exit 91
fi

id=$(cargo pkgid --offline --locked --package "$package")
case "$id" in
  path+file:///work/*) ;;
  *)
    echo "package $package is not in the source: $id" >&2
    exit 92
    ;;
esac
directory=${id#path+file://}
directory=${directory%%#*}

"$about" generate --frozen --fail --format json \
  --target "$target" \
  --manifest-path "$directory/Cargo.toml" \
  --config /builder/about.toml \
  --output-file /out/about.json
