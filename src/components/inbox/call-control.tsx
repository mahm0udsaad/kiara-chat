"use client";

/**
 * The call control in the thread header: one button, four meanings.
 *
 * WhatsApp forbids cold-calling, so this is never simply "dial". Depending on
 * what the customer has granted it asks for permission, waits for her answer,
 * explains why it cannot ask again yet, or places the call — and while a call
 * is up it becomes the hang-up control and the only place the call is visible.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Clock, Phone, PhoneOff, PhoneOutgoing, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { OutboundCall, type CallState } from "@/lib/webrtc/outbound-call";

interface Permission {
  callable: boolean;
  status: "none" | "requested" | "granted" | "declined" | "expired" | "revoked";
  expiresAt: string | null;
  canRequest: boolean;
  authoritative: boolean;
  requestChannel: "free_form" | "template";
  requestAvailable: boolean;
}

const IDLE: CallState = {
  phase: "idle",
  waCallId: null,
  error: null,
  relayMissing: false,
  startedAt: null,
};

function elapsed(startedAt: number | null, now: number): string {
  if (!startedAt) return "";
  const total = Math.max(0, Math.floor((now - startedAt) / 1000));
  const minutes = String(Math.floor(total / 60)).padStart(2, "0");
  const seconds = String(total % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function CallControl({
  conversationId,
  disabled,
}: {
  conversationId: string;
  /** Groups carry a jid, not a number — there is nobody to call. */
  disabled?: boolean;
}) {
  /**
   * Stamped with the conversation it describes.
   *
   * Switching threads mid-fetch would otherwise show the previous customer's
   * permission against this one — and "may we call her" is exactly the wrong
   * question to answer about the wrong person. A stamp that does not match the
   * open thread reads as "not loaded yet".
   */
  const [loaded, setLoaded] = useState<{
    conversationId: string;
    data: Permission;
  } | null>(null);
  const permission =
    loaded?.conversationId === conversationId ? loaded.data : null;

  const [requesting, setRequesting] = useState(false);
  // Stamped for the same reason as `loaded`: an error about one customer
  // must not linger in another customer's header.
  const [lastNotice, setNotice] = useState<{
    conversationId: string;
    text: string;
  } | null>(null);
  const notice =
    lastNotice?.conversationId === conversationId ? lastNotice.text : null;
  const [call, setCall] = useState<CallState>(IDLE);
  const [now, setNow] = useState(() => Date.now());

  const callRef = useRef<OutboundCall | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const loadPermission = useCallback(async () => {
    if (disabled) return;
    try {
      const response = await fetch(
        `/api/conversations/${conversationId}/call-permission`,
      );
      if (!response.ok) return;
      const data = (await response.json()) as Permission;
      setLoaded({ conversationId, data });
    } catch {
      // Calling is an extra capability; a failed lookup hides the control
      // rather than pushing an error into the thread header.
    }
  }, [conversationId, disabled]);

  // Inline rather than a call to `loadPermission`, matching how the rest of
  // this app fetches on mount: the cancelled flag drops a response that
  // arrives after the employee has already moved to another thread.
  useEffect(() => {
    if (disabled) return;
    let cancelled = false;
    void fetch(`/api/conversations/${conversationId}/call-permission`, {
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok || cancelled) return;
        const data = (await response.json()) as Permission;
        if (!cancelled) setLoaded({ conversationId, data });
      })
      .catch(() => {
        // Calling is an extra capability; a failed lookup hides the control
        // rather than pushing an error into the thread header.
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId, disabled]);

  // Hanging up when the employee switches threads would be worse than leaving
  // the call up, so the call survives; only the timer is per-mount.
  useEffect(() => {
    if (call.phase !== "connected") return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [call.phase]);

  useEffect(() => {
    return () => {
      void callRef.current?.dispose();
      callRef.current = null;
    };
  }, []);

  const startCall = useCallback(async () => {
    if (callRef.current) return;
    const session = new OutboundCall();
    callRef.current = session;

    const unsubscribe = session.subscribe((state) => {
      setCall(state);
      if (state.phase === "ended" || state.phase === "failed") {
        callRef.current = null;
        // Meta may have revoked permission as part of ending the call — four
        // unanswered calls do exactly that — so re-read rather than assume.
        void loadPermission();
      }
    });

    if (audioRef.current) audioRef.current.srcObject = session.remoteStream;
    await session.start(conversationId);
    // The state machine drives everything from here; the subscription is
    // released when the component unmounts.
    void unsubscribe;
  }, [conversationId, loadPermission]);

  const hangUp = useCallback(async () => {
    await callRef.current?.hangUp();
    callRef.current = null;
  }, []);

  const requestPermission = useCallback(async () => {
    setRequesting(true);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/conversations/${conversationId}/call-permission`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
      );
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setNotice({
          conversationId,
          text: body.error ?? "تعذّر إرسال طلب الإذن",
        });
      }
      await loadPermission();
    } finally {
      setRequesting(false);
    }
  }, [conversationId, loadPermission]);

  if (disabled) return null;

  const live =
    call.phase === "dialling" ||
    call.phase === "ringing" ||
    call.phase === "connected" ||
    call.phase === "preparing";

  // A live call outranks every permission state: it is the only thing on this
  // screen that is happening right now.
  if (live) {
    const label =
      call.phase === "connected"
        ? elapsed(call.startedAt, now)
        : call.phase === "ringing"
          ? "جاري الرنين…"
          : "جاري الاتصال…";
    return (
      <div className="flex shrink-0 items-center gap-2">
        <audio ref={audioRef} autoPlay />
        <span
          className="hidden items-center gap-1 text-xs font-medium text-emerald-700 tabular-nums sm:flex"
          aria-live="polite"
        >
          <span
            className={cn(
              "size-2 rounded-full bg-emerald-500",
              call.phase !== "connected" && "animate-pulse",
            )}
            aria-hidden="true"
          />
          {label}
        </span>
        {call.relayMissing ? (
          <TriangleAlert
            size={13}
            className="text-amber-600"
            aria-label="خادم TURN غير مُهيّأ — قد تفشل المكالمة على بعض الشبكات"
          />
        ) : null}
        <Button
          type="button"
          onClick={hangUp}
          variant="destructive"
          size="lg"
          aria-label="إنهاء المكالمة"
          className="min-h-10 shrink-0"
        >
          <PhoneOff data-icon="inline-start" aria-hidden="true" />
          <span className="hidden sm:inline">إنهاء</span>
        </Button>
      </div>
    );
  }

  if (!permission) return null;

  if (permission.callable) {
    return (
      <div className="flex shrink-0 items-center gap-2">
        <audio ref={audioRef} autoPlay />
        {call.error ? (
          <span className="hidden max-w-40 truncate text-xs text-destructive sm:inline">
            {call.error}
          </span>
        ) : null}
        <Button
          type="button"
          onClick={startCall}
          variant="secondary"
          size="lg"
          aria-label="اتصال صوتي عبر واتساب"
          className="min-h-10 shrink-0"
        >
          <Phone data-icon="inline-start" aria-hidden="true" />
          <span className="hidden sm:inline">اتصال</span>
        </Button>
      </div>
    );
  }

  if (permission.status === "requested") {
    return (
      <span className="hidden shrink-0 items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-700 sm:inline-flex">
        <Clock size={11} className="shrink-0" aria-hidden="true" />
        بانتظار إذن الاتصال
      </span>
    );
  }

  if (!permission.requestAvailable) {
    // The two blocked reasons are kept apart because only one is actionable:
    // a closed window reopens the moment the customer writes again, while the
    // ask quota is simply spent.
    return (
      <span className="hidden shrink-0 items-center gap-1 rounded-full border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-[10px] font-medium text-neutral-600 sm:inline-flex">
        <PhoneOff size={11} className="shrink-0" aria-hidden="true" />
        {permission.requestChannel === "template"
          ? "لطلب الإذن انتظري رد العميلة"
          : "تم طلب الإذن مؤخرًا"}
      </span>
    );
  }

  return (
    <div className="flex shrink-0 items-center gap-2">
      {notice ? (
        <span className="hidden max-w-40 truncate text-xs text-destructive sm:inline">
          {notice}
        </span>
      ) : null}
      <Button
        type="button"
        onClick={requestPermission}
        disabled={requesting}
        variant="secondary"
        size="lg"
        aria-label="طلب إذن الاتصال من الزبونة"
        className="min-h-10 shrink-0"
      >
        <PhoneOutgoing data-icon="inline-start" aria-hidden="true" />
        <span className="hidden sm:inline">
          {requesting ? "جارٍ الإرسال…" : "طلب إذن الاتصال"}
        </span>
      </Button>
    </div>
  );
}
