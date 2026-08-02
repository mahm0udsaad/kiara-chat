import type { WaPresence } from "@/lib/transport/types";

/**
 * Typing indicators, fanned out over Supabase Realtime's broadcast channel.
 *
 * Broadcast rather than a table: "she is typing" is true for two seconds and
 * would otherwise mean a write (and a postgres_changes wake-up for every open
 * dashboard) on every keystroke burst. Nothing here is worth persisting — a
 * missed event costs an indicator, not data.
 *
 * The REST endpoint is used instead of a websocket client because this runs in
 * a serverless request that ends immediately after; opening a socket just to
 * send one message would usually lose the race with the function shutting down.
 */
export const PRESENCE_CHANNEL = "inbox-presence";
export const PRESENCE_EVENT = "typing";

/** How long an indicator survives without a refresh — `paused` can go missing. */
export const TYPING_TTL_MS = 8000;

export interface TypingBroadcast {
  conversationId: string;
  /** "composing" | "recording" are shown; anything else clears the indicator. */
  state: WaPresence;
}

export function isTypingState(state: WaPresence): boolean {
  return state === "composing" || state === "recording";
}

export async function broadcastTyping(payload: TypingBroadcast): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;

  await fetch(`${url}/realtime/v1/api/broadcast`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      messages: [
        {
          topic: PRESENCE_CHANNEL,
          event: PRESENCE_EVENT,
          payload,
        },
      ],
    }),
  }).catch(() => {
    // An indicator that never arrives is not worth failing ingestion over.
  });
}
