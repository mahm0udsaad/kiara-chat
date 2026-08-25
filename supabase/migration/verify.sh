#!/usr/bin/env bash
# Compares every migrated table's Kiara row count on the source against the
# target's, and checks the things a row count alone would not catch: vector
# dimensionality, the realtime publication, RLS coverage and the cron jobs.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$HERE/.env.migration"
: "${SOURCE_DB_URL:?Set SOURCE_DB_URL in .env.migration}"
: "${TARGET_DB_URL:?Set TARGET_DB_URL in .env.migration}"
T="${KIARA_RESTAURANT_ID}"

TABLES=(team_members specialists drivers field_staff_accounts customers
  conversations conversation_labels conversation_internal_notes
  conversation_claim_events driver_orders field_order_progress orders
  menu_items knowledge_chunks knowledge_base ai_agents saved_replies
  rekaz_sync_runs rekaz_reservations rekaz_changes command_receipts
  outbox_events operation_events user_push_tokens field_staff_push_tokens
  owner_ai_manager_threads client_exports)

fail=0
printf '%-34s %8s %8s\n' TABLE SOURCE TARGET
printf '%-34s %8s %8s\n' "----------------------------------" -------- --------

check() {
  local label="$1" src_sql="$2" dst_sql="$3"
  local s d
  s=$(psql "$SOURCE_DB_URL" -tAc "$src_sql")
  d=$(psql "$TARGET_DB_URL" -tAc "$dst_sql")
  printf '%-34s %8s %8s' "$label" "$s" "$d"
  if [ "$s" = "$d" ]; then echo "  ok"; else echo "  MISMATCH"; fail=1; fi
}

for t in "${TABLES[@]}"; do
  check "$t" \
    "SELECT count(*) FROM public.$t WHERE restaurant_id = '$T'" \
    "SELECT count(*) FROM public.$t"
done

check messages \
  "SELECT count(*) FROM public.messages m JOIN public.conversations c ON c.id=m.conversation_id WHERE c.restaurant_id='$T'" \
  "SELECT count(*) FROM public.messages"
check conversation_label_assignments \
  "SELECT count(*) FROM public.conversation_label_assignments a JOIN public.conversations c ON c.id=a.conversation_id WHERE c.restaurant_id='$T'" \
  "SELECT count(*) FROM public.conversation_label_assignments"
check owner_ai_manager_messages \
  "SELECT count(*) FROM public.owner_ai_manager_messages m JOIN public.owner_ai_manager_threads th ON th.id=m.thread_id WHERE th.restaurant_id='$T'" \
  "SELECT count(*) FROM public.owner_ai_manager_messages"
check auth.users \
  "SELECT count(*) FROM auth.users WHERE id IN (SELECT owner_id FROM public.restaurants WHERE id='$T' UNION SELECT user_id FROM public.team_members WHERE restaurant_id='$T' UNION SELECT auth_user_id FROM public.field_staff_accounts WHERE restaurant_id='$T')" \
  "SELECT count(*) FROM auth.users"

echo
echo "structural checks (target)"

# An embedding that arrived as text, or at the wrong dimensionality, still
# counts as a row but makes match_knowledge_chunks return nothing.
psql "$TARGET_DB_URL" -tAc \
  "SELECT '  knowledge_chunks embedding dims: '||coalesce(min(vector_dims(embedding))::text,'none')||'..'||coalesce(max(vector_dims(embedding))::text,'none')||' (expect 768..768), null embeddings: '||count(*) FILTER (WHERE embedding IS NULL) FROM public.knowledge_chunks;"

psql "$TARGET_DB_URL" -tAc \
  "SELECT '  realtime publication: '||coalesce(string_agg(tablename,', ' ORDER BY tablename),'EMPTY') FROM pg_publication_tables WHERE pubname='supabase_realtime';"

psql "$TARGET_DB_URL" -tAc \
  "SELECT '  tables without RLS: '||coalesce(string_agg(c.relname,', '),'none') FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity;"

psql "$TARGET_DB_URL" -tAc \
  "SELECT '  cron jobs: '||coalesce(string_agg(jobname||' ('||schedule||')', ', ' ORDER BY jobname),'none') FROM cron.job;"

psql "$TARGET_DB_URL" -tAc \
  "SELECT '  vault secrets: '||coalesce(string_agg(name,', ' ORDER BY name),'none') FROM vault.secrets;"

echo
if [ "$fail" = 0 ]; then echo "row counts match."; else echo "ROW COUNT MISMATCHES ABOVE — do not cut over."; exit 1; fi
