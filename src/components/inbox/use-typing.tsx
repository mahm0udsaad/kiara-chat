"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  PRESENCE_CHANNEL,
  PRESENCE_EVENT,
  TYPING_TTL_MS,
  isTypingState,
  type TypingBroadcast,
} from "@/lib/presence";

/**
 * Which conversations are being typed in right now.
 *
 * Two things end an indicator: WhatsApp's own `paused`/`available`, and a
 * local expiry. The expiry is what actually carries it — the stop event is
 * best-effort, and an indicator stuck on forever reads as a bug.
 */
export function useTyping(): (conversationId: string) => boolean {
  const [typing, setTyping] = useState<Record<string, number>>({});
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const clear = useCallback((conversationId: string) => {
    const timer = timers.current.get(conversationId);
    if (timer) clearTimeout(timer);
    timers.current.delete(conversationId);
    setTyping((prev) => {
      if (!(conversationId in prev)) return prev;
      const next = { ...prev };
      delete next[conversationId];
      return next;
    });
  }, []);

  useEffect(() => {
    const pending = timers.current;
    const supabase = createClient();
    const channel = supabase
      .channel(PRESENCE_CHANNEL)
      .on("broadcast", { event: PRESENCE_EVENT }, ({ payload }) => {
        const { conversationId, state } = (payload ?? {}) as TypingBroadcast;
        if (!conversationId || !state) return;
        if (!isTypingState(state)) {
          clear(conversationId);
          return;
        }
        setTyping((prev) => ({ ...prev, [conversationId]: Date.now() }));
        const existing = timers.current.get(conversationId);
        if (existing) clearTimeout(existing);
        timers.current.set(
          conversationId,
          setTimeout(() => clear(conversationId), TYPING_TTL_MS)
        );
      })
      .subscribe();

    return () => {
      pending.forEach((timer) => clearTimeout(timer));
      pending.clear();
      void supabase.removeChannel(channel);
    };
  }, [clear]);

  return useCallback(
    (conversationId: string) => Boolean(typing[conversationId]),
    [typing]
  );
}

/** The animated "typing…" bubble, matching the incoming-message side. */
export function TypingDots({ className }: { className?: string }) {
  return (
    <span className={className} aria-hidden="true">
      <span className="inline-flex gap-0.5 align-middle">
        {[0, 150, 300].map((delay) => (
          <span
            key={delay}
            className="size-1 animate-bounce rounded-full bg-current"
            style={{ animationDelay: `${delay}ms` }}
          />
        ))}
      </span>
    </span>
  );
}
