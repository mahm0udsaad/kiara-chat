"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

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
 * - any conversations change → onConversationsChanged() so the list reorders
 *                          and unread badges update.
 */
export function useInboxRealtime({
  onNewMessage,
  onMessageUpdated,
  onConversationsChanged,
}: {
  onNewMessage: (conversationId: string) => void;
  onMessageUpdated: (
    id: string,
    patch: { delivery_status?: string | null; external_message_sid?: string | null }
  ) => void;
  onConversationsChanged: () => void;
}) {
  // Keep the callbacks in refs so the subscription survives re-renders.
  const onNewMessageRef = useRef(onNewMessage);
  const onMessageUpdatedRef = useRef(onMessageUpdated);
  const onConversationsChangedRef = useRef(onConversationsChanged);
  useEffect(() => {
    onNewMessageRef.current = onNewMessage;
    onMessageUpdatedRef.current = onMessageUpdated;
    onConversationsChangedRef.current = onConversationsChanged;
  }, [onNewMessage, onMessageUpdated, onConversationsChanged]);

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
          // A new message also bumps the conversation's ordering/unread state.
          onConversationsChangedRef.current();
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
        () => onConversationsChangedRef.current()
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);
}
