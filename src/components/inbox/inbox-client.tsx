"use client";

import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  Send,
  UserCheck,
  UserX,
  Repeat,
  Search,
  Tag,
  Plus,
  StickyNote,
  MessageSquareText,
  ChevronRight,
  MoreVertical,
  Paperclip,
  Mic,
  Square,
  Truck,
} from "lucide-react";

// Lazy — keep the large order form out of the initial inbox bundle. The module
// is warmed after the inbox settles and on button intent, while Suspense gives
// an immediate sheet if someone taps before that finishes.
const loadCreateOrderSheet = () =>
  import("./create-order-sheet").then((module) => ({
    default: module.CreateOrderSheet,
  }));
const CreateOrderSheet = lazy(loadCreateOrderSheet);
import { Modal } from "@/components/ui/modal";
import { WhatsAppIcon } from "@/components/icons/whatsapp";
import { cn } from "@/lib/utils";
import type {
  Conversation,
  Message,
  AgentInfo,
  CsStatus,
  Label,
  LabelColor,
} from "@/lib/types";
import type { InternalNote } from "@/lib/notes";
import type { SavedReply } from "@/lib/saved-replies";
import { formatRelativeTime, agentDisplayName } from "@/lib/format";
import { loadDispatchOptions } from "@/lib/dispatch-options-client";
import { MessageBubble } from "./message-bubble";
import { useInboxRealtime } from "./use-inbox-realtime";
import {
  AttachmentPreview,
  type PendingAttachment,
} from "./attachment-preview";

const CS_STATUS_LABEL: Record<CsStatus, string> = {
  open: "مفتوحة",
  waiting: "بانتظار العميل",
  resolved: "منتهية",
};
const CS_STATUS_ORDER: CsStatus[] = ["open", "waiting", "resolved"];

const LABEL_CLASSES: Record<LabelColor, string> = {
  slate: "bg-slate-100 text-slate-700 border-slate-300",
  red: "bg-red-100 text-red-700 border-red-300",
  amber: "bg-amber-100 text-amber-700 border-amber-300",
  emerald: "bg-emerald-100 text-emerald-700 border-emerald-300",
  blue: "bg-blue-100 text-blue-700 border-blue-300",
  indigo: "bg-indigo-100 text-indigo-700 border-indigo-300",
  fuchsia: "bg-fuchsia-100 text-fuchsia-700 border-fuchsia-300",
  rose: "bg-rose-100 text-rose-700 border-rose-300",
};
const NEW_LABEL_COLORS: LabelColor[] = [
  "slate",
  "red",
  "amber",
  "emerald",
  "blue",
  "indigo",
  "fuchsia",
  "rose",
];

type View = "all" | "mine" | "unassigned" | "unread";

function csStatusOf(c: Conversation): CsStatus {
  const meta = (c.metadata as { cs_status?: CsStatus } | null) || {};
  if (meta.cs_status) return meta.cs_status;
  return c.status === "resolved" ? "resolved" : "open";
}
function isHandledOnWhatsApp(c: Conversation): boolean {
  return Boolean(
    (c.metadata as { handled_on_whatsapp?: boolean } | null)?.handled_on_whatsapp
  );
}

