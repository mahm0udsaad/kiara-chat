"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Conversation } from "@/lib/types";

export interface ConversationRealtimeChange {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new: Partial<Conversation>;
  old: Partial<Conversation>;
}

/**
 * Live inbox updates via Supabase Realtime (postgres_changes).
 *
 * Both `messages` and `conversations` are already in the supabase_realtime
 * publication, and their RLS SELECT policies are what scope delivery — an
 * agent only ever receives rows they could select. No tenant id is passed
 * from the browser (and none may be: isolation is enforced server-side).
 *
 * - INSERT on messages   → onNewMessage(conversationId) so an open thread can
 *                          refetch through the API (which signs media URLs —
 *                          the raw row payload can't be rendered directly).
 * - UPDATE on messages   → onMessageUpdated(id, patch), patched straight into
 *                          local state. Delivery status settles after the send
 *                          response now (the provider call moved to `after()`),
 *                          so this is how "queued" becomes "sent"/"failed"
 *                          without a refetch.
 * - any conversations change → pass the changed row to the inbox so it can
 *                          patch, reorder, or remove one item without
 *                          refetching the whole Server Component tree.
 */
export function useInboxRealtime({
  onNewMessage,
  onMessageUpdated,
  onConversationChanged,
}: {
  onNewMessage: (conversationId: string) => void;
  onMessageUpdated: (
    id: string,
    patch: { delivery_status?: string | null; external_message_sid?: string | null }
  ) => void;
  onConversationChanged: (change: ConversationRealtimeChange) => void;
}) {
  // Keep the callbacks in refs so the subscription survives re-renders.
  const onNewMessageRef = useRef(onNewMessage);
  const onMessageUpdatedRef = useRef(onMessageUpdated);
  const onConversationChangedRef = useRef(onConversationChanged);
  useEffect(() => {
    onNewMessageRef.current = onNewMessage;
    onMessageUpdatedRef.current = onMessageUpdated;
    onConversationChangedRef.current = onConversationChanged;
  }, [onNewMessage, onMessageUpdated, onConversationChanged]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("inbox-live")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          const conversationId = (payload.new as { conversation_id?: string })
            .conversation_id;
          if (conversationId) onNewMessageRef.current(conversationId);
          // The write path updates the parent conversation immediately after
          // inserting the message. That UPDATE carries ordering/unread state.
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages" },
        (payload) => {
          const row = payload.new as {
            id?: string;
            delivery_status?: string | null;
            external_message_sid?: string | null;
          };
          if (!row.id) return;
          onMessageUpdatedRef.current(row.id, {
            delivery_status: row.delivery_status,
            external_message_sid: row.external_message_sid,
          });
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversations" },
        (payload) => {
          onConversationChangedRef.current({
            eventType: payload.eventType,
            new: payload.new as Partial<Conversation>,
            old: payload.old as Partial<Conversation>,
          });
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);
}
