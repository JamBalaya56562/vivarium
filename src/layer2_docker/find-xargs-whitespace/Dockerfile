# Vivarium Layer 2 reproduction — `find … | xargs cmd` is unsafe
# for filenames that contain whitespace.
#
# A canonical Unix scripting gotcha: `xargs` splits its input on
# whitespace by default, so a filename like "file with space.txt"
# is interpreted as three separate arguments. Pipelines built on
# the naive `find … | xargs …` shape silently break in production
# the moment a filename contains a space. The fix —
# `find … -print0 | xargs -0 …` — is well-known but easy to
# forget and impossible for `set -e` to catch.
#
# GNU findutils is installed for `-print0`. BusyBox `find`
# supports it too, but using the GNU one keeps the verdict
# identical across alpine and Debian-style distros.
FROM alpine:3.24

RUN apk add --no-cache findutils bash grep

COPY repro.sh /repro.sh
RUN chmod +x /repro.sh

CMD ["/repro.sh"]
