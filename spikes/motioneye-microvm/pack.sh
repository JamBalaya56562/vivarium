#!/usr/bin/env bash
set -euo pipefail

repo=${1:?usage: pack.sh <owner/repo> <commit>}
commit=${2:?usage: pack.sh <owner/repo> <commit>}
here=$(cd "$(dirname "$0")" && pwd)
out="$here/build/$commit"

rm -rf "$out"
mkdir -p "$out/motioneye"
curl -sSfL "https://codeload.github.com/$repo/tar.gz/$commit" | tar -xz -C "$out/motioneye" --strip-components=1
cp -r "$here/Dockerfile" "$here/preview" "$out/"
(cd "$out" && rm -f ../"$commit".zip && python3 -c '
import os, sys, zipfile
with zipfile.ZipFile(sys.argv[1], "w", zipfile.ZIP_DEFLATED) as z:
    for root, _, files in os.walk("."):
        for f in files:
            p = os.path.join(root, f)
            info = zipfile.ZipInfo.from_file(p, os.path.normpath(p))
            with open(p, "rb") as src:
                z.writestr(info, src.read(), zipfile.ZIP_DEFLATED)
' ../"$commit".zip)
echo "$out"
