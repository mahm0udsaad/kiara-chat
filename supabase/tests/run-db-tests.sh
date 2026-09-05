#!/usr/bin/env bash
#
# Applies every pending Kiara migration to a throwaway Postgres database and
# runs the operational test matrix against it.
#
# This is an isolated verification database, not a Supabase project: it never
# connects to a hosted environment, so it cannot touch production. It proves
# migration SQL, constraints, command-function logic, privilege grants and
# lock/idempotency behaviour. It cannot prove PostgREST exposure, GoTrue JWT
# minting, real pg_cron scheduling or pg_net delivery.
#
#   ./supabase/tests/run-db-tests.sh
#
# Requires a local Postgres 17 client/server (brew install postgresql@17).
set -euo pipefail

# macOS ships a locale that makes the postmaster multithread during startup.
export LC_ALL=C LANG=C

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PGBIN="${PGBIN:-/usr/local/opt/postgresql@17/bin}"
[ -d "$PGBIN" ] && export PATH="$PGBIN:$PATH"

# The socket directory must stay short: Postgres caps the socket path at 103
# bytes, which a nested per-session scratch directory blows straight through.
SOCK="${KIARA_PGSOCK:-/tmp/kiara-pgsock}"
PORT="${KIARA_PGPORT:-55432}"
PGDATA_DIR="${KIARA_PGDATA:-${TMPDIR:-/tmp}/kiara-pgdata}"
DB="${KIARA_TEST_DB:-kiara_verify}"

psql_run() { psql -h "$SOCK" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q "$@"; }

start_server_if_needed() {
  if psql -h "$SOCK" -p "$PORT" -U postgres -tAc 'select 1' >/dev/null 2>&1; then
    return
  fi
  if [ ! -d "$PGDATA_DIR/base" ]; then
    echo "==> initdb $PGDATA_DIR"
    mkdir -p "$PGDATA_DIR"
    initdb -D "$PGDATA_DIR" -U postgres --auth=trust -E UTF8 --locale=C >/dev/null
  fi
  mkdir -p "$SOCK"
  echo "==> starting postgres on $SOCK:$PORT"
  pg_ctl -D "$PGDATA_DIR" \
    -o "-p $PORT -k $SOCK -c listen_addresses=" \
    -l "$PGDATA_DIR/server.log" start >/dev/null
  sleep 2
}

start_server_if_needed

echo "==> rebuilding $DB from zero"
dropdb -h "$SOCK" -p "$PORT" -U postgres --if-exists "$DB"
createdb -h "$SOCK" -p "$PORT" -U postgres "$DB"

echo "==> harness"
for f in "$REPO_ROOT"/supabase/tests/harness/*.sql; do
  echo "    $(basename "$f")"
  psql_run -d "$DB" -f "$f" >/dev/null
done

echo "==> migrations (timestamp order)"
for f in $(ls "$REPO_ROOT"/supabase/migrations/2026*.sql | sort); do
  # Everything before 20260811 is folded into the production baseline stub
  # (01_production_baseline.sql); those earlier migrations touch tables the
  # stub deliberately omits, so re-applying them here would fail. Timestamps
  # are fixed-width, so a lexical compare is a numeric one.
  if [[ "$(basename "$f")" < "20260811" ]]; then
    continue
  fi
  echo "    $(basename "$f")"
  case "$(basename "$f")" in
    *field_reminders_supabase_cron*|*campaigns_drain_cron*)
      # pg_cron/pg_net are Supabase-managed and cannot be installed into a
      # stock build. The stubs in the harness stand in for them, so only the
      # two CREATE EXTENSION lines are dropped — the rest runs verbatim.
      sed -E '/create extension if not exists (pg_cron|pg_net);/d' "$f" \
        | psql_run -d "$DB" >/dev/null
      ;;
    *)
      psql_run -d "$DB" -f "$f" >/dev/null
      ;;
  esac
done

echo "==> seed"
psql_run -d "$DB" -f "$REPO_ROOT/supabase/tests/seed.sql" >/dev/null

echo "==> test matrix"
status=0
for f in $(ls "$REPO_ROOT"/supabase/tests/cases/*.sql | sort); do
  name="$(basename "$f")"
  out="$(mktemp)"
  if psql -h "$SOCK" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q -d "$DB" \
      -f "$f" >"$out" 2>&1; then
    echo "--- $name  ($(grep -c '  ok  ' "$out") assertions passed)"
  else
    echo "--- $name  FAILED"
    sed -e 's/^/    /' "$out" | grep -E 'ASSERTION|ERROR' | head -5
    status=1
  fi
  rm -f "$out"
done

echo "==> concurrency scenarios"
if ! "$REPO_ROOT/supabase/tests/concurrency.sh"; then
  status=1
fi

if [ "$status" -eq 0 ]; then
  echo "==> ALL DATABASE TESTS PASSED"
else
  echo "==> DATABASE TESTS FAILED"
fi
exit "$status"
