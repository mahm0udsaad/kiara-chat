#!/usr/bin/env bash
# Phase 3+4 — auth users, then Kiara's rows, from the shared project into the
# dedicated one. Streams table-by-table over `\copy` so nothing round-trips
# through a JSON layer: vector(768) embeddings, jsonb and tstz all keep their
# exact text representation.
#
# Every id is preserved, so foreign keys, the pinned KIARA_RESTAURANT_ID and
# existing storage paths all stay valid.
#
# Re-runnable: each table is truncated on the target before it is loaded, so a
# failed run can simply be repeated. It never writes to the source.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$HERE/.env.migration"

: "${SOURCE_DB_URL:?Set SOURCE_DB_URL in .env.migration}"
: "${TARGET_DB_URL:?Set TARGET_DB_URL in .env.migration}"
T="${KIARA_RESTAURANT_ID}"

SRC=(psql "$SOURCE_DB_URL" -v ON_ERROR_STOP=1 --no-psqlrc -q)
DST=(psql "$TARGET_DB_URL" -v ON_ERROR_STOP=1 --no-psqlrc -q)

# The five identities that own Kiara data: the owner, both team members and
# both field-staff logins. Anything else in auth.users belongs to other tenants
# and must not follow us across.
#
# Must stay on ONE line: \copy is a psql meta-command, so it ends at the first
# newline. Wrapped over several lines, psql runs line 1 as a broken \copy and
# then executes the remainder as ordinary SQL, piping those result rows into the
# target's COPY stream — which surfaces as "extra data after last expected
# column" and looks like a schema mismatch rather than a quoting bug.
USER_FILTER="id IN (SELECT owner_id FROM public.restaurants WHERE id = '$T' UNION SELECT user_id FROM public.team_members WHERE restaurant_id = '$T' UNION SELECT auth_user_id FROM public.field_staff_accounts WHERE restaurant_id = '$T')"

# Loaded in FK order. `messages`, `conversation_label_assignments` and
# `owner_ai_manager_messages` carry no restaurant_id, so they are scoped through
# their parent. Logs (sla_notification_log, webhook_events) and other tenants'
# tables are deliberately absent.
# Columns are always listed explicitly, never `SELECT *` with a bare COPY target.
# `SELECT *` includes GENERATED columns but `COPY … FROM` excludes them from its
# default column list, so the two disagree on width — auth.users.confirmed_at is
# generated, and the mismatch surfaces as "extra data after last expected
# column", which reads like schema drift and is not. Listing columns also makes
# the load immune to column-order differences between the projects.
cols_of() {
  "${SRC[@]}" -tAc "SELECT string_agg(quote_ident(attname), ',' ORDER BY attnum)
    FROM pg_attribute
    WHERE attrelid = '$1'::regclass AND attnum > 0
      AND NOT attisdropped AND attgenerated::text = ''"
}

copy() {
  local table="$1" where="$2" cols
  cols=$(cols_of "public.$table")
  printf '  %-34s' "$table"
  "${DST[@]}" -c "TRUNCATE public.$table CASCADE;" >/dev/null
  "${SRC[@]}" -c "\copy (SELECT $cols FROM public.$table WHERE $where) TO STDOUT" \
    | "${DST[@]}" -c "\copy public.$table ($cols) FROM STDIN"
  "${DST[@]}" -tAc "SELECT count(*) FROM public.$table"
}

echo "==> auth.users / auth.identities"
for tbl in users identities; do
  filter="$USER_FILTER"
  [ "$tbl" = identities ] && filter="user_id IN (SELECT id FROM auth.users WHERE $USER_FILTER)"
  cols=$(cols_of "auth.$tbl")
  printf '  %-34s' "auth.$tbl"
  # encrypted_password comes across verbatim, so existing passwords keep working.
  # Everyone is still signed out once: the new project mints JWTs with its own key.
  "${SRC[@]}" -c "\copy (SELECT $cols FROM auth.$tbl WHERE $filter) TO STDOUT" \
    | "${DST[@]}" -c "\copy auth.$tbl ($cols) FROM STDIN"
  "${DST[@]}" -tAc "SELECT count(*) FROM auth.$tbl"
