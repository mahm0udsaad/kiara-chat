import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { KIARA_RESTAURANT_ID } from "@/lib/tenant";
import { normalizePhone } from "@/lib/phone";
import type { RekazReservation } from "@/lib/reservations";
import {
  reservationFollowUpKey,
  reservationFollowUpsOf,
  type ReservationFollowUp,
  type ReservationFollowUpMap,
  type ReservationFollowUpStatus,
} from "@/lib/reservation-follow-up";

const QUERY_BATCH_SIZE = 100;

function phoneCandidates(phone: string): string[] {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, "");
  const candidates = new Set<string>([trimmed, digits ? `+${digits}` : ""]);
  if (digits.startsWith("05") && digits.length === 10) {
    candidates.add(`+966${digits.slice(1)}`);
  }
  return [...candidates].filter(Boolean);
}

/** Load the latest conversation's persisted follow-up state for each visit. */
export async function listReservationFollowUps(
  reservations: RekazReservation[]
): Promise<ReservationFollowUpMap> {
  const targetPhones = new Set(
    reservations.map((reservation) => normalizePhone(reservation.customerPhone))
  );
  const candidates = [
    ...new Set(reservations.flatMap((reservation) => phoneCandidates(reservation.customerPhone))),
  ];
  if (!candidates.length) return {};

  const admin = getAdminSupabaseClient();
  const batches: string[][] = [];
  for (let index = 0; index < candidates.length; index += QUERY_BATCH_SIZE) {
    batches.push(candidates.slice(index, index + QUERY_BATCH_SIZE));
  }
  const results = await Promise.all(
    batches.map((batch) =>
      admin
        .from("conversations")
        .select("customer_phone, last_message_at, metadata")
        .eq("restaurant_id", KIARA_RESTAURANT_ID)
        .in("customer_phone", batch)
        .order("last_message_at", { ascending: false })
    )
  );

  const latestByPhone = new Map<string, Record<string, unknown> | null>();
  for (const result of results) {
    if (result.error) throw new Error(result.error.message);
    for (const conversation of result.data ?? []) {
      const normalized = normalizePhone(String(conversation.customer_phone ?? ""));
      if (!targetPhones.has(normalized) || latestByPhone.has(normalized)) continue;
      latestByPhone.set(
        normalized,
        (conversation.metadata as Record<string, unknown> | null) ?? null
      );
    }
  }

  const output: ReservationFollowUpMap = {};
  for (const reservation of reservations) {
    const stored = reservationFollowUpsOf(
      latestByPhone.get(normalizePhone(reservation.customerPhone))
    );
    const entry = stored[reservation.arrivalAt.slice(0, 10)];
    if (entry) {
      output[reservationFollowUpKey(reservation.customerPhone, reservation.arrivalAt)] =
        entry;
    }
  }
  return output;
}

/** Persist one visit's confirmation state inside its conversation metadata. */
export async function setReservationFollowUp(
  conversationId: string,
  dayKey: string,
  status: ReservationFollowUpStatus,
  teamMemberId: string | null,
  options: { reminded?: boolean } = {}
): Promise<ReservationFollowUp> {
  const admin = getAdminSupabaseClient();
  const { data: conversation, error: readError } = await admin
    .from("conversations")
    .select("metadata, status")
    .eq("id", conversationId)
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  if (!conversation) throw new Error("المحادثة غير موجودة");

  const metadata =
    (conversation.metadata as Record<string, unknown> | null) ?? {};
  const followUps = reservationFollowUpsOf(metadata);
  const previous = followUps[dayKey];
  const now = new Date().toISOString();
  const entry: ReservationFollowUp = {
    status,
    reminded_at: options.reminded ? now : (previous?.reminded_at ?? null),
    updated_at: now,
    updated_by: teamMemberId,
  };
  const nextMetadata: Record<string, unknown> = {
    ...metadata,
    reservation_follow_ups: { ...followUps, [dayKey]: entry },
  };
  if (status === "awaiting_reply") {
    nextMetadata.booking_stage = "awaiting_confirmation";
    nextMetadata.cs_status = "open";
  } else if (status === "confirmed") {
    nextMetadata.booking_stage = "booking_confirmed";
    nextMetadata.cs_status = "open";
  }

  const { error } = await admin
    .from("conversations")
    .update({
      metadata: nextMetadata,
      status: status === "cancelled" ? conversation.status : "active",
    })
    .eq("id", conversationId)
    .eq("restaurant_id", KIARA_RESTAURANT_ID);
  if (error) throw new Error(error.message);
  return entry;
}
