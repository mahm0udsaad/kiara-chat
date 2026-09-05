import "server-only";

import { createHash, randomUUID } from "node:crypto";

import type { RekazFetchWindow } from "@/lib/rekaz";
import type { RekazReservation } from "@/lib/reservations";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { KIARA_RESTAURANT_ID, type KiaraSession } from "@/lib/tenant";

export interface RekazSyncCounts {
  incoming: number;
  added: number;
  updated: number;
  removed: number;
  unchanged: number;
  pending: number;
}

type SyncRow = {
  sourceId: string;
  sourceOrderId: string | null;
  payloadHash: string;
  arrivalAt: string;
  customerPhone: string;
  customerName: string;
  status: string;
  payload: RekazReservation;
};

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);
  return `{${entries.join(",")}}`;
}

function payloadHash(reservation: RekazReservation): string {
  return createHash("sha256").update(canonicalJson(reservation)).digest("hex");
}

export function rekazSyncRows(reservations: RekazReservation[]): SyncRow[] {
  return reservations.map((reservation) => ({
    sourceId: reservation.id,
    sourceOrderId: reservation.order?.id || null,
    payloadHash: payloadHash(reservation),
    arrivalAt: reservation.arrivalAt,
    customerPhone: reservation.customerPhone,
    customerName: reservation.customerName,
    status: reservation.status,
    payload: reservation,
  }));
}

/**
 * What a pull would change, without changing anything.
 *
 * The window is required rather than optional: a removal is only a removal
 * inside the range the adapter actually asked Rekaz for, and the preview must
 * count them exactly the way `kiara_apply_rekaz_snapshot` will. A banner that
 * promises "3 removed" and then applies 0 is worse than no banner.
 */
export async function previewRekazSync(
  reservations: RekazReservation[],
  window: RekazFetchWindow,
): Promise<RekazSyncCounts> {
  const incoming = rekazSyncRows(reservations);
  const { data, error } = await getAdminSupabaseClient()
    .from("rekaz_reservations")
    .select("source_id, payload_hash, removed_at, arrival_at")
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .gte("arrival_at", window.start)
    .lte("arrival_at", window.end);
  if (error) throw new Error(`REKAZ_SYNC_SCHEMA_UNAVAILABLE: ${error.message}`);

  const existing = new Map(
    (data ?? []).map((row) => [
      row.source_id as string,
      {
        hash: row.payload_hash as string,
        removedAt: row.removed_at as string | null,
      },
    ]),
  );
  let added = 0;
  let updated = 0;
  let unchanged = 0;
  const incomingIds = new Set<string>();
  for (const row of incoming) {
    incomingIds.add(row.sourceId);
    const current = existing.get(row.sourceId);
    if (!current) added += 1;
    else if (current.removedAt || current.hash !== row.payloadHash) updated += 1;
    else unchanged += 1;
  }
  const removed = [...existing.entries()].filter(
    ([sourceId, row]) => !row.removedAt && !incomingIds.has(sourceId),
  ).length;

  return {
    incoming: incoming.length,
    added,
    updated,
    removed,
    unchanged,
    pending: added + updated + removed,
  };
}

export async function applyRekazSync(input: {
  reservations: RekazReservation[];
  window: RekazFetchWindow;
  session: KiaraSession | null;
}): Promise<RekazSyncCounts & { syncRunId: string; replayed: boolean }> {
  const syncRunId = randomUUID();
  const admin = getAdminSupabaseClient();
  const { data, error } = await admin.rpc("kiara_apply_rekaz_snapshot", {
    p_restaurant_id: KIARA_RESTAURANT_ID,
    p_sync_run_id: syncRunId,
    p_actor_user_id: input.session?.userId ?? null,
    p_actor_team_member_id: input.session?.teamMemberId ?? null,
    p_rows: rekazSyncRows(input.reservations),
    p_window_start: input.window.start,
    p_window_end: input.window.end,
    // The role at pull time, so a later demotion cannot rewrite who ran it.
    p_actor_role: input.session?.role ?? null,
  });
  if (error) {
    await admin
      .from("rekaz_sync_runs")
      .upsert({
        id: syncRunId,
        restaurant_id: KIARA_RESTAURANT_ID,
        status: "failed",
        actor_user_id: input.session?.userId ?? null,
        actor_team_member_id: input.session?.teamMemberId ?? null,
        incoming_count: input.reservations.length,
        error_code: error.code ?? "REKAZ_APPLY_FAILED",
        error_message: error.message.slice(0, 2_000),
        completed_at: new Date().toISOString(),
      })
      .then(() => undefined);
    throw new Error(`REKAZ_APPLY_FAILED: ${error.message}`);
  }
  const result = data as Record<string, unknown>;
  const added = Number(result.added ?? 0);
  const updated = Number(result.updated ?? 0);
  const removed = Number(result.removed ?? 0);
  return {
    syncRunId: String(result.syncRunId ?? syncRunId),
    incoming: Number(result.incoming ?? input.reservations.length),
    added,
    updated,
    removed,
    unchanged: Number(result.unchanged ?? 0),
    pending: added + updated + removed,
    replayed: Boolean(result.replayed),
  };
}