done

# restaurants.primary_whatsapp_number_id and whatsapp_numbers.restaurant_id
# point at each other, so neither can be loaded whole first. The number goes in
# detached, then the restaurant, then the link is restored.
echo "==> tenant root (breaking the restaurants <-> whatsapp_numbers cycle)"
"${DST[@]}" -c "TRUNCATE public.whatsapp_numbers, public.profiles, public.restaurants CASCADE;" >/dev/null
"${SRC[@]}" -c "\copy (SELECT id, NULL::uuid, phone_number, provider, source_type, is_primary, assignment_status, onboarding_status, twilio_subaccount_sid, twilio_messaging_service_sid, twilio_whatsapp_sender_sid, meta_business_account_id, meta_waba_id, config, last_error, assigned_at, released_at, created_at, updated_at FROM public.whatsapp_numbers WHERE restaurant_id = '$T') TO STDOUT" \
  | "${DST[@]}" -c "\copy public.whatsapp_numbers FROM STDIN"
PROFILE_COLS=$(cols_of public.profiles)
"${SRC[@]}" -c "\copy (SELECT $PROFILE_COLS FROM public.profiles WHERE $USER_FILTER) TO STDOUT" \
  | "${DST[@]}" -c "\copy public.profiles ($PROFILE_COLS) FROM STDIN"
REST_COLS=$(cols_of public.restaurants)
"${SRC[@]}" -c "\copy (SELECT $REST_COLS FROM public.restaurants WHERE id = '$T') TO STDOUT" \
  | "${DST[@]}" -c "\copy public.restaurants ($REST_COLS) FROM STDIN"
"${DST[@]}" -c "UPDATE public.whatsapp_numbers SET restaurant_id = '$T';" >/dev/null
echo "  restaurants/profiles/whatsapp_numbers linked"

echo "==> roster"
copy team_members          "restaurant_id = '$T'"
copy specialists           "restaurant_id = '$T'"
copy drivers               "restaurant_id = '$T'"
copy field_staff_accounts  "restaurant_id = '$T'"

echo "==> inbox"
copy customers                      "restaurant_id = '$T'"
copy conversations                  "restaurant_id = '$T'"
copy messages                       "conversation_id IN (SELECT id FROM public.conversations WHERE restaurant_id = '$T')"
copy conversation_labels            "restaurant_id = '$T'"
copy conversation_label_assignments "conversation_id IN (SELECT id FROM public.conversations WHERE restaurant_id = '$T')"
copy conversation_internal_notes    "restaurant_id = '$T'"
copy conversation_claim_events      "restaurant_id = '$T'"

echo "==> field operations"
copy driver_orders        "restaurant_id = '$T'"
copy field_order_progress "restaurant_id = '$T'"
copy orders               "restaurant_id = '$T'"

echo "==> catalogue and bot"
copy menu_items       "restaurant_id = '$T'"
copy knowledge_chunks "restaurant_id = '$T'"
copy knowledge_base   "restaurant_id = '$T'"
copy ai_agents        "restaurant_id = '$T'"
copy saved_replies    "restaurant_id = '$T'"

echo "==> rekaz"
copy rekaz_sync_runs     "restaurant_id = '$T'"
copy rekaz_reservations  "restaurant_id = '$T'"
copy rekaz_changes       "restaurant_id = '$T'"

echo "==> command log and devices"
copy command_receipts         "restaurant_id = '$T'"
copy outbox_events            "restaurant_id = '$T'"
copy operation_events         "restaurant_id = '$T'"
copy user_push_tokens         "restaurant_id = '$T'"
copy field_staff_push_tokens  "restaurant_id = '$T'"
copy owner_ai_manager_threads "restaurant_id = '$T'"
copy owner_ai_manager_messages "thread_id IN (SELECT id FROM public.owner_ai_manager_threads WHERE restaurant_id = '$T')"
copy client_exports           "restaurant_id = '$T'"

echo
echo "Done. Run ./verify.sh to compare against the source."
