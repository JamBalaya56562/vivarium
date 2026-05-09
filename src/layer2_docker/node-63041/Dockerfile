# Vivarium Layer 2 reproduction — Node.js Intl.DateTimeFormat with
# `calendar: 'iso8601'` silently drops the month name from formatted
# output. Regression introduced in Node v24.13.0 via an ICU update;
# upstream issue: https://github.com/nodejs/node/issues/63041 (open,
# `confirmed-bug` + `regression` labels at recipe-creation time).
#
# Pinned base: `node:26-slim`. v26 is the current stable line at
# the time of recipe authoring (latest 26.1.0, 2026-05-05) and is
# documented as still affected by the upstream `regression` label.
# Downgrading the tag here flips the verdict to `unreproduced` once
# upstream lands a fix in a later 26.x patch — the gallery's
# fix-detection sentinel role per ADR-0011 / ADR-0010.
FROM node:26-slim

COPY repro.sh /repro.sh
RUN chmod +x /repro.sh

CMD ["/repro.sh"]
