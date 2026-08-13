import { useQueryClient } from "@tanstack/react-query";
import { createContext, type PropsWithChildren, use, useCallback, useEffect, useRef, useState } from "react";

import { apiRequest } from "@/lib/api";
import { queryKeys, useBootstrap } from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth-provider";

const PRESENCE_CHANNEL = "inbox-presence";
const PRESENCE_EVENT = "typing";
const TYPING_TTL_MS = 8_000;
const INBOX_TOPIC_PREFIX = "kiara-inbox:";
const INBOX_EVENT = "message_received";

type TypingPayload = {
  conversationId?: string;
  state?: string;
};

type InboxPayload = {
  conversationId?: string;
};

type InboxLiveContextValue = {
  isTyping: (conversationId: string) => boolean;
};

const InboxLiveContext = createContext<InboxLiveContextValue | null>(null);

function activeTypingState(state: string | undefined) {
  return state === "composing" || state === "recording";
}

export function InboxLiveProvider({ children }: PropsWithChildren) {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const bootstrap = useBootstrap(Boolean(session));
  const role = bootstrap.data?.session.role;
  const teamMemberId = bootstrap.data?.session.teamMemberId ?? null;
  const operationsStaff = role === "admin" || role === "agent";
  const [typing, setTyping] = useState<Record<string, number>>({});
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const clearTyping = useCallback((conversationId: string) => {
    const timer = timers.current.get(conversationId);
    if (timer) clearTimeout(timer);
    timers.current.delete(conversationId);
    setTyping((current) => {
      if (!(conversationId in current)) return current;
      const next = { ...current };
      delete next[conversationId];
      return next;
    });
  }, []);

  useEffect(() => {
    if (!operationsStaff) return;
    const pendingTimers = timers.current;

    // Presence is ephemeral and the WhatsApp engine loses watches on restart,
    // so every mobile inbox session re-requests the visible phone set.
    void apiRequest<{ watched: number }>("/presence", { method: "POST" }).catch(
      () => undefined,
    );

    const presence = supabase
      .channel(PRESENCE_CHANNEL)
      .on("broadcast", { event: PRESENCE_EVENT }, ({ payload }) => {
        const event = (payload ?? {}) as TypingPayload;
        if (!event.conversationId) return;
        if (!activeTypingState(event.state)) {
          clearTyping(event.conversationId);
          return;
        }
        setTyping((current) => ({
          ...current,
          [event.conversationId!]: Date.now(),
        }));
        const existing = timers.current.get(event.conversationId);
        if (existing) clearTimeout(existing);
        timers.current.set(
          event.conversationId,
          setTimeout(() => clearTyping(event.conversationId!), TYPING_TTL_MS),
        );
      })
      .subscribe();

    return () => {
      pendingTimers.forEach((timer) => clearTimeout(timer));
      pendingTimers.clear();
      void supabase.removeChannel(presence);
    };
  }, [clearTyping, operationsStaff]);

  useEffect(() => {
    if (!operationsStaff || !teamMemberId || !session?.access_token) return;
    let liveChannel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    void (async () => {
      await supabase.realtime.setAuth(session.access_token);
      if (cancelled) return;
      liveChannel = supabase
        .channel(`${INBOX_TOPIC_PREFIX}${teamMemberId}`, {
          config: { private: true },
        })
        .on("broadcast", { event: INBOX_EVENT }, ({ payload }) => {
          const event = (payload ?? {}) as InboxPayload;
          if (!event.conversationId) return;
          clearTyping(event.conversationId);
          void Promise.all([
            queryClient.invalidateQueries({ queryKey: ["conversations"] }),
            queryClient.invalidateQueries({
              queryKey: queryKeys.conversation(event.conversationId),
            }),
          ]);
        })
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (liveChannel) void supabase.removeChannel(liveChannel);
    };
  }, [clearTyping, operationsStaff, queryClient, session?.access_token, teamMemberId]);

  const isTyping = useCallback(
    (conversationId: string) => Boolean(typing[conversationId]),
    [typing],
  );

  return (
    <InboxLiveContext.Provider value={{ isTyping }}>
      {children}
    </InboxLiveContext.Provider>
  );
}

export function useInboxLive() {
  const value = use(InboxLiveContext);
  if (!value) throw new Error("useInboxLive must be used inside InboxLiveProvider");
  return value;
}
