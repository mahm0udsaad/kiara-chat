/**
 * The Rekaz reservations snapshot, as /orders shows it.
 *
 * Rekaz has no API key enabled yet, so `src/lib/rekaz.ts` reads the platform's
 * own endpoint and the result is published as one JSON blob in the
 * whatsapp-media bucket — no migration on the shared DB, and the sync button
 * refreshes prod without a deploy. The page reads the blob rather than calling
 * Rekaz so a slow or unreachable platform can never stall /orders.
 */
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { KIARA_RESTAURANT_ID } from "@/lib/tenant";
import { WHATSAPP_MEDIA_BUCKET } from "@/lib/storage-media";
import { normalizePhone } from "@/lib/phone";

const SNAPSHOT_PATH = `tenants/${KIARA_RESTAURANT_ID}/rekaz/reservations.json`;

export interface RekazReservation {
  id: string; // Rekaz's reservation number — what the salon quotes on the phone
  arrivalAt: string; // ISO with +03:00 offset
  durationMinutes: number;
  service: string;
  quantity: number;
  customerName: string;
  customerPhone: string; // E.164
  providers: string[];
  status: "Confirmed" | "Pending" | "Done" | string;
  payment: "Paid" | "PartiallyPaid" | "Pending" | string;
  amount: number;
  location: { lat: number; lng: number; label: string } | null;
  /** `Internal` — booked by staff — or `Website`, booked by the customer. */
  source: "Internal" | "Website" | string;
  /** The staff member who entered it; empty when the customer booked herself. */
  createdBy: string;
  bookedAt: string; // ISO with +03:00 offset — when the booking was made
  /**
   * The basket this service sits in. Several reservations share one order (a
   * customer booking three services pays once), so the money on the order is
   * the order's, not this row's.
   */
  order: { id: string; status: string; total: number; refunded: number } | null;
  notes: string;
}

export interface ReservationsSnapshot {
  syncedAt: string;
  reservations: RekazReservation[];
}

/**
 * A stored row, filled out to the current shape.
 *
 * The snapshot is a JSON blob rather than a table, so a deploy that adds a
 * column meets rows written before it existed. Backfilling on read keeps that
 * out of the components — and out of a migration.
 */
function normalizeReservation(row: Partial<RekazReservation>): RekazReservation {
  return {
    id: String(row.id ?? ""),
    arrivalAt: String(row.arrivalAt ?? ""),
    durationMinutes: Number(row.durationMinutes) || 0,
    service: row.service ?? "",
    quantity: Number(row.quantity) || 1,
    customerName: row.customerName ?? "",
    customerPhone: row.customerPhone ?? "",
    providers: Array.isArray(row.providers) ? row.providers : [],
    status: row.status ?? "",
    payment: row.payment ?? "",
    amount: Number(row.amount) || 0,
    location: row.location ?? null,
    source: row.source ?? "",
    createdBy: row.createdBy ?? "",
    bookedAt: row.bookedAt ?? "",
    order: row.order
      ? {
          id: row.order.id ?? "",
          status: row.order.status ?? "",
          total: Number(row.order.total) || 0,
          refunded: Number(row.order.refunded) || 0,
        }
      : null,
    notes: row.notes ?? "",
  };
}

/** Null when no snapshot has been published yet — the tab offers a first sync. */
export async function getReservationsSnapshot(): Promise<ReservationsSnapshot | null> {
  const { data, error } = await getAdminSupabaseClient()
    .storage.from(WHATSAPP_MEDIA_BUCKET)
    .download(SNAPSHOT_PATH);
  if (error || !data) return null;
  try {
    const parsed = JSON.parse(await data.text()) as ReservationsSnapshot;
    if (!Array.isArray(parsed.reservations)) return null;
    return {
      syncedAt: parsed.syncedAt,
      reservations: parsed.reservations.map(normalizeReservation),
    };
  } catch {
    return null;
  }
}

/** Overwrite the published snapshot. Upsert: there is only ever one. */
export async function publishReservationsSnapshot(
  snapshot: ReservationsSnapshot
): Promise<void> {
  const { error } = await getAdminSupabaseClient()
    .storage.from(WHATSAPP_MEDIA_BUCKET)
    .upload(SNAPSHOT_PATH, JSON.stringify(snapshot), {
      contentType: "application/json",
      upsert: true,
    });
  if (error) throw new Error(`Failed to publish snapshot: ${error.message}`);
}

/**
 * Name the threads Rekaz can name for us.
 *
 * A customer who books on Rekaz but has only ever sent a WhatsApp message from
 * an unnamed number shows up in the inbox as a bare phone number, while the
 * salon's own label for her sits in the reservation. Fill that in — but only
 * where there is no name at all, so a name someone typed by hand is never
 * overwritten by whatever the booking happens to say.
 *
 * Returns how many threads were named.
 */
export async function fillMissingCustomerNames(
  reservations: RekazReservation[]
): Promise<number> {
  const nameByPhone = new Map<string, string>();
  for (const r of reservations) {
    if (r.customerName) nameByPhone.set(normalizePhone(r.customerPhone), r.customerName);
  }
  if (nameByPhone.size === 0) return 0;

  const admin = getAdminSupabaseClient();
  const { data: unnamed, error } = await admin
    .from("conversations")
    .select("id, customer_phone")
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .is("customer_name", null);
  if (error) throw new Error(error.message);

  const fills = (unnamed ?? [])
    .map((c) => ({
      id: c.id as string,
      name: nameByPhone.get(normalizePhone(String(c.customer_phone ?? ""))),
    }))
    .filter((f): f is { id: string; name: string } => Boolean(f.name));

  let filled = 0;
  for (const fill of fills) {
    const { error: updateError } = await admin
      .from("conversations")
      .update({ customer_name: fill.name })
      .eq("id", fill.id)
      .eq("restaurant_id", KIARA_RESTAURANT_ID);
    // One bad row must not abandon the rest — the snapshot is already live.
    if (!updateError) filled++;
  }
  return filled;
}
