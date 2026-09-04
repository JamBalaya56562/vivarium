# Vivarium Layer 2 reproduction — `flock(2)` is advisory only.
#
# Programs that don't ALSO call `flock` ignore the lock entirely.
# A common production surprise: developers reach for `flock` to
# "protect" a file, then are surprised when `cat`, `grep`, `sed`,
# or any other tool reads it freely while the lock is held.
#
# `util-linux` provides the `flock(1)` CLI wrapper around
# `flock(2)`; `bash` is for the wrapper script.
FROM alpine:3.24

RUN apk add --no-cache util-linux bash

COPY repro.sh /repro.sh
RUN chmod +x /repro.sh

CMD ["/repro.sh"]
