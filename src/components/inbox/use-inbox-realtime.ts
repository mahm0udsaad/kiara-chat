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
 * - any conversations change → onConversationsChanged() so the list reorders
 *                          and unread badges update.
 */
export function useInboxRealtime({
  onNewMessage,
  onConversationsChanged,
}: {
  onNewMessage: (conversationId: string) => void;
  onConversationsChanged: () => void;
}) {
  // Keep the callbacks in refs so the subscription survives re-renders.
  const onNewMessageRef = useRef(onNewMessage);
  const onConversationsChangedRef = useRef(onConversationsChanged);
  onNewMessageRef.current = onNewMessage;
  onConversationsChangedRef.current = onConversationsChanged;

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
        { event: "*", schema: "public", table: "conversations" },
        () => onConversationsChangedRef.current()
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);
}
