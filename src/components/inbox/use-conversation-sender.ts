"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

/** A business number a reply can go out from, as the server lists it. */
export type WhatsAppSender = {
  id: string;
  provider: "meta" | "openwa";
  phone: string | null;
  label: string;
  available: boolean;
  unavailableReason: "disabled" | "not_configured" | "disconnected" | "unreachable" | null;
  isDefault: boolean;
};

export const PROVIDER_LABEL: Record<WhatsAppSender["provider"], string> = {
  meta: "Meta Cloud API",
  openwa: "OpenWA",
};

export function senderSummary(sender: WhatsAppSender): string {
  return `${sender.phone ?? sender.label} · ${PROVIDER_LABEL[sender.provider]}`;
}

let sendersRequest: Promise<WhatsAppSender[]> | null = null;
function loadSenders(): Promise<WhatsAppSender[]> {
  // One request per page load; connection state is re-read on the server per send.
  sendersRequest ??= fetch("/api/whatsapp/senders")
    .then((res) => (res.ok ? res.json() : { senders: [] }))
    .then((data: { senders?: WhatsAppSender[] }) => data.senders ?? [])
    .catch(() => {
      sendersRequest = null;
      return [];
    });
  return sendersRequest;
}

/**
 * Which business number replies in this conversation go out from, for the
 * composer's + menu. The choice is saved on the server for the whole team;
 * switching never touches the draft.
 */
export function useConversationSender(conversationId: string | null) {
  const [senders, setSenders] = useState<WhatsAppSender[]>([]);
  const [state, setState] = useState<{ id: string; senderAccountId: string; fieldTeam: boolean } | null>(null);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);

  useEffect(() => {
    let live = true;
    void loadSenders().then((list) => live && setSenders(list));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!conversationId) return;
    let live = true;
    fetch(`/api/conversations/${conversationId}/sender`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { senderAccountId?: string; fieldTeam?: boolean } | null) => {
        if (!live || !data?.senderAccountId) return;
        setState({ id: conversationId, senderAccountId: data.senderAccountId, fieldTeam: Boolean(data.fieldTeam) });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [conversationId]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), notice.error ? 6000 : 3500);
    return () => clearTimeout(timer);
  }, [notice]);

  // Only trust state that belongs to the open conversation.
  const current = state && state.id === conversationId ? state : null;
  const selectedId = current?.senderAccountId ?? "meta";
  const selected = senders.find((sender) => sender.id === selectedId) ?? null;
  const canChoose = Boolean(current) && !current?.fieldTeam && senders.length > 1;
  /** Sent with every message; left out until known, so the server uses the saved choice. */
  const outgoing = current && !current.fieldTeam ? selectedId : undefined;

  const choose = useCallback(
    async (senderAccountId: string) => {
      if (!conversationId || !current || senderAccountId === current.senderAccountId) return;
      const previous = current;
      setState({ ...current, senderAccountId });
      try {
        const res = await fetch(`/api/conversations/${conversationId}/sender`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ senderAccountId }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error((data as { error?: string }).error ?? "تعذّر تغيير رقم الإرسال");
        setNotice({ text: "ستُرسل الرسائل الآن من رقم واتساب مختلف.", error: false });
      } catch (error) {
        setState(previous);
        setNotice({ text: error instanceof Error ? error.message : "تعذّر تغيير رقم الإرسال", error: true });
      }
    },
    [conversationId, current],
  );

  /** Labels for message footers: every non-default number's phone or name. */
  const labels = useMemo(
    () => Object.fromEntries(senders.filter((s) => !s.isDefault).map((s) => [s.id, s.phone ?? s.label])),
    [senders],
  );

  return { senders, selected, selectedId, canChoose, outgoing, choose, notice, setNotice, labels };
}