export function InboxClient({
  conversations,
  agents,
  myTeamMemberId,
  isAdmin,
  labels: initialLabels,
  labelAssignments: initialAssignments,
  savedReplies,
}: {
  conversations: Conversation[];
  agents: AgentInfo[];
  myTeamMemberId: string | null;
  myEmail: string | null;
  isAdmin: boolean;
  labels: Label[];
  labelAssignments: Record<string, string[]>;
  savedReplies: SavedReply[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [notes, setNotes] = useState<InternalNote[]>([]);
  const [noteDraft, setNoteDraft] = useState("");
  const [repliesOpen, setRepliesOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [orderOpen, setOrderOpen] = useState(false);
  const [orderSheetMounted, setOrderSheetMounted] = useState(false);

  const preloadOrderSheet = useCallback(() => {
    void loadCreateOrderSheet();
    void loadDispatchOptions().catch(() => {
      // The visible sheet owns error feedback if the warm-up fails.
    });
  }, []);

  // Warm the infrequently used feature only after the inbox has become usable.
  // This keeps navigation fast but removes the first-open network waterfall.
  useEffect(() => {
    const timer = window.setTimeout(preloadOrderSheet, 1200);
    return () => window.clearTimeout(timer);
  }, [preloadOrderSheet]);

  // Media
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  // Attachments staged for review before sending (WhatsApp-style).
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [activeAttachment, setActiveAttachment] = useState(0);
  const pendingRef = useRef<PendingAttachment[]>([]);
  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  // Message list scrolling. A chat should open at the newest message, and new
  // arrivals should only pull the view down if the reader is already there —
  // yanking someone out of older messages mid-read is worse than not moving.
  const listRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  const onListScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);

  useEffect(() => {
    if (nearBottomRef.current) scrollToBottom();
  }, [messages, scrollToBottom]);

  const [labels, setLabels] = useState<Label[]>(initialLabels);
  const [assignments, setAssignments] =
    useState<Record<string, string[]>>(initialAssignments);
  const [newLabelName, setNewLabelName] = useState("");
  const [newLabelColor, setNewLabelColor] = useState<LabelColor>("blue");

  // Filters
  const [search, setSearch] = useState("");
  const [view, setView] = useState<View>("all");
  const [statusFilter, setStatusFilter] = useState<CsStatus | "all">("all");
  const [labelFilter, setLabelFilter] = useState<string>("all");
  // Conversations read in this session — clears the badge before the server
  // render catches up, and keeps it clear while the thread stays open.
  const [locallyRead, setLocallyRead] = useState<Set<string>>(() => new Set());
  const unreadOf = useCallback(
    (c: Conversation) => (locallyRead.has(c.id) ? 0 : c.unread_count ?? 0),
    [locallyRead]
  );

  const labelMap = useMemo(
    () => Object.fromEntries(labels.map((l) => [l.id, l])),
    [labels]
  );
  const agentMap = useMemo(
    () => Object.fromEntries(agents.map((a) => [a.id, a])),
    [agents]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return conversations.filter((c) => {
      if (q) {
        const hay = `${c.customer_name ?? ""} ${c.customer_phone}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (view === "mine" && c.assigned_to !== myTeamMemberId) return false;
      if (view === "unassigned" && c.assigned_to) return false;
      if (view === "unread" && !unreadOf(c)) return false;
      if (statusFilter !== "all" && csStatusOf(c) !== statusFilter) return false;
      if (labelFilter !== "all" && !(assignments[c.id] ?? []).includes(labelFilter))
        return false;
      return true;
    });
  }, [
    conversations,
    search,
    view,
    statusFilter,
    labelFilter,
    assignments,
    myTeamMemberId,
    unreadOf,
  ]);

  /**
   * Clear a conversation's unread badge. Tracked locally as well as on the
   * server so the badge disappears on tap rather than waiting for the next
   * server render.
   */
  const markRead = useCallback(
    (conversationId: string) => {
      setLocallyRead((prev) => {
        if (prev.has(conversationId)) return prev;
        const next = new Set(prev);
        next.add(conversationId);
        return next;
      });
      void fetch(`/api/conversations/${conversationId}/read`, { method: "POST" }).catch(
        () => {}
      );
    },
    []
  );

  const loadMessages = useCallback(
    async (c: Conversation) => {
      setSelected(c);
      setOptionsOpen(false);
      setNoteDraft("");
      setMediaError(null);
      setLoading(true);
      setMessages([]);
      setNotes([]);
      setDraft("");
      // A freshly opened thread always starts pinned to the newest message.
      nearBottomRef.current = true;
      markRead(c.id);
      try {
        const [mRes, nRes] = await Promise.all([
          fetch(`/api/conversations/${c.id}/messages`),
          fetch(`/api/conversations/${c.id}/notes`),
        ]);
        const mData = await mRes.json();
        const nData = await nRes.json();
        setMessages(mData.messages ?? []);
        setNotes(nData.notes ?? []);
      } catch {
        setMessages([]);
      } finally {
        setLoading(false);
      }
    },
    [markRead]
  );

  // ---- live updates (Supabase Realtime) ----
  // Refs so the realtime callbacks always see the current selection without
  // resubscribing on every render.
  const selectedRef = useRef<Conversation | null>(null);
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  // Conversation-list changes arrive in bursts (message insert + unread bump +
  // reorder) — coalesce them into one server refresh.
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleListRefresh = useCallback(() => {
    if (refreshTimer.current) return;
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      router.refresh();
    }, 800);
  }, [router]);
  useEffect(
    () => () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    },
    []
  );

  // Silently refetch the open thread (through the API — it signs media URLs).
  const onRealtimeMessage = useCallback(
    async (conversationId: string) => {
      if (selectedRef.current?.id !== conversationId) {
        // Not the open thread: drop any local "read" mark so the badge can
        // come back for the newly arrived message.
        setLocallyRead((prev) => {
          if (!prev.has(conversationId)) return prev;
          const next = new Set(prev);
          next.delete(conversationId);
          return next;
        });
        return;
      }
      // Open thread: it's being read right now, so keep it clear and pull the
      // new message in (the server bumps unread_count on every inbound).
      markRead(conversationId);
      try {
        const res = await fetch(`/api/conversations/${conversationId}/messages`);
        const data = await res.json();
        setMessages(data.messages ?? []);
      } catch {
        // keep whatever is on screen; the next event or refresh will catch up
      }
    },
    [markRead]
  );

  // Delivery status settles server-side after the send response, so patch the
  // row in place rather than refetching the whole thread for one field.
  const onRealtimeMessageUpdated = useCallback(
    (
      id: string,
      patch: {
        delivery_status?: string | null;
        external_message_sid?: string | null;
      }
    ) => {
      setMessages((prev) => {
        const i = prev.findIndex((m) => m.id === id);
        if (i === -1) return prev;
        const next = [...prev];
        next[i] = { ...next[i], ...patch };
        return next;
      });
    },
    []
  );

  useInboxRealtime({
    onNewMessage: onRealtimeMessage,
    onMessageUpdated: onRealtimeMessageUpdated,
    onConversationsChanged: scheduleListRefresh,
  });

  // On phones the thread replaces the list, so the phone's back gesture should
  // return to the list rather than leave the app. Pushing a history entry when
  // a thread opens gets that behaviour for free.
  const selectedId = selected?.id ?? null;
  useEffect(() => {
    if (!selectedId) return;
    window.history.pushState({ kiaraThread: selectedId }, "");
    const onPop = () => setSelected(null);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [selectedId]);

  const closeThread = useCallback(() => {
    // Route through history so the entry pushed above is consumed; the
    // popstate listener is what actually clears the selection.
    if (window.history.state?.kiaraThread) window.history.back();
    else setSelected(null);
  }, []);

  const addNote = useCallback(async () => {
    if (!selected || !noteDraft.trim()) return;
    const text = noteDraft.trim();
    setNoteDraft("");
    const res = await fetch(`/api/conversations/${selected.id}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: text }),
    });
    const data = await res.json();
    if (data?.note) setNotes((n) => [...n, data.note]);
  }, [selected, noteDraft]);

  const act = useCallback(
    async (path: string, body?: unknown) => {
      if (!selected) return;
      setBusy(true);
      try {
        await fetch(`/api/conversations/${selected.id}/${path}`, {
          method: "POST",
          headers: body ? { "Content-Type": "application/json" } : undefined,
          body: body ? JSON.stringify(body) : undefined,
        });
        router.refresh();
      } finally {
        setBusy(false);
      }
    },
    [selected, router]
  );

  const sendReply = useCallback(async () => {
    if (!selected || !draft.trim()) return;
    const conversationId = selected.id;
    const text = draft.trim();
    setDraft("");
    // Collapse the auto-grown composer back to one line.
    if (composerRef.current) composerRef.current.style.height = "auto";
    nearBottomRef.current = true;

    // Show the message immediately. The old flow cleared the composer and then
    // waited on reply + a full thread refetch + router.refresh() before the text
    // reappeared, so it looked like the message had been swallowed for seconds.
    const tempId = `pending-${crypto.randomUUID()}`;
    setMessages((prev) => [
      ...prev,
      {
        id: tempId,
        conversation_id: conversationId,
        role: "agent",
        content: text,
        message_type: "text",
        delivery_status: "queued",
        created_at: new Date().toISOString(),
      },
    ]);

    try {
      const res = await fetch(`/api/conversations/${conversationId}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text }),
      });
      const data = await res.json().catch(() => ({}));
      // Swap the temp row for the real one. If the realtime INSERT already
      // replaced the whole array this finds nothing, which is fine — the server
      // copy is authoritative either way. No refetch, no router.refresh(): the
      // realtime subscription already schedules the conversation-list refresh.
      setMessages((prev) =>
        prev.map((m) =>
          m.id === tempId
            ? {
                ...m,
                id: (data?.messageId as string) ?? m.id,
                delivery_status: !res.ok
                  ? "failed"
                  : data?.sent
                    ? "sent"
                    : "queued",
              }
            : m
        )
      );
    } catch {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === tempId ? { ...m, delivery_status: "failed" } : m
        )
      );
    }
  }, [selected, draft]);

  /** Upload + send one file. Returns false so callers can stop a batch. */
  const sendFile = useCallback(
    async (file: File, caption = ""): Promise<boolean> => {
      if (!selected) return false;
      setMediaError(null);
      try {
        const form = new FormData();
        form.append("file", file);
        if (caption) form.append("caption", caption);
        const res = await fetch(`/api/conversations/${selected.id}/media`, {
          method: "POST",
          body: form,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setMediaError(data?.error ?? "تعذّر إرسال الملف");
          return false;
        }
        const m = await fetch(`/api/conversations/${selected.id}/messages`);
        setMessages((await m.json()).messages ?? []);
        router.refresh();
        return true;
      } catch {
        setMediaError("تعذّر إرسال الملف");
        return false;
      }
    },
    [selected, router]
  );

  /**
   * Picking files stages them for review instead of sending — same as
   * WhatsApp. Nothing uploads until the preview's send button is pressed.
   */
  const onPickFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      // Reset first so picking the same file twice still fires onChange.
      e.target.value = "";
      if (!files.length) return;
      setMediaError(null);
      setPending((prev) => {
        const next = files.map((file, i) => ({
          id: `${Date.now()}-${i}-${file.name}`,
          file,
          url: URL.createObjectURL(file),
          isImage: file.type.startsWith("image/"),
          // Carry whatever was already typed onto the first attachment.
          caption: prev.length === 0 && i === 0 ? draft.trim() : "",
        }));
        if (prev.length === 0) setDraft("");
        return [...prev, ...next];
      });
    },
    [draft]
  );

  const discardPending = useCallback(() => {
    setPending((prev) => {
      prev.forEach((p) => URL.revokeObjectURL(p.url));
      return [];
    });
    setActiveAttachment(0);
    setMediaError(null);
  }, []);

  const removePending = useCallback((id: string) => {
    setPending((prev) => {
      const gone = prev.find((p) => p.id === id);
      if (gone) URL.revokeObjectURL(gone.url);
      const next = prev.filter((p) => p.id !== id);
      setActiveAttachment((i) => Math.max(0, Math.min(i, next.length - 1)));
      return next;
    });
  }, []);

  /** Replace a staged image with its cropped version, keeping the caption. */
  const applyCrop = useCallback((id: string, blob: Blob) => {
    setPending((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        URL.revokeObjectURL(p.url);
        const name = p.file.name.replace(/\.[^.]+$/, "") + ".jpg";
        const file = new File([blob], name, { type: blob.type || "image/jpeg" });
        return { ...p, file, url: URL.createObjectURL(file) };
      })
    );
  }, []);

  /** Send every staged attachment in order, each with its own caption. */
  const sendPending = useCallback(async () => {
    if (!pending.length) return;
    setMediaError(null);
    setUploading(true);
    try {
      for (const item of pending) {
        const ok = await sendFile(item.file, item.caption.trim());
        if (!ok) return; // sendFile already surfaced the reason; keep the queue
      }
      discardPending();
    } finally {
      setUploading(false);
    }
  }, [pending, sendFile, discardPending]);

  // Don't leak object URLs if the thread closes with attachments staged.
  useEffect(() => {
    return () => {
      pendingRef.current.forEach((p) => URL.revokeObjectURL(p.url));
    };
  }, []);

  /** Hold-to-record a WhatsApp-style voice note via MediaRecorder. */
  const startRecording = useCallback(async () => {
    setMediaError(null);

    // getUserMedia only exists in a secure context. Over plain HTTP — e.g.
    // opening the dev server from a phone by LAN IP — the API is absent and
    // the browser never shows a permission prompt at all, so "grant access"
    // would be misleading advice.
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setMediaError(
        typeof window !== "undefined" && !window.isSecureContext
          ? "تسجيل الصوت يتطلب اتصالاً آمنًا (HTTPS). افتحي رابط التطبيق الرسمي بدل عنوان الشبكة المحلية."
          : "هذا المتصفح لا يدعم تسجيل الصوت."
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Prefer ogg/opus — that's what WhatsApp uses for voice notes; Safari
      // only offers mp4, which still sends fine as audio.
      const mime = MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")
        ? "audio/ogg;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "";
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (ev) => {
        if (ev.data.size) chunksRef.current.push(ev.data);
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const type = rec.mimeType || "audio/ogg";
        const blob = new Blob(chunksRef.current, { type });
        chunksRef.current = [];
        if (blob.size > 0) {
          const ext = type.includes("mp4") ? "m4a" : type.includes("webm") ? "webm" : "ogg";
          // Voice notes send straight away — there's nothing to preview.
          setUploading(true);
          try {
            await sendFile(new File([blob], `voice-${Date.now()}.${ext}`, { type }));
          } finally {
            setUploading(false);
          }
        }
      };
      rec.start();
      recorderRef.current = rec;
      setRecording(true);
    } catch (e) {
      // Each of these needs a different action from the user, so don't collapse
      // them into one message. A denied permission in particular cannot be
      // re-prompted from JS — it has to be reset in the browser's site settings.
      const name = e instanceof DOMException ? e.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        setMediaError(
          "الميكروفون محظور لهذا الموقع. افتحي إعدادات الموقع في المتصفح (رمز القفل بجانب العنوان) وفعّلي الميكروفون، ثم أعيدي المحاولة."
        );
      } else if (name === "NotFoundError" || name === "OverconstrainedError") {
        setMediaError("لا يوجد ميكروفون متاح في هذا الجهاز.");
      } else if (name === "NotReadableError") {
        setMediaError("الميكروفون مشغول بتطبيق آخر. أغلقيه ثم أعيدي المحاولة.");
      } else {
        setMediaError("تعذّر بدء التسجيل. حاولي مرة أخرى.");
      }
    }
  }, [sendFile]);

  const stopRecording = useCallback(() => {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
  }, []);

  const toggleLabel = useCallback(
    async (labelId: string) => {
      if (!selected) return;
      const current = assignments[selected.id] ?? [];
      const next = current.includes(labelId)
        ? current.filter((x) => x !== labelId)
        : [...current, labelId];
      setAssignments((a) => ({ ...a, [selected.id]: next }));
      await fetch(`/api/conversations/${selected.id}/labels`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ labelIds: next }),
      });
    },
    [selected, assignments]
  );

  const createLabel = useCallback(async () => {
    const name = newLabelName.trim();
    if (!name) return;
    const res = await fetch(`/api/labels`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, color: newLabelColor }),
    });
    const data = await res.json();
    if (data?.label) {
      setLabels((ls) => [...ls, data.label]);
      setNewLabelName("");
      if (selected) void toggleLabel(data.label.id);
    }
  }, [newLabelName, newLabelColor, selected, toggleLabel]);

  const ownerLabel = (c: Conversation): string | null => {
    if (!c.assigned_to) return null;
    if (c.assigned_to === myTeamMemberId) return "أنت";
    return agentDisplayName(agentMap[c.assigned_to]);
  };

  const selectedLabelIds = selected ? assignments[selected.id] ?? [] : [];

  // Offered as a one-tap fill for the order's location field — the latest thing
  // the customer typed is usually where they said their address.
  const lastCustomerText = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === "customer" && m.message_type === "text" && m.content?.trim()) {
        return m.content.trim();
      }
    }
    return null;
  })();

  return (
    <div className="flex h-full">
      {/* Conversation list. On phones this is a full-screen view that swaps
          with the thread; from lg it becomes a permanent sidebar. */}
      <aside
        className={cn(
          "w-full flex-col border-l bg-[var(--surface)] lg:flex lg:max-w-sm",
          selected ? "hidden lg:flex" : "flex"
        )}
      >
        <div className="shrink-0 space-y-2 border-b px-3 py-3">
          <div className="flex items-center gap-2 rounded-lg border px-2">
            <Search size={14} className="text-[var(--subtle)]" />
            <input
              type="search"
              name="conversation-search"
              autoComplete="off"
              spellCheck={false}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="بحث في المحادثات"
              placeholder="بحث بالاسم أو الرقم…"
              className="min-h-10 w-full bg-transparent text-sm outline-none"
            />
          </div>
          {/* Touch-sized filter controls (≥36px tall) rather than 11px pills. */}
          <div className="flex flex-wrap gap-1.5">
            {(["all", "mine", "unassigned", "unread"] as View[]).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                aria-pressed={view === v}
                className={cn(
                  "min-h-9 rounded-full border px-3 text-xs transition-colors",
                  view === v
                    ? "border-[var(--brand)] bg-[var(--brand)] text-white"
                    : "text-[var(--muted)] hover:bg-[var(--brand-soft)]"
                )}
              >
                {v === "all" ? "الكل" : v === "mine" ? "لي" : v === "unassigned" ? "غير مسندة" : "غير مقروءة"}
              </button>
            ))}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as CsStatus | "all")}
              aria-label="تصفية حسب الحالة"
              className="min-h-9 rounded-full border px-2 text-xs text-[var(--muted)]"
            >
              <option value="all">كل الحالات</option>
              {CS_STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {CS_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
            {labels.length > 0 ? (
              <select
                value={labelFilter}
                onChange={(e) => setLabelFilter(e.target.value)}
                aria-label="تصفية حسب التصنيف"
                className="min-h-9 rounded-full border px-2 text-xs text-[var(--muted)]"
              >
                <option value="all">كل التصنيفات</option>
                {labels.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
          <p className="text-[11px] text-[var(--subtle)]">{filtered.length} محادثة</p>
        </div>

        <div className="scroll-pane min-h-0 flex-1">
          {filtered.length === 0 ? (
            <p className="p-4 text-sm text-[var(--muted)]">لا توجد نتائج.</p>
          ) : (
            filtered.map((c) => {
              const cs = csStatusOf(c);
              const owner = ownerLabel(c);
              const wa = isHandledOnWhatsApp(c);
              const cLabels = (assignments[c.id] ?? [])
                .map((id) => labelMap[id])
                .filter(Boolean) as Label[];
              return (
                <button
                  key={c.id}
                  onClick={() => loadMessages(c)}
                  className={cn(
                    "flex w-full flex-col gap-1 border-b px-4 py-3 text-right transition hover:bg-[var(--brand-soft)]",
                    selected?.id === c.id && "bg-[var(--brand-soft)]",
                    wa && "border-r-4 border-r-emerald-500"
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium text-[var(--foreground)]">
                      {c.customer_name || c.customer_phone}
                    </span>
                    <span className="shrink-0 text-[10px] text-[var(--subtle)]">
                      {formatRelativeTime(c.last_message_at)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span dir="ltr" className="truncate text-xs text-[var(--muted)]">
                      {c.customer_phone}
                    </span>
                    <div className="flex items-center gap-1">
                      {wa ? (
                        <span
                          className="flex size-5 items-center justify-center rounded-full bg-emerald-100 text-emerald-600"
                          title="تمت المعالجة عبر تطبيق واتساب"
                        >
                          <WhatsAppIcon size={12} />
                          <span className="sr-only">تمت المعالجة عبر تطبيق واتساب</span>
                        </span>
                      ) : null}
                      {unreadOf(c) ? (
                        <span className="rounded-full bg-emerald-600 px-1.5 py-0.5 text-[10px] font-medium text-white">
                          {c.unread_count}
                        </span>
                      ) : null}
                      <span className="rounded-full bg-[var(--brand-soft)] px-2 py-0.5 text-[10px] text-[var(--brand)]">
                        {CS_STATUS_LABEL[cs]}
                      </span>
                    </div>
                  </div>
                  {cLabels.length ? (
                    <div className="flex flex-wrap gap-1">
                      {cLabels.map((l) => (
                        <span
                          key={l.id}
                          className={cn(
                            "rounded border px-1.5 py-0.5 text-[9px]",
                            LABEL_CLASSES[l.color]
                          )}
                        >
                          {l.name}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {owner ? (
                    <span className="text-[10px] text-[var(--subtle)]">
                      المسؤول: {owner}
                    </span>
                  ) : null}
                </button>
              );
            })
          )}
        </div>
      </aside>

      {/* Thread */}
      <section
        className={cn(
          "min-w-0 flex-1 flex-col bg-[var(--background)]",
          selected ? "flex" : "hidden lg:flex"
        )}
      >
        {!selected ? (
          <div className="flex flex-1 items-center justify-center text-sm text-[var(--muted)]">
            اختر محادثة لعرضها
          </div>
        ) : (
          <>
            <header className="shrink-0 border-b bg-[var(--surface)]">
              <div className="flex items-center gap-1 px-2 py-2 sm:px-5 sm:py-3">
                {/* RTL: "back" points right. Phone-only — the sidebar is
                    always visible from lg up. */}
                <button
                  type="button"
                  onClick={closeThread}
                  aria-label="العودة إلى قائمة المحادثات"
                  className="flex size-10 shrink-0 items-center justify-center rounded-lg text-[var(--muted)] transition-colors hover:bg-[var(--brand-soft)] lg:hidden"
                >
                  <ChevronRight size={20} aria-hidden="true" />
                </button>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-[var(--foreground)]">
                    {selected.customer_name || selected.customer_phone}
                  </p>
                  <p dir="ltr" className="truncate text-xs text-[var(--muted)]">
                    {selected.customer_phone}
                  </p>
                </div>
                {/* Dispatch the visit to a driver over WhatsApp. */}
                <button
                  type="button"
                  onClick={() => {
                    setOrderSheetMounted(true);
                    setOrderOpen(true);
                  }}
                  onPointerEnter={preloadOrderSheet}
                  onFocus={preloadOrderSheet}
                  onPointerDown={preloadOrderSheet}
                  aria-label="إنشاء طلب للسائق"
                  aria-haspopup="dialog"
                  className="flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg bg-[var(--brand-soft)] px-2.5 text-sm font-medium text-[var(--brand)] transition-colors hover:bg-[var(--brand)] hover:text-white sm:px-3"
                >
                  <Truck size={16} aria-hidden="true" />
                  <span className="hidden sm:inline">طلب سائق</span>
                </button>
                {/* Every other control lives behind this one button so the chat
                    screen itself stays free of chrome. */}
                <button
                  type="button"
                  onClick={() => setOptionsOpen(true)}
                  aria-label="خيارات المحادثة"
                  aria-haspopup="dialog"
                  className="flex size-10 shrink-0 items-center justify-center rounded-lg text-[var(--muted)] transition-colors hover:bg-[var(--brand-soft)]"
                >
                  <MoreVertical size={20} aria-hidden="true" />
                </button>
              </div>
            </header>

            {/* Status strip only — anything actionable lives in the modal. */}
            {selectedLabelIds.length ? (
              <div className="flex flex-wrap items-center gap-1.5 border-b bg-[var(--surface)] px-4 py-1.5">
                {selectedLabelIds
                  .map((id) => labelMap[id])
                  .filter(Boolean)
                  .map((l) => (
                    <span
                      key={(l as Label).id}
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-[11px]",
                        LABEL_CLASSES[(l as Label).color]
                      )}
                    >
                      {(l as Label).name}
                    </span>
                  ))}
              </div>
            ) : null}

            {isHandledOnWhatsApp(selected) ? (
              <div className="flex items-center gap-2 bg-emerald-50 px-4 py-1.5 text-xs text-emerald-700">
                <WhatsAppIcon size={13} /> تمت معالجة هذه المحادثة عبر تطبيق واتساب.
              </div>
            ) : null}

            <div
              ref={listRef}
              onScroll={onListScroll}
              className="scroll-pane min-h-0 flex-1 space-y-2 p-3 sm:p-5"
            >
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-8 text-sm text-[var(--muted)]">
                  <Loader2 size={14} className="animate-spin" /> جارٍ التحميل…
                </div>
              ) : messages.length === 0 ? (
                <p className="py-8 text-center text-sm text-[var(--muted)]">
                  لا توجد رسائل.
                </p>
              ) : (
                messages.map((m) => <MessageBubble key={m.id} message={m} />)
              )}
            </div>

            {mediaError ? (
              <p
                aria-live="polite"
                className="shrink-0 bg-red-50 px-4 py-1.5 text-xs text-red-700"
              >
                {mediaError}
              </p>
            ) : null}

            <div className="safe-b flex shrink-0 items-end gap-2 border-t bg-[var(--surface)] px-3 pt-3 sm:px-4">
              <input
                ref={fileInputRef}
                type="file"
                hidden
                multiple
                accept="image/*,video/*,audio/*,application/pdf,.doc,.docx,.xls,.xlsx,.txt,.csv"
                onChange={onPickFile}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading || recording}
                aria-label="إرفاق صورة أو ملف"
                className="flex size-11 shrink-0 items-center justify-center rounded-lg border text-[var(--muted)] transition-colors hover:bg-[var(--brand-soft)] disabled:opacity-60"
              >
                {uploading ? (
                  <Loader2 size={18} className="animate-spin" aria-hidden="true" />
                ) : (
                  <Paperclip size={18} aria-hidden="true" />
                )}
              </button>
              <button
                type="button"
                onClick={recording ? stopRecording : startRecording}
                disabled={uploading}
                aria-label={recording ? "إيقاف التسجيل وإرسال" : "تسجيل رسالة صوتية"}
                className={cn(
                  "flex size-11 shrink-0 items-center justify-center rounded-lg border transition-colors disabled:opacity-60",
                  recording
                    ? "animate-pulse border-red-300 bg-red-50 text-red-600"
                    : "text-[var(--muted)] hover:bg-[var(--brand-soft)]"
                )}
              >
                {recording ? (
                  <Square size={16} aria-hidden="true" />
                ) : (
                  <Mic size={18} aria-hidden="true" />
                )}
              </button>
              {savedReplies.length ? (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setRepliesOpen((o) => !o)}
                    aria-label="الردود المحفوظة"
                    aria-expanded={repliesOpen}
                    className="flex size-11 items-center justify-center rounded-lg border text-[var(--muted)] transition-colors hover:bg-[var(--brand-soft)]"
                  >
                    <MessageSquareText size={18} aria-hidden="true" />
                  </button>
                  {repliesOpen ? (
                    <div className="absolute bottom-12 right-0 z-10 w-56 rounded-lg border bg-white p-1 shadow-lg">
                      {savedReplies.map((r) => (
                        <button
                          key={r.id}
                          onClick={() => {
                            setDraft((d) => (d ? d + " " : "") + r.body);
                            setRepliesOpen(false);
                          }}
                          className="block w-full truncate rounded px-2 py-1.5 text-right text-xs hover:bg-[var(--brand-soft)]"
                          title={r.body}
                        >
                          <span className="font-medium">{r.title}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
              <textarea
                ref={composerRef}
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  // Grow with the text, like a native composer.
                  const el = e.currentTarget;
                  el.style.height = "auto";
                  el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
                }}
                onFocus={() => {
                  // The keyboard shrinks the visible area; keep the newest
                  // message in view rather than leaving it behind the keyboard.
                  nearBottomRef.current = true;
                  setTimeout(scrollToBottom, 250);
                }}
                onKeyDown={(e) => {
                  // Enter sends on desktop only — on a touch keyboard Enter
                  // must insert a newline, or multi-line replies are impossible.
                  // Queried at press time so there's no hydration-sensitive state.
                  const touch = window.matchMedia("(pointer: coarse)").matches;
                  if (e.key === "Enter" && !e.shiftKey && !touch) {
                    e.preventDefault();
                    void sendReply();
                  }
                }}
                rows={1}
                aria-label="نص الرد"
                placeholder="اكتب ردًا…"
                className="max-h-32 min-h-11 flex-1 resize-none rounded-lg border px-3 py-2.5 text-sm outline-none focus:border-[var(--brand)]"
              />
              <button
                type="button"
                onClick={sendReply}
                disabled={busy || !draft.trim()}
                className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-white transition-opacity disabled:opacity-60 sm:size-auto sm:h-11 sm:gap-1 sm:px-4"
              >
                {busy ? (
                  <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                ) : (
                  <Send size={16} aria-hidden="true" />
                )}
                <span className="sr-only sm:not-sr-only sm:text-sm sm:font-medium">إرسال</span>
              </button>
            </div>

            {/* Everything that isn't the conversation itself. */}
            <Modal
              open={optionsOpen}
              onClose={() => setOptionsOpen(false)}
              title="خيارات المحادثة"
            >
              <div className="space-y-5">
                <section className="space-y-2">
                  <h3 className="text-xs font-semibold text-[var(--subtle)]">الحالة</h3>
                  <select
                    value={csStatusOf(selected)}
                    disabled={busy}
                    onChange={(e) => act("status", { status: e.target.value })}
                    aria-label="حالة المحادثة"
                    className="min-h-11 w-full rounded-lg border bg-white px-3 text-sm"
                  >
                    {CS_STATUS_ORDER.map((s) => (
                      <option key={s} value={s}>
                        {CS_STATUS_LABEL[s]}
                      </option>
                    ))}
                  </select>
                </section>

                <section className="space-y-2">
                  <h3 className="text-xs font-semibold text-[var(--subtle)]">المسؤول</h3>
                  {selected.assigned_to === myTeamMemberId && myTeamMemberId ? (
                    <button
                      type="button"
                      onClick={() => act("release")}
                      disabled={busy}
                      className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border text-sm text-[var(--muted)] hover:bg-[var(--brand-soft)] disabled:opacity-60"
                    >
                      <UserX size={16} aria-hidden="true" /> إطلاق المحادثة
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => act("take")}
                      disabled={busy || !myTeamMemberId}
                      className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-[var(--brand)] text-sm font-medium text-white disabled:opacity-60"
                    >
                      <UserCheck size={16} aria-hidden="true" /> استلام المحادثة
                    </button>
                  )}
                  <div className="flex items-center gap-2">
                    <Repeat size={16} className="shrink-0 text-[var(--muted)]" aria-hidden="true" />
                    <select
                      value=""
                      disabled={busy}
                      onChange={(e) =>
                        e.target.value && act("transfer", { targetTeamMemberId: e.target.value })
                      }
                      aria-label="تحويل المحادثة إلى موظف"
                      className="min-h-11 flex-1 rounded-lg border bg-white px-3 text-sm"
                    >
                      <option value="">تحويل إلى…</option>
                      {agents
                        .filter((a) => a.id !== selected.assigned_to)
                        .map((a) => (
                          <option key={a.id} value={a.id}>
                            {agentDisplayName(a)}
                          </option>
                        ))}
                    </select>
                  </div>
                </section>

                <section className="space-y-2">
                  <h3 className="flex items-center gap-1.5 text-xs font-semibold text-[var(--subtle)]">
                    <Tag size={13} aria-hidden="true" /> التصنيفات
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {labels.map((l) => {
                      const on = selectedLabelIds.includes(l.id);
                      return (
                        <button
                          key={l.id}
                          type="button"
                          onClick={() => toggleLabel(l.id)}
                          aria-pressed={on}
                          className={cn(
                            "min-h-9 rounded-full border px-3 text-xs transition",
                            LABEL_CLASSES[l.color],
                            on ? "ring-2 ring-[var(--brand)]/40" : "opacity-60"
                          )}
                        >
                          {on ? "✓ " : ""}
                          {l.name}
                        </button>
                      );
                    })}
                    {labels.length === 0 ? (
                      <span className="text-xs text-[var(--subtle)]">لا توجد تصنيفات بعد.</span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      value={newLabelName}
                      onChange={(e) => setNewLabelName(e.target.value)}
                      aria-label="اسم التصنيف الجديد"
                      placeholder="تصنيف جديد…"
                      className="min-h-10 flex-1 rounded-lg border px-2 text-sm outline-none"
                    />
                    <div className="flex gap-1">
                      {NEW_LABEL_COLORS.map((col) => (
                        <button
                          key={col}
                          type="button"
                          onClick={() => setNewLabelColor(col)}
                          className={cn(
                            "size-6 rounded-full border",
                            LABEL_CLASSES[col].split(" ")[0],
                            newLabelColor === col
                              ? "ring-2 ring-[var(--brand)] ring-offset-1"
                              : ""
                          )}
                          aria-label={`لون ${col}`}
                        />
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={createLabel}
                      disabled={!newLabelName.trim()}
                      className="flex min-h-10 items-center gap-1 rounded-lg bg-[var(--brand)] px-3 text-xs text-white disabled:opacity-60"
                    >
                      <Plus size={13} aria-hidden="true" /> إضافة
                    </button>
                  </div>
                </section>

                <section className="space-y-2">
                  <h3 className="flex items-center gap-1.5 text-xs font-semibold text-[var(--subtle)]">
                    <StickyNote size={13} aria-hidden="true" /> ملاحظات داخلية — لا تُرسل للعميل
                  </h3>
                  {notes.length === 0 ? (
                    <p className="text-xs text-[var(--subtle)]">لا توجد ملاحظات.</p>
                  ) : (
                    <ul className="space-y-1">
                      {notes.map((n) => (
                        <li
                          key={n.id}
                          className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-slate-700"
                        >
                          {n.body}
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="flex items-center gap-2">
                    <input
                      value={noteDraft}
                      onChange={(e) => setNoteDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void addNote();
                        }
                      }}
                      aria-label="ملاحظة داخلية جديدة"
                      placeholder="أضف ملاحظة داخلية…"
                      className="min-h-10 flex-1 rounded-lg border px-2 text-sm outline-none"
                    />
                    <button
                      type="button"
                      onClick={addNote}
                      disabled={!noteDraft.trim()}
                      className="min-h-10 rounded-lg bg-amber-600 px-3 text-xs text-white disabled:opacity-60"
                    >
                      إضافة
                    </button>
                  </div>
                </section>
              </div>
            </Modal>

            <AttachmentPreview
              items={pending}
              activeIndex={activeAttachment}
              sending={uploading}
              error={mediaError}
              onSetActive={setActiveAttachment}
              onCaptionChange={(id, caption) =>
                setPending((prev) =>
                  prev.map((p) => (p.id === id ? { ...p, caption } : p))
                )
              }
              onRemove={removePending}
              onAddMore={() => fileInputRef.current?.click()}
              onCancel={discardPending}
              onSend={sendPending}
              onCropped={applyCrop}
            />

            {orderSheetMounted ? (
              <Suspense
                fallback={
                  <Modal
                    open={orderOpen}
                    onClose={() => setOrderOpen(false)}
                    title="إنشاء طلب للسائق"
                  >
                    <div
                      className="flex items-center justify-center gap-2 py-10 text-sm text-[var(--muted)]"
                      aria-live="polite"
                    >
                      <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                      جارٍ تجهيز الطلب…
                    </div>
                  </Modal>
                }
              >
                <CreateOrderSheet
                  open={orderOpen}
                  onClose={() => setOrderOpen(false)}
                  conversationId={selected.id}
                  customerPhone={selected.customer_phone}
                  customerName={selected.customer_name ?? null}
                  isAdmin={isAdmin}
                  suggestedLocation={lastCustomerText}
                />
              </Suspense>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
