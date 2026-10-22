#!/usr/bin/env bash
set -euo pipefail

browser="$1"
cache_dir="$HOME/.cache/vivarium-pw-apt"
mkdir -p "$cache_dir/partial"
chmod -R a+rwX "$cache_dir"
printf 'Dir::Cache::archives "%s";\n' "$cache_dir" \
  | sudo tee /etc/apt/apt.conf.d/99-vivarium-pw-cache > /dev/null

bunx playwright install --with-deps "$browser"

sudo apt-get autoclean
sudo chown -R "$(id -u):$(id -g)" "$cache_dir"
rm -rf "$cache_dir/partial" "$cache_dir/lock"
echo "Cached $(find "$cache_dir" -maxdepth 1 -name '*.deb' | wc -l) .deb(s)."
