# Vivarium Layer 2 reproduction — `bash`'s `local` builtin
# silently shadows the exit code of command substitution, which
# defeats `set -e` and causes silent failures in production
# scripts.
#
# Pinned base image: `bash:5.2` — the documented surprise
# survives every modern bash major; we pin to one specific
# release so the snapshot is stable. The bash maintainer
# considers this expected behaviour (see the page README for
# the standards trail), so the page is a "real-world surprise
# you should know about" entry, not an "Open upstream issue"
# entry.
FROM bash:5.2

COPY repro.sh /repro.sh
RUN chmod +x /repro.sh

# `bash:*` images set `bash` itself as ENTRYPOINT; strip it so
# our `repro.sh` runs as the container command.
ENTRYPOINT []
CMD ["/repro.sh"]
