import "server-only";

/**
 * What actually happened on a visit: who confirmed each step, when, how long
 * after the previous one, and where they were standing.
 *
 * `field_location_checkpoints` has existed since the operational command
 * foundation and never received a row, because the app did not ask for a
 * position. Now that it does, this is the read side: the evidence assembled
 * into something the salon can look at when a customer says the specialist
 * arrived an hour late, or a driver bills a trip he says he made.
 *
 * The distance check is the point of collecting coordinates at all. A service
 * confirmed as started two kilometres from the customer's address is either a
 * mis-tap or a claim, and both are worth seeing.
 */
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { KIARA_RESTAURANT_ID } from "@/lib/tenant";
import type { FieldOrderProgressState } from "@/lib/types";

export type FieldAuditAction =
  | "confirm_ride"
  | "driver_arrived"
  | "confirm_pickup"
  | "start_service"
  | "complete_order"
  | "driver_return";

const ACTION_LABEL: Record<FieldAuditAction, string> = {
  confirm_ride: "تأكيد الرحلة والانطلاق",
  driver_arrived: "وصول السائق لمقر الأخصائية",
  confirm_pickup: "ركوب الأخصائية مع السائق",
  start_service: "بدء الخدمة",
  complete_order: "إنهاء الخدمة",
  driver_return: "عودة السائق",
};

/** Who owns each step, so the audit can say whose confirmation this was. */
const ACTION_ROLE: Record<FieldAuditAction, "driver" | "specialist"> = {
  confirm_ride: "driver",
  driver_arrived: "driver",
  confirm_pickup: "specialist",
  start_service: "specialist",
  complete_order: "specialist",
  driver_return: "driver",
};

export interface FieldAuditEntry {
  action: FieldAuditAction;
  label: string;
  role: "driver" | "specialist";
  /** When the step was confirmed, from the progress row. */
  at: string;
  /** Minutes since the previous confirmed step; null for the first. */
  minutesSincePrevious: number | null;
  /** Present only when a position was fixed. */
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
  /** "device" is a real fix; "manual_exception" is an explained absence. */
  source: "device" | "manual_exception" | null;
  exceptionReason: string | null;
  /**
   * Metres from the customer's own coordinates, when both are known. Null for
   * an order whose address is a typed line rather than a Rekaz pin.
   */
  metresFromCustomer: number | null;
}

export interface FieldAudit {
  orderId: string;
  /** The row the entries were derived from, so callers can also time the legs. */
  progress: FieldOrderProgressState;
  entries: FieldAuditEntry[];
  /** Steps confirmed with a real position, out of those confirmed at all. */
  verifiedCount: number;
  totalCount: number;
}

