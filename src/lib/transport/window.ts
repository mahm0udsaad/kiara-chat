import { getAdminSupabaseClient } from "@/lib/supabase/admin";

/**
 * The 24-hour service window.
 *
 * Meta only delivers free-form business messages within 24 hours of the
 * customer's last inbound one. Outside it, nothing but a pre-approved template
 * gets through — a plain send comes back as error 63016.
 *
 * `conversations.last_inbound_at` is already maintained on every inbound by
 * `bumpConversationActivity`, so the window costs one read and no new state.
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
  const { data } = await getAdminSupabaseClient()
    .from("conversations")
    .select("last_inbound_at")
    .eq("id", conversationId)
    .maybeSingle();

  const lastInboundAt = (data?.last_inbound_at as string | null) ?? null;
  if (!lastInboundAt) return { open: false, lastInboundAt: null };

  const elapsed = Date.now() - new Date(lastInboundAt).getTime();
  return { open: elapsed < WINDOW_MS - SAFETY_MARGIN_MS, lastInboundAt };
}

/** Twilio's code for "the service window has closed". */
export const WINDOW_CLOSED_CODE = "63016";

export function isWindowClosedError(error: unknown): boolean {
  return error instanceof Error && error.message.includes(WINDOW_CLOSED_CODE);
}
