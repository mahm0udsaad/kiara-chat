import "server-only";

import { ordersNumberTransport } from "@/lib/orders-number";
import { normalizePhone } from "@/lib/phone";
import { listSpecialistLabeledConversationIds } from "@/lib/specialist-conversations";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { KIARA_RESTAURANT_ID } from "@/lib/tenant";
import { transportForConversation, type MessageTransport } from "@/lib/transport";

/**
 * Driver and specialist chats run on the orders number, not the Business one.
 *
 * Customers are on Meta, where every message counts against the business
 * account and a thread quiet for 24 hours can only be reopened with a paid
 * template. The field team is not a customer: they are talked to all day, at
 * any hour, and the salon already has a WhatsApp number whose whole job is
 * talking to them — the linked device that sends their order notifications.
 *
 * A thread belongs to the field team exactly when the inbox files it under
 * السائقون or الأخصائيات (see `matchesView` in `src/lib/mobile/conversations.ts`):
 * its phone is on the driver or specialist roster, or it carries the اخصائية
 * label. Using the same rule means what the office sees in those tabs is
 * exactly what goes out from the orders number.
 *
 * The Rekaz notification sender is filed under drivers too, but it is a bot
 * nobody replies to, so it is deliberately not part of this.
 */

export type StaffKind = "driver" | "specialist";

/** The roster's phones, national digits, read with the service-role client. */
async function rosterPhones(): Promise<{
  drivers: ReadonlySet<string>;
  specialists: ReadonlySet<string>;
}> {
  const admin = getAdminSupabaseClient();
  const [drivers, specialists] = await Promise.all([
    admin.from("drivers").select("phone").eq("restaurant_id", KIARA_RESTAURANT_ID),
    admin.from("specialists").select("phone").eq("restaurant_id", KIARA_RESTAURANT_ID),
  ]);
  if (drivers.error) throw new Error(drivers.error.message);
  if (specialists.error) throw new Error(specialists.error.message);
  const set = (rows: { phone: string | null }[] | null) =>
    new Set((rows ?? []).map((row) => normalizePhone(row.phone ?? "")).filter(Boolean));
  return { drivers: set(drivers.data), specialists: set(specialists.data) };
}

function isGroupAddress(phone: string): boolean {
  return phone.trim().endsWith("@g.us");
}

/** Is this phone on the field-team roster? */
export async function staffKindForPhone(phone: string | null | undefined): Promise<StaffKind | null> {
  if (!phone || isGroupAddress(phone)) return null;
  const national = normalizePhone(phone);
  if (!national) return null;
  const roster = await rosterPhones();
  if (roster.drivers.has(national)) return "driver";
  if (roster.specialists.has(national)) return "specialist";
  return null;
}

/** Is this thread one of the field team's — by phone, or by the اخصائية label? */
export async function staffKindForConversation(conversationId: string): Promise<StaffKind | null> {
  const { data, error } = await getAdminSupabaseClient()
    .from("conversations")
    .select("customer_phone")
    .eq("id", conversationId)
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const phone = (data?.customer_phone as string | null) ?? null;
  if (!phone || isGroupAddress(phone)) return null;

  const byPhone = await staffKindForPhone(phone);
  if (byPhone) return byPhone;
  const labeled = await listSpecialistLabeledConversationIds([conversationId]);
  return labeled.has(conversationId) ? "specialist" : null;
}

/**
 * The transport an inbox reply in this thread goes out on: the orders number
 * for the field team, the customer provider for everyone else.
 */
export async function inboxTransportFor(conversationId: string): Promise<MessageTransport> {
  return (await staffKindForConversation(conversationId))
    ? ordersNumberTransport
    : transportForConversation(conversationId);
}
