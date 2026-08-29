import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  type PropsWithChildren,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";

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

/**
 * A subscription, deliberately, rather than a value.
 *
 * Typing is the highest-frequency signal in the app — every keystroke in any of
 * the salon's conversations broadcasts one. Exposing it as a context *value*
 * meant every one of those re-rendered every consumer, and the inbox consumer
 * is a FlatList: one customer typing rebuilt every visible row on screen.
 *
 * So the context never changes identity. A row subscribes to the single
 * conversation it renders, through `useIsTyping`, and only that row re-renders
 * when that conversation starts or stops typing.
 */
type InboxLiveContextValue = {
  subscribe: (conversationId: string, listener: () => void) => () => void;
  getSnapshot: (conversationId: string) => boolean;
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
  // Typing lives in a ref, not state: a re-render of this provider would give
  // every consumer below it new work, and the only thing that actually needs to
  // change on screen is the one row that started or stopped typing.
  const typing = useRef(new Set<string>());
  const listeners = useRef(new Map<string, Set<() => void>>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const notify = useCallback((conversationId: string) => {
    const subscribers = listeners.current.get(conversationId);
    if (!subscribers) return;
    for (const listener of subscribers) listener();
  }, []);

  const markTyping = useCallback(
    (conversationId: string) => {
      if (!typing.current.has(conversationId)) {
        typing.current.add(conversationId);
        notify(conversationId);
      }
    },
    [notify],
  );

  const clearTyping = useCallback(
    (conversationId: string) => {
      const timer = timers.current.get(conversationId);
      if (timer) clearTimeout(timer);
      timers.current.delete(conversationId);
      if (typing.current.delete(conversationId)) notify(conversationId);
    },
    [notify],
  );

  const subscribe = useCallback((conversationId: string, listener: () => void) => {
    const existing = listeners.current.get(conversationId);
    if (existing) existing.add(listener);
    else listeners.current.set(conversationId, new Set([listener]));
    return () => {
      const subscribers = listeners.current.get(conversationId);
      if (!subscribers) return;
      subscribers.delete(listener);
      if (!subscribers.size) listeners.current.delete(conversationId);
    };
  }, []);

  const getSnapshot = useCallback(
    (conversationId: string) => typing.current.has(conversationId),
    [],
  );

  // Stable for the life of the provider — every callback above is itself stable,
  // so no consumer ever re-renders because of this value.
  const contextValue = useMemo(
    () => ({ subscribe, getSnapshot }),
    [subscribe, getSnapshot],
  );

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
        markTyping(event.conversationId);
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
  }, [clearTyping, markTyping, operationsStaff]);

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

  return (
    <InboxLiveContext.Provider value={contextValue}>
      {children}
    </InboxLiveContext.Provider>
  );
}

/**
 * Whether one conversation is currently typing.
 *
 * Call it in the row that renders that conversation, not in the list above it:
 * the whole point is that a keystroke wakes one row rather than the screen.
 */
export function useIsTyping(conversationId: string): boolean {
  const value = use(InboxLiveContext);
  if (!value) throw new Error("useIsTyping must be used inside InboxLiveProvider");
  const { subscribe, getSnapshot } = value;
  return useSyncExternalStore(
    useCallback(
      (onChange: () => void) => subscribe(conversationId, onChange),
      [subscribe, conversationId],
    ),
    useCallback(() => getSnapshot(conversationId), [getSnapshot, conversationId]),
  );
}
