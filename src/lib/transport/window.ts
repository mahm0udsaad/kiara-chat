import { getAdminSupabaseClient } from "@/lib/supabase/admin";

/**
 * The 24-hour service window.
 *
 * Meta only delivers free-form business messages within 24 hours of the
 * customer's last inbound one. Outside it, nothing but a pre-approved template
 * gets through — a plain send comes back as error 63016.
 *
 * Read from the latest customer message on the Meta number (see below).
 */
const WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * A little under 24 hours, so a message composed at the boundary does not fail
 * between the check and the send.
 */
const SAFETY_MARGIN_MS = 5 * 60_000;

export interface ServiceWindow {
  open: boolean;
  lastInboundAt: string | null;
}

export async function getServiceWindow(
  conversationId: string,
): Promise<ServiceWindow> {
  // Only a message that reached the Meta number opens Meta's window. Since a
  // second number was added, `last_inbound_at` also moves on messages to that
  // number, so the window reads the latest Meta inbound itself (history rows
  // have no sender and were all on Meta). One indexed row.
  const admin = getAdminSupabaseClient();
  const { data, error } = await admin
    .from("messages")
    .select("created_at")
    .eq("conversation_id", conversationId)
    .eq("role", "customer")
    .or("sender_account.is.null,sender_account.eq.meta")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let lastInboundAt = (data?.created_at as string | null) ?? null;
  if (error) {
    // Before the sender column exists, keep the old rule rather than closing
    // every window and failing every Meta reply.
    const { data: conversation } = await admin
      .from("conversations")
      .select("last_inbound_at")
      .eq("id", conversationId)
      .maybeSingle();
    lastInboundAt = (conversation?.last_inbound_at as string | null) ?? null;
  }
  if (!lastInboundAt) return { open: false, lastInboundAt: null };

  const elapsed = Date.now() - new Date(lastInboundAt).getTime();
  return { open: elapsed < WINDOW_MS - SAFETY_MARGIN_MS, lastInboundAt };
}

/** Twilio and Meta codes for "the service window has closed". */
export const WINDOW_CLOSED_CODE = "63016";
export const META_WINDOW_CLOSED_CODE = "131047";

export function isWindowClosedError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.includes(WINDOW_CLOSED_CODE) ||
      error.message.includes(META_WINDOW_CLOSED_CODE))
  );
}
