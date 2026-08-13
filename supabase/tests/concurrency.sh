#!/usr/bin/env bash
#
# Matrix 1, 4, 5 and 11 as genuine races: two overlapping database sessions,
# not two sequential calls. Session A holds its transaction open while session
# B runs into it, which is the only way to prove that the row lock (and not
# statement ordering) is what serialises the two employees.
#
# Invoked by run-db-tests.sh; runnable on its own against an already-built
# verification database.
set -uo pipefail
export LC_ALL=C LANG=C

PGBIN="${PGBIN:-/usr/local/opt/postgresql@17/bin}"
[ -d "$PGBIN" ] && export PATH="$PGBIN:$PATH"
SOCK="${KIARA_PGSOCK:-/tmp/kiara-pgsock}"
PORT="${KIARA_PGPORT:-55432}"
DB="${KIARA_TEST_DB:-kiara_verify}"
TENANT='2ba8f6c8-aff9-4147-8f13-cdcb732de698'

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
status=0

run_sql() { psql -h "$SOCK" -p "$PORT" -U postgres -d "$DB" -X -q -t -A "$@"; }

pass() { echo "    ok  $1"; }
fail() { echo "    FAILED: $1"; status=1; }

expect_contains() { # file needle label
  if grep -q -- "$2" "$1"; then pass "$3"; else
    fail "$3 (expected '$2' in: $(tr '\n' ' ' < "$1" | cut -c1-200))"
  fi
}

# --- Matrix 1: two employees edit the same order at the same version --------
run_sql -c "update public.driver_orders set version = 1, dispatch_state = 'idle',
  status = 'pending', active_dispatch_command_id = null
  where id = 'e0000000-0000-0000-0000-000000000001'" >/dev/null

cat > "$WORK/a.sql" <<SQL
begin;
select public.kiara_command_update_driver_order(
  '$TENANT'::uuid, 'e0000000-0000-0000-0000-000000000001'::uuid,
  1, gen_random_uuid(),
  '22222222-2222-2222-2222-222222222222'::uuid,
  'a0000000-0000-0000-0000-000000000002'::uuid,
  'agent', '{"durationMinutes": 75}'::jsonb) is not null as a_committed;
select pg_sleep(2);
commit;
SQL

cat > "$WORK/b.sql" <<SQL
begin;
select public.kiara_command_update_driver_order(
  '$TENANT'::uuid, 'e0000000-0000-0000-0000-000000000001'::uuid,
  1, gen_random_uuid(),
  '33333333-3333-3333-3333-333333333333'::uuid,
  'a0000000-0000-0000-0000-000000000003'::uuid,
  'agent', '{"durationMinutes": 200}'::jsonb);
commit;
SQL

run_sql -f "$WORK/a.sql" > "$WORK/a.out" 2>&1 &
a_pid=$!
sleep 0.7
run_sql -f "$WORK/b.sql" > "$WORK/b.out" 2>&1
wait $a_pid

expect_contains "$WORK/a.out" "^t$" "concurrent edit: the first employee commits"
expect_contains "$WORK/b.out" "ORDER_VERSION_CONFLICT" \
  "concurrent edit: the second employee is refused with a version conflict"
duration="$(run_sql -c "select duration_minutes from public.driver_orders
  where id = 'e0000000-0000-0000-0000-000000000001'")"
if [ "$duration" = "75" ]; then
  pass "concurrent edit: the loser's value never lands"
else
  fail "concurrent edit: expected duration 75, found $duration"
fi

# --- Same idempotency key arriving twice, concurrently ----------------------
KEY='0e000000-0000-0000-0000-000000000001'
VERSION="$(run_sql -c "select version from public.driver_orders
  where id = 'e0000000-0000-0000-0000-000000000001'")"

for s in a b; do
  cat > "$WORK/key_$s.sql" <<SQL
begin;
select public.kiara_command_update_driver_order(
  '$TENANT'::uuid, 'e0000000-0000-0000-0000-000000000001'::uuid,
  $VERSION, '$KEY'::uuid,
  '22222222-2222-2222-2222-222222222222'::uuid,
  'a0000000-0000-0000-0000-000000000002'::uuid,
  'agent', '{"durationMinutes": 95}'::jsonb) as result;
select pg_sleep(1);
commit;
SQL
done

run_sql -f "$WORK/key_a.sql" > "$WORK/key_a.out" 2>&1 &
ka=$!
sleep 0.5
run_sql -f "$WORK/key_b.sql" > "$WORK/key_b.out" 2>&1
wait $ka

applied="$(run_sql -c "select count(*) from public.operation_events
  where idempotency_key = '$KEY'")"
if [ "$applied" = "1" ]; then
  pass "duplicate key race: exactly one audit event is written"
else
  fail "duplicate key race: expected 1 audit event, found $applied"
fi
if grep -q "replayed" "$WORK/key_b.out" || grep -q "COMMAND_IN_PROGRESS" "$WORK/key_b.out"; then
  pass "duplicate key race: the loser replays or is told the command is running"
else
  fail "duplicate key race: unexpected loser output: $(tr '\n' ' ' < "$WORK/key_b.out" | cut -c1-200)"
fi

# --- Matrix 4: two dispatch commands race for the same order ----------------
run_sql -c "update public.driver_orders set version = 1, dispatch_state = 'idle',
  status = 'pending', active_dispatch_command_id = null
  where id = 'e0000000-0000-0000-0000-000000000001'" >/dev/null

