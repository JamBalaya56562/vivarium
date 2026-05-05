#!/bin/sh
# Vivarium Layer 2 reproduction — PostgreSQL "lost update" under
# default READ COMMITTED isolation.
#
# Reproduction shape (textbook lost update):
#   Tx1: SELECT value -> v1; (sleep) ; UPDATE SET value = v1 + 1
#   Tx2: SELECT value -> v2;          UPDATE SET value = v2 + 1
# Both transactions read the same value (0) before either has
# committed; both write 1; the second commit silently overwrites
# the first. Final value is 1, expected is 2 — one increment is
# lost.
#
# Verdict semantics (per ADR-0008 / catalogue model):
#   exit 0 -> pass (lost update reproduces)
#   exit 1 -> fail (both increments preserved, or runtime error)
#
# The wrapper starts postgres in the background using its own
# entrypoint, waits for `pg_isready`, runs the test, then
# terminates postgres so the container exits cleanly.

set -u

# Start postgres in the background. The bundled docker-entrypoint.sh
# handles initdb, role creation, etc., on first boot.
/usr/local/bin/docker-entrypoint.sh postgres &
PG_PID=$!

# Wait up to 30 s for the server to accept connections.
i=0
until pg_isready -h localhost -U postgres >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -gt 60 ]; then
    echo "postgres did not become ready within 30s" >&2
    kill -TERM "$PG_PID" 2>/dev/null
    wait "$PG_PID" 2>/dev/null
    exit 2
  fi
  sleep 0.5
done

export PGPASSWORD=vivarium
PSQL="psql -h localhost -U postgres -d postgres -v ON_ERROR_STOP=1 -X -q"

# Setup: a single-row counter table.
$PSQL <<'SQL'
DROP TABLE IF EXISTS counters;
CREATE TABLE counters (id INT PRIMARY KEY, value INT NOT NULL);
INSERT INTO counters (id, value) VALUES (1, 0);
SQL

# Tx1 runs in the background: read, sleep 1s, write value+1.
( V1=$($PSQL -t -A -c "SELECT value FROM counters WHERE id = 1")
  sleep 1
  $PSQL -c "UPDATE counters SET value = $V1 + 1 WHERE id = 1" >/dev/null
) &
TX1_PID=$!

# Give Tx1 a head start (~0.3s) so it definitely reads first.
sleep 0.3

# Tx2 runs in the foreground: read, write value+1, immediately.
V2=$($PSQL -t -A -c "SELECT value FROM counters WHERE id = 1")
$PSQL -c "UPDATE counters SET value = $V2 + 1 WHERE id = 1" >/dev/null

# Wait for Tx1 to finish its sleep + write.
wait "$TX1_PID"

# Inspect the final state.
FINAL=$($PSQL -t -A -c "SELECT value FROM counters WHERE id = 1" | tr -d ' ')
PG_VERSION=$($PSQL -t -A -c "SHOW server_version" | tr -d ' ')

# Stop postgres so the container exits.
kill -TERM "$PG_PID" 2>/dev/null
wait "$PG_PID" 2>/dev/null

# Emit a JSON envelope on stdout for downstream tooling. The
# verdict.json that CI generates wraps this with the image digest
# + run timestamp + exit code.
cat <<JSON
{
  "postgres_version": "$PG_VERSION",
  "isolation_level": "read committed (default)",
  "expected_final": 2,
  "actual_final": $FINAL,
  "lost_update": $([ "$FINAL" = "1" ] && echo "true" || echo "false"),
  "reproduced": $([ "$FINAL" = "1" ] && echo "true" || echo "false")
}
JSON

if [ "$FINAL" = "1" ]; then
  echo "verdict=reproduced — lost update reproduces under default READ COMMITTED isolation" >&2
  exit 0
fi

if [ "$FINAL" = "2" ]; then
  echo "verdict=unreproduced — both increments preserved (final=2). Postgres did not exhibit the lost-update anomaly." >&2
  exit 1
fi

echo "verdict=unreproduced — unexpected final value: $FINAL" >&2
exit 1
