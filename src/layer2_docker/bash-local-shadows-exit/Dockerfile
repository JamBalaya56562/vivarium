# Vivarium Layer 2 reproduction — `bash`'s `local` builtin
# silently shadows the exit code of command substitution, which
# defeats `set -e` and causes silent failures in production
# scripts.
#
# The bash maintainer considers this expected behaviour, so the
# page is a "real-world surprise you should know about" entry
# rather than an open upstream issue.
FROM bash:5.3

COPY repro.sh /repro.sh
RUN chmod +x /repro.sh

# `bash:*` images set `bash` itself as ENTRYPOINT; strip it so
# our `repro.sh` runs as the container command.
ENTRYPOINT []
CMD ["/repro.sh"]
