# Vivarium Layer 2 reproduction — PostgreSQL "lost update" under
# default READ COMMITTED isolation.
#
# Pinned base image: postgres:16-alpine. The Postgres team rolls
# new patch tags into this stream; pin to the major+os to keep
# the image reasonably stable while still picking up security
# fixes that don't change isolation semantics.
#
# We override the standard postgres entrypoint with `repro.sh`,
# which (i) starts the bundled postgres in the background using
# its own entrypoint, (ii) waits for the server to become ready,
# (iii) runs two concurrent application-side increments under
# READ COMMITTED, and (iv) exits 0 if the lost-update anomaly
# reproduces, 1 otherwise.
FROM postgres:16-alpine

# Standard postgres image expects these to be set on first boot.
# `vivarium` is a literal placeholder; nothing else uses the DB.
ENV POSTGRES_PASSWORD=vivarium
ENV POSTGRES_DB=postgres

# `bash` is not in the alpine postgres image by default; the
# reproduction is intentionally written in POSIX `sh` to avoid
# the extra dependency. `coreutils` would be needed only for
# `mktemp -d`, which we avoid.

COPY repro.sh /repro.sh
RUN chmod +x /repro.sh

# Override `postgres`'s default entrypoint. `repro.sh` itself
# launches the standard `docker-entrypoint.sh postgres` in the
# background, so the postgres image's first-boot initdb still
# runs as expected.
ENTRYPOINT []
CMD ["/repro.sh"]