/** Great-circle metres. Exact enough at the scale of one city. */
function metresBetween(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

type CheckpointRow = {
  action: string;
  latitude: number | null;
  longitude: number | null;
  accuracy_meters: number | null;
  captured_at: string | null;
  received_at: string;
  source: string;
  exception_reason: string | null;
};

const STEP_AT: Record<FieldAuditAction, (p: FieldOrderProgressState) => string | null> = {
  confirm_ride: (p) => p.driverConfirmedAt,
  driver_arrived: (p) => p.driverArrivedAt,
  confirm_pickup: (p) => p.specialistPickupAt,
  start_service: (p) => p.serviceStartedAt,
  complete_order: (p) => p.completedAt,
  driver_return: (p) => p.driverReturnedAt,
};

/**
 * The audit trail for one order.
 *
 * Driven by the progress row rather than by the checkpoints: a step that was
 * confirmed is part of the story even when no position came with it, and
 * showing it with an empty location is what makes an unverified step visible
 * instead of absent.
 */
export async function getFieldAudit(orderId: string): Promise<FieldAudit | null> {
  const admin = getAdminSupabaseClient();
  const [{ data: progressRow }, { data: checkpointRows }, { data: orderRow }] =
    await Promise.all([
      admin
        .from("field_order_progress")
        .select("*")
        .eq("restaurant_id", KIARA_RESTAURANT_ID)
        .eq("order_id", orderId)
        .maybeSingle(),
      admin
        .from("field_location_checkpoints")
        .select(
          "action, latitude, longitude, accuracy_meters, captured_at, received_at, source, exception_reason",
        )
        .eq("restaurant_id", KIARA_RESTAURANT_ID)
        .eq("order_id", orderId)
        .order("received_at", { ascending: true }),
      admin
        .from("driver_orders")
        .select("id, sent_at, rekaz_source_id")
        .eq("restaurant_id", KIARA_RESTAURANT_ID)
        .eq("id", orderId)
        .maybeSingle(),
    ]);
  if (!progressRow || !orderRow) return null;

  const row = progressRow as Record<string, unknown>;
  const progress: FieldOrderProgressState = {
    driverConfirmedAt: (row.driver_confirmed_at as string | null) ?? null,
    driverArrivedAt: (row.driver_arrived_at as string | null) ?? null,
    specialistPickupAt: (row.specialist_pickup_at as string | null) ?? null,
    serviceStartedAt: (row.service_started_at as string | null) ?? null,
    completedAt: (row.completed_at as string | null) ?? null,
    driverReturnedAt: (row.driver_returned_at as string | null) ?? null,
    lastActivityAt: (row.last_activity_at as string | null) ?? "",
    lastReminderAt: (row.last_reminder_at as string | null) ?? null,
    version: Number(row.version) || 0,
  };

  // The last checkpoint per action: a step retried after a failed send writes
  // twice, and the one that stuck is the later one.
  const byAction = new Map<string, CheckpointRow>();
  for (const checkpoint of (checkpointRows ?? []) as CheckpointRow[]) {
    byAction.set(checkpoint.action, checkpoint);
  }

  const customer = await customerCoordinates(
    admin,
    (orderRow as { rekaz_source_id: string | null }).rekaz_source_id,
  );

  const entries: FieldAuditEntry[] = [];
  let previousAt: string | null = null;
  for (const action of Object.keys(STEP_AT) as FieldAuditAction[]) {
    const at = STEP_AT[action](progress);
    if (!at) continue;
    const checkpoint = byAction.get(action) ?? null;
    const hasFix =
      checkpoint?.source === "device" &&
      checkpoint.latitude !== null &&
      checkpoint.longitude !== null;
    entries.push({
      action,
      label: ACTION_LABEL[action],
      role: ACTION_ROLE[action],
      at,
      minutesSincePrevious: previousAt
        ? Math.max(
            0,
            Math.round((Date.parse(at) - Date.parse(previousAt)) / 60_000),
          )
        : null,
      latitude: hasFix ? checkpoint!.latitude : null,
      longitude: hasFix ? checkpoint!.longitude : null,
      accuracyMeters: hasFix ? checkpoint!.accuracy_meters : null,
      source: (checkpoint?.source as FieldAuditEntry["source"]) ?? null,
      exceptionReason: checkpoint?.exception_reason ?? null,
      metresFromCustomer:
        hasFix && customer
          ? metresBetween(
              { lat: checkpoint!.latitude!, lng: checkpoint!.longitude! },
              customer,
            )
          : null,
    });
    previousAt = at;
  }

  return {
    orderId,
    progress,
    entries,
    verifiedCount: entries.filter((entry) => entry.source === "device").length,
    totalCount: entries.length,
  };
}

/**
 * The customer's own coordinates, from the Rekaz pin.
 *
 * Only a Rekaz booking has them. An order raised from a conversation carries a
 * typed address or a shared maps link, and guessing coordinates out of either
 * would produce a distance that looks authoritative and is not.
 */
async function customerCoordinates(
  admin: ReturnType<typeof getAdminSupabaseClient>,
  rekazSourceId: string | null,
): Promise<{ lat: number; lng: number } | null> {
  if (!rekazSourceId) return null;
  const { data } = await admin
    .from("rekaz_reservations")
    .select("payload")
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .eq("source_id", rekazSourceId)
    .maybeSingle();
  const location = (data?.payload as { location?: { lat?: number; lng?: number } | null } | null)
    ?.location;
  const lat = Number(location?.lat);
  const lng = Number(location?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}