dispatch_sql() { # actor_user team_member sleep
  cat <<SQL
begin;
select public.kiara_command_prepare_order_dispatch(
  '$TENANT'::uuid, 'e0000000-0000-0000-0000-000000000001'::uuid,
  1, gen_random_uuid(),
  '$1'::uuid, '$2'::uuid, 'agent',
  'b0000000-0000-0000-0000-000000000001'::uuid,
  'c0000000-0000-0000-0000-000000000001'::uuid,
  'one_way', 400, '+966500000011', 'رسالة السائق المؤكدة',
  '+966500000001', 'confirmed specialist message') is not null as prepared;
select pg_sleep($3);
commit;
SQL
}

dispatch_sql '22222222-2222-2222-2222-222222222222' \
  'a0000000-0000-0000-0000-000000000002' 2 > "$WORK/d_a.sql"
dispatch_sql '33333333-3333-3333-3333-333333333333' \
  'a0000000-0000-0000-0000-000000000003' 0 > "$WORK/d_b.sql"

run_sql -f "$WORK/d_a.sql" > "$WORK/d_a.out" 2>&1 &
da=$!
sleep 0.7
run_sql -f "$WORK/d_b.sql" > "$WORK/d_b.out" 2>&1
wait $da

expect_contains "$WORK/d_a.out" "^t$" "dispatch race: the first caller reserves the order"
if grep -qE "ORDER_VERSION_CONFLICT|ORDER_DISPATCH_IN_PROGRESS" "$WORK/d_b.out"; then
  pass "dispatch race: the second caller is refused"
else
  fail "dispatch race: second caller was not refused: $(tr '\n' ' ' < "$WORK/d_b.out" | cut -c1-200)"
fi
queued="$(run_sql -c "select count(*) from public.outbox_events
  where aggregate_id = 'e0000000-0000-0000-0000-000000000001'
    and payload->>'recipientRole' = 'driver'")"
if [ "$queued" = "1" ]; then
  pass "dispatch race: exactly one driver message is queued"
else
  fail "dispatch race: expected 1 queued driver message, found $queued"
fi

# --- Matrix 5: two workers claim the same outbox event ----------------------
EVENT="$(run_sql -c "select id from public.outbox_events
  where aggregate_id = 'e0000000-0000-0000-0000-000000000001'
    and payload->>'recipientRole' = 'driver' and status = 'pending' limit 1")"
CMD="$(run_sql -c "select command_id from public.outbox_events where id = '$EVENT'")"

for s in a b; do
  cat > "$WORK/claim_$s.sql" <<SQL
begin;
select public.kiara_claim_outbox_event(
  '$TENANT'::uuid, '$CMD'::uuid, '$EVENT'::uuid) as claim;
select pg_sleep(1);
commit;
SQL
done

run_sql -f "$WORK/claim_a.sql" > "$WORK/claim_a.out" 2>&1 &
ca=$!
sleep 0.4
run_sql -f "$WORK/claim_b.sql" > "$WORK/claim_b.out" 2>&1
wait $ca

wins=$(cat "$WORK/claim_a.out" "$WORK/claim_b.out" | grep -c '"claimed": true')
if [ "$wins" = "1" ]; then
  pass "outbox claim race: exactly one worker claims the send"
else
  fail "outbox claim race: expected exactly 1 winner, found $wins"
fi

# --- Matrix 11: overlapping Rekaz pulls serialise on the tenant lock --------
rekaz_sql() { # run_id sleep
  cat <<SQL
begin;
select public.kiara_apply_rekaz_snapshot(
  '$TENANT'::uuid, '$1'::uuid,
  '11111111-1111-1111-1111-111111111111'::uuid,
  'a0000000-0000-0000-0000-000000000001'::uuid,
  jsonb_build_array(
    jsonb_build_object(
      'sourceId', 'C1', 'sourceOrderId', 'o-C1', 'payloadHash', 'ch1',
      'arrivalAt', date_trunc('day', now()) + interval '11 hours',
      'customerPhone', '+966555000021', 'customerName', 'عميلة تزامن',
      'status', 'Confirmed', 'payload', '{"id":"C1"}'::jsonb)),
  date_trunc('day', now()) - interval '1 day',
  date_trunc('day', now()) + interval '61 days') as result;
select pg_sleep($2);
commit;
SQL
}

rekaz_sql '0f000000-0000-0000-0000-00000000000a' 2 > "$WORK/r_a.sql"
rekaz_sql '0f000000-0000-0000-0000-00000000000b' 0 > "$WORK/r_b.sql"

run_sql -f "$WORK/r_a.sql" > "$WORK/r_a.out" 2>&1 &
ra=$!
sleep 0.7
run_sql -f "$WORK/r_b.sql" > "$WORK/r_b.out" 2>&1
wait $ra

added_total=$(run_sql -c "select coalesce(sum(added_count), 0)
  from public.rekaz_sync_runs
  where id in ('0f000000-0000-0000-0000-00000000000a',
               '0f000000-0000-0000-0000-00000000000b')")
if [ "$added_total" = "1" ]; then
  pass "rekaz race: the advisory lock serialises the two pulls (C1 added once)"
else
  fail "rekaz race: expected a single add across both runs, found $added_total"
fi
changes=$(run_sql -c "select count(*) from public.rekaz_changes
  where source_id = 'C1' and change_type = 'added'")
if [ "$changes" = "1" ]; then
  pass "rekaz race: one 'added' change record, not two"
else
  fail "rekaz race: expected 1 added change, found $changes"
fi

exit "$status"
