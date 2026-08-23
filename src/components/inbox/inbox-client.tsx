"use client";

import {
  Fragment,
  lazy,
  memo,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
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
  CalendarDays,
  CalendarCheck2,
  CalendarClock,
  ClipboardList,
  FileUp,
  Activity,
  BadgeCheck,
  BookOpen,
  Inbox,
  Lock,
  Pencil,
  Bell,
  Check,
  X,
} from "lucide-react";

// Lazy — keep the large order form out of the initial inbox bundle. The module
// is warmed after the inbox settles and on button intent, while Suspense gives
// an immediate sheet if someone taps before that finishes.
const loadCreateOrderSheet = () =>
  import("./create-order-sheet").then((module) => ({
    default: module.CreateOrderSheet,
  }));
const CreateOrderSheet = lazy(loadCreateOrderSheet);

// Same treatment for the catalogue sheet: ~80 services with descriptions have
// no business in the inbox's first paint.
const CatalogSheet = lazy(() =>
  import("./catalog-sheet").then((module) => ({ default: module.CatalogSheet }))
);
import { Modal } from "@/components/ui/modal";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { WhatsAppIcon } from "@/components/icons/whatsapp";
import { cn } from "@/lib/utils";
import type {
  Conversation,
  ConversationSection,
  Message,
  AgentInfo,
  CsStatus,
  Label,
  LabelColor,
  BookingStage,
} from "@/lib/types";
import {
  BOOKING_STAGE_LABEL,
  BOOKING_STAGE_ORDER,
  bookingStageOf,
} from "@/lib/booking-stage";
import {
  SECTION_LABEL,
  SECTION_ORDER,
  bookingRequestOf,
  canViewConversation,
  routedToOf,
  sectionOf,
} from "@/lib/conversation-meta";
import type { InternalNote } from "@/lib/notes";
import type { SavedReply } from "@/lib/saved-replies";
import { formatRelativeTime, agentDisplayName, dayKey } from "@/lib/format";
import { findSharedLocation } from "@/lib/location";
import { normalizePhone, phoneMatches } from "@/lib/phone";
import {
  latestReservationFollowUpOf,
  reservationFollowUpsOf,
  type ReservationFollowUpStatus,
} from "@/lib/reservation-follow-up";
import type { CatalogItem } from "@/lib/catalog";
import { catalogImageFile } from "./catalog-image";
import { loadDispatchOptions } from "@/lib/dispatch-options-client";
import { DaySeparator, MessageBubble } from "./message-bubble";
import {
  useInboxRealtime,
  type ConversationRealtimeChange,
} from "./use-inbox-realtime";
import { TypingDots, useTyping } from "./use-typing";
import {
  AttachmentPreview,
  type PendingAttachment,
} from "./attachment-preview";
import {
  FieldDescription,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const CS_STATUS_LABEL: Record<CsStatus, string> = {
  open: "جاري المحادثة",
  waiting: "استفسار",
  resolved: "تم الطلب",
};
const CS_STATUS_ORDER: CsStatus[] = ["open", "waiting", "resolved"];

const REMINDER_DAY_FMT = new Intl.DateTimeFormat("ar-SA-u-ca-gregory", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "Asia/Riyadh",
});

const BOOKING_STAGE_ICON = {
  collecting_details: ClipboardList,
  awaiting_confirmation: CalendarClock,
  booking_confirmed: CalendarCheck2,
  invoice_required: FileUp,
  in_progress: Activity,
  completed: BadgeCheck,
} satisfies Record<BookingStage, typeof ClipboardList>;

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

type View = "new" | "mine" | "unassigned" | "danger";

/** Messages an opened thread starts with — older ones page in on scroll up. */
const MESSAGE_PAGE_SIZE = 8;
/** One scroll-up pulls a bigger page: 8 at a time would be all round trips. */
const OLDER_PAGE_SIZE = 25;
/** How close to the top counts as "asking for older messages". */
const LOAD_OLDER_THRESHOLD_PX = 120;
const REPLY_ALERT_MS = 6 * 60 * 1000;

/**
 * Fold a page into the thread, keyed by id and ordered by time.
 *
 * Pages overlap by design (the cursor is inclusive so nothing can slip through
 * a shared timestamp) and a realtime refetch re-sends messages already on
 * screen, so both paths need the same dedupe rather than a plain concat.
 */
function mergeMessages(a: Message[], b: Message[]): Message[] {
  const byId = new Map<string, Message>();
  for (const m of [...a, ...b]) byId.set(m.id, m);
  return [...byId.values()].sort(
    (x, y) => new Date(x.created_at).getTime() - new Date(y.created_at).getTime()
  );
}

/** One row of the composer's "+" menu. */
function MenuItem({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2.5 text-right text-sm text-[var(--foreground)] transition-colors hover:bg-[var(--brand-soft)]"
    >
      <span className="text-[var(--brand)]">{icon}</span>
      {label}
    </button>
  );
}

function csStatusOf(c: Conversation): CsStatus {
  const meta = (c.metadata as { cs_status?: CsStatus } | null) || {};
  if (meta.cs_status) return meta.cs_status;
  return c.status === "resolved" ? "resolved" : "open";
}

/** Last inbound is still the newest activity: nobody has answered it yet. */
function unansweredSince(c: Conversation): number | null {
  if (!c.last_inbound_at || csStatusOf(c) === "resolved") return null;
  const inbound = Date.parse(c.last_inbound_at);
  const activity = Date.parse(c.last_message_at);
  if (!Number.isFinite(inbound) || !Number.isFinite(activity)) return null;
  return activity <= inbound + 2_000 ? inbound : null;
}

function replyDelayMinutes(
  c: Conversation,
  now: number,
  dangerExcludedPhoneSet: ReadonlySet<string>
): number | null {
  if (dangerExcludedPhoneSet.has(normalizePhone(c.customer_phone))) return null;
  const since = unansweredSince(c);
  if (since === null || now - since < REPLY_ALERT_MS) return null;
  return Math.max(6, Math.floor((now - since) / 60_000));
}

function conversationStateLabel(c: Conversation): string {
  return c.assigned_to ? CS_STATUS_LABEL[csStatusOf(c)] : "غير مستلمة";
}
function isHandledOnWhatsApp(c: Conversation): boolean {
  return Boolean(
    (c.metadata as { handled_on_whatsapp?: boolean } | null)?.handled_on_whatsapp
  );
}

const EMPTY_LABEL_IDS: readonly string[] = [];

const ConversationListRow = memo(function ConversationListRow({
  conversation,
  selected,
  typing,
  unreadCount,
  bookingCleared,
  labelIds,
  labelMap,
  owner,
  route,
  now,
  dangerExcludedPhoneSet,
  onSelect,
}: {
  conversation: Conversation;
  selected: boolean;
  typing: boolean;
  unreadCount: number;
  bookingCleared: boolean;
  labelIds: readonly string[];
  labelMap: Record<string, Label>;
  owner: string | null;
  route: string | null;
  now: number;
  dangerExcludedPhoneSet: ReadonlySet<string>;
  onSelect: (conversation: Conversation) => void;
}) {
  const section = sectionOf(conversation);
  const bookingStage = bookingStageOf(conversation);
  const handledOnWhatsApp = isHandledOnWhatsApp(conversation);
  const replyOverdue =
    replyDelayMinutes(conversation, now, dangerExcludedPhoneSet) !== null;
  const conversationLabels = labelIds
    .map((id) => labelMap[id])
    .filter((label): label is Label => Boolean(label));

  return (
    <button
      onClick={() => onSelect(conversation)}
      className={cn(
        "flex w-full flex-col gap-1 border-b px-4 py-3 text-right transition [contain-intrinsic-size:auto_96px] [content-visibility:auto] hover:bg-[var(--brand-soft)]",
        selected && "bg-[var(--brand-soft)]",
        handledOnWhatsApp && "border-r-4 border-r-emerald-500"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-medium text-[var(--foreground)]">
          {conversation.customer_name || conversation.customer_phone}
        </span>
        <span className="shrink-0 text-[10px] text-[var(--subtle)]">
          {formatRelativeTime(conversation.last_message_at, now)}
        </span>
      </div>
      <div className="flex items-center justify-between gap-2">
        {typing ? (
          <span className="flex items-center gap-1 truncate text-xs font-medium text-[var(--brand)]">
            يكتب الآن
            <TypingDots />
          </span>
        ) : (
          <span dir="ltr" className="truncate text-xs text-muted-foreground">
            {conversation.customer_phone}
          </span>
        )}
        <div className="flex items-center gap-1">
          {handledOnWhatsApp ? (
            <span
              className="flex size-5 items-center justify-center rounded-full bg-emerald-100 text-emerald-600"
              title="تمت المعالجة عبر تطبيق واتساب"
            >
              <WhatsAppIcon size={12} />
              <span className="sr-only">تمت المعالجة عبر تطبيق واتساب</span>
            </span>
          ) : null}
          {unreadCount ? (
            <span className="rounded-full bg-emerald-600 px-1.5 py-0.5 text-[10px] font-medium text-white">
              {unreadCount}
            </span>
          ) : null}
          {bookingRequestOf(conversation) && !bookingCleared ? (
            <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
              🤖 طلب حجز
            </span>
          ) : null}
          {section ? (
            <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] text-sky-700">
              {SECTION_LABEL[section]}
            </span>
          ) : null}
          {replyOverdue ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive">
              <AlertTriangle aria-hidden="true" />
              تنتظر ردًا
            </span>
          ) : null}
          <span className="rounded-full bg-[var(--brand-soft)] px-2 py-0.5 text-[10px] text-[var(--brand)]">
            {conversationStateLabel(conversation)}
          </span>
          {bookingStage ? (
            <Badge variant="secondary">{BOOKING_STAGE_LABEL[bookingStage]}</Badge>
          ) : null}
        </div>
      </div>
      {conversationLabels.length ? (
        <div className="flex flex-wrap gap-1">
          {conversationLabels.map((label) => (
            <span
              key={label.id}
              className={cn(
                "rounded border px-1.5 py-0.5 text-[9px]",
                LABEL_CLASSES[label.color]
              )}
            >
              {label.name}
            </span>
          ))}
        </div>
      ) : null}
      {owner || route ? (
        <div className="flex flex-wrap items-center gap-1">
          {owner ? (
            <span className="flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-700">
              <UserCheck size={11} aria-hidden="true" />
              المسؤول: {owner}
            </span>
          ) : null}
          {route ? (
            <span className="flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
              <Lock size={11} aria-hidden="true" />
              {route}
            </span>
          ) : null}
        </div>
      ) : null}
    </button>
  );
});

export function InboxClient({
  conversations: serverConversations,
  agents,
  myTeamMemberId,
  isAdmin,
  labels: initialLabels,
  labelAssignments: initialAssignments,
  savedReplies,
  dangerExcludedPhones,
  initialNow,
  initialConversationId = null,
}: {
  conversations: Conversation[];
  agents: AgentInfo[];
  myTeamMemberId: string | null;
  isAdmin: boolean;
  labels: Label[];
  labelAssignments: Record<string, string[]>;
  savedReplies: SavedReply[];
  /** Normalized specialist/driver phones excluded from customer response SLAs. */
  dangerExcludedPhones: string[];
  /** Server snapshot shared by SSR and hydration; the live timer takes over after mount. */
  initialNow: number;
  /** `?c=<id>` — the thread /orders sent the reader here to read. */
  initialConversationId?: string | null;
}) {
  const router = useRouter();
  const [conversations, setConversations] = useState(serverConversations);
  const [syncedServerConversations, setSyncedServerConversations] =
    useState(serverConversations);
  if (syncedServerConversations !== serverConversations) {
    setSyncedServerConversations(serverConversations);
    setConversations(serverConversations);
  }
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  // Older messages page in on scroll; the thread only holds what's been read.
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const loadingOlderRef = useRef(false);

  // Refs so callbacks (realtime handlers, the scroll-up loader) always see the
  // current thread without being rebuilt — and so realtime never resubscribes
  // on selection. Kept next to the state they mirror, and updated before any
  // hook closes over them.
  const messagesRef = useRef<Message[]>([]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  const selectedRef = useRef<Conversation | null>(null);
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(initialNow);
  const [draft, setDraft] = useState("");
  const [notes, setNotes] = useState<InternalNote[]>([]);
  const [noteDraft, setNoteDraft] = useState("");
  const [catalogOpen, setCatalogOpen] = useState(false);
  // Naming the customer from the thread header.
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [savingName, setSavingName] = useState(false);
  // The composer's "+" menu, and which level of it is showing.
  const [plusOpen, setPlusOpen] = useState(false);
  const [plusView, setPlusView] = useState<"menu" | "replies">("menu");
  // Booking requests resolved this session (order created / dismissed) — hides
  // the badge instantly; the server-side metadata clear catches up on refresh.
  const [clearedBookings, setClearedBookings] = useState<Set<string>>(new Set());
  const [optionsOpen, setOptionsOpen] = useState(false);
  /** Reason an admin gives before overriding the current assignee. */
  const [takeoverReason, setTakeoverReason] = useState("");
  const [orderOpen, setOrderOpen] = useState(false);
  const [orderSheetMounted, setOrderSheetMounted] = useState(false);
  const [reminderStatusBusy, setReminderStatusBusy] = useState<
    "awaiting_reply" | "confirmed" | null
  >(null);
  const [reminderStatusError, setReminderStatusError] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const preloadOrderSheet = useCallback(() => {
    void loadCreateOrderSheet();
    void loadDispatchOptions().catch(() => {
      // The visible sheet owns error feedback if the warm-up fails.
    });
  }, []);

  // Media
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  // Attachments staged for review before sending (WhatsApp-style).
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  // A picked service's photo is fetched and re-encoded before it can be staged.
  const [catalogImageBusy, setCatalogImageBusy] = useState(false);
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
  // Height of the list just before older messages are prepended, so the view
  // can be pinned to the message the reader was looking at.
  const anchorRef = useRef<number | null>(null);

  const scrollToBottom = useCallback(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  /**
   * Pull the page above the oldest message on screen. The scroll position is
   * restored from the height the list grew by — otherwise prepending yanks the
   * reader upwards, away from what they were reading.
   */
  const loadOlderMessages = useCallback(async () => {
    const conversation = selectedRef.current;
    const oldest = messagesRef.current[0];
    if (!conversation || !oldest || loadingOlderRef.current) return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    try {
      const res = await fetch(
        `/api/conversations/${conversation.id}/messages?limit=${OLDER_PAGE_SIZE}` +
          `&before=${encodeURIComponent(oldest.created_at)}`
      );
      const data = await res.json();
      if (selectedRef.current?.id !== conversation.id) return; // thread switched
      // Measured here, not before the request: a failed fetch would otherwise
      // leave a stale anchor for the next render to misapply.
      anchorRef.current = listRef.current?.scrollHeight ?? null;
      setMessages((prev) => mergeMessages(data.messages ?? [], prev));
      setHasMoreMessages(Boolean(data.hasMore));
    } catch {
      // Leave the thread as it is; the next scroll can retry.
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, []);

  const onListScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (el.scrollTop < LOAD_OLDER_THRESHOLD_PX && hasMoreMessages && !loadingOlderRef.current) {
      void loadOlderMessages();
    }
  }, [hasMoreMessages, loadOlderMessages]);

  // Runs before paint so neither the jump to the newest message nor the
  // restored scroll position is ever visible as a flicker.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (anchorRef.current != null) {
      if (el) el.scrollTop += el.scrollHeight - anchorRef.current;
      anchorRef.current = null;
      return;
    }
    if (nearBottomRef.current) scrollToBottom();
  }, [messages, scrollToBottom]);

  // An opening page of 8 may not fill a tall screen, and a list that doesn't
  // scroll can never ask for more. Top it up until it does.
  useEffect(() => {
    const el = listRef.current;
    if (!el || loading || loadingOlder || !hasMoreMessages) return;
    if (el.scrollHeight <= el.clientHeight + LOAD_OLDER_THRESHOLD_PX) {
      void loadOlderMessages();
    }
  }, [messages, loading, loadingOlder, hasMoreMessages, loadOlderMessages]);

  const [labels, setLabels] = useState<Label[]>(initialLabels);
  const [assignments, setAssignments] =
    useState<Record<string, string[]>>(initialAssignments);
  const [newLabelName, setNewLabelName] = useState("");
  const [newLabelColor, setNewLabelColor] = useState<LabelColor>("blue");

  // Filters
  const [search, setSearch] = useState("");
  const [view, setView] = useState<View>("new");
  const [statusFilter, setStatusFilter] = useState<CsStatus | "all">("all");
  const [labelFilter, setLabelFilter] = useState<string>("all");
  const [sectionFilter, setSectionFilter] = useState<ConversationSection | "all">(
    "all"
  );
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
  const dangerExcludedPhoneSet = useMemo(
    () => new Set(dangerExcludedPhones),
    [dangerExcludedPhones]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return conversations.filter((c) => {
      if (q) {
        const hay = `${c.customer_name ?? ""} ${c.customer_phone}`.toLowerCase();
        // Staff type "0502376231"; the row stores "+966502376231".
        if (!hay.includes(q) && !phoneMatches(c.customer_phone, q)) return false;
      }
      if (view === "new" && !unreadOf(c)) return false;
      if (view === "mine" && c.assigned_to !== myTeamMemberId) return false;
      if (view === "unassigned" && c.assigned_to) return false;
      if (
        view === "danger" &&
        replyDelayMinutes(c, now, dangerExcludedPhoneSet) === null
      ) {
        return false;
      }
      if (statusFilter !== "all" && csStatusOf(c) !== statusFilter) return false;
      if (sectionFilter !== "all" && sectionOf(c) !== sectionFilter) return false;
      if (labelFilter !== "all" && !(assignments[c.id] ?? []).includes(labelFilter))
        return false;
      return true;
    });
  }, [
    conversations,
    search,
    view,
    statusFilter,
    sectionFilter,
    labelFilter,
    assignments,
    now,
    unreadOf,
    dangerExcludedPhoneSet,
    myTeamMemberId,
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
      setReminderStatusError(null);
      setLoading(true);
      setMessages([]);
      setNotes([]);
      setDraft("");
      setHasMoreMessages(false);
      // A freshly opened thread always starts pinned to the newest message.
      nearBottomRef.current = true;
      anchorRef.current = null;
      markRead(c.id);
      try {
        const [mRes, nRes] = await Promise.all([
          // Only the tail of the thread: the rest arrives as the reader climbs.
          fetch(`/api/conversations/${c.id}/messages?limit=${MESSAGE_PAGE_SIZE}`),
          fetch(`/api/conversations/${c.id}/notes`),
        ]);
        const mData = await mRes.json();
        const nData = await nRes.json();
        setMessages(mData.messages ?? []);
        setHasMoreMessages(Boolean(mData.hasMore));
        setNotes(nData.notes ?? []);
      } catch {
        setMessages([]);
      } finally {
        setLoading(false);
      }
    },
    [markRead]
  );

  // `?c=<id>` opens that thread on arrival — the المحادثة column on /orders
  // links here. Once only: a ref, so closing the thread (or a list refresh)
  // doesn't reopen it under the reader.
  const deepLinkOpened = useRef(false);
  useEffect(() => {
    if (deepLinkOpened.current || !initialConversationId) return;
    const target = conversations.find((c) => c.id === initialConversationId);
    if (!target) return;
    deepLinkOpened.current = true;
    // Opening a thread sets half a dozen pieces of state; doing that in the
    // effect body cascades a second render before the page has even painted.
    const timer = window.setTimeout(() => void loadMessages(target), 0);
    return () => window.clearTimeout(timer);
  }, [initialConversationId, conversations, loadMessages]);

  // `selected` is a snapshot of a list row. When the list refreshes (someone
  // claimed, transferred, or resolved the chat — here or on another device),
  // the open thread must pick up the new row too, or the header chip and the
  // options modal keep showing stale ownership.
  // Adjusted during render rather than in an effect (the React-documented
  // "state derived from props" pattern) so the re-sync happens before paint —
  // and only when the server actually sent a new list, which is what keeps the
  // optimistic patches in `act` visible in between.
  const [syncedList, setSyncedList] = useState(conversations);
  if (syncedList !== conversations) {
    setSyncedList(conversations);
    setSelected((prev) => {
      if (!prev) return prev;
      const fresh = conversations.find((c) => c.id === prev.id);
      if (fresh) return fresh;
      // Gone from an employee's list means the owner just routed it to someone
      // else — close the thread instead of leaving a view they can no longer
      // act on. Admins keep it: their list is never filtered, so a miss there
      // only means the row fell past the 200-row window.
      return isAdmin ? prev : null;
    });
  }

  // ---- live updates (Supabase Realtime) ----
  // Patch exactly one list row. The previous implementation refreshed this
  // entire route after every burst, repeating auth + five database reads.
  const onRealtimeConversation = useCallback(
    (change: ConversationRealtimeChange) => {
      const rowId = change.new.id ?? change.old.id;
      if (!rowId) return;

      setConversations((previous) => {
        if (change.eventType === "DELETE") {
          return previous.filter((conversation) => conversation.id !== rowId);
        }

        const current = previous.find((conversation) => conversation.id === rowId);
        const nextConversation = {
          ...(current ?? {}),
          ...change.new,
        } as Conversation;

        // Realtime is still protected by RLS, and this shared visibility check
        // also removes a row immediately when an admin routes it elsewhere.
        if (
          !canViewConversation(nextConversation, {
            isAdmin,
            teamMemberId: myTeamMemberId,
          })
        ) {
          return previous.filter((conversation) => conversation.id !== rowId);
        }

        const next = [
          nextConversation,
          ...previous.filter((conversation) => conversation.id !== rowId),
        ];
        next.sort((a, b) =>
          (b.last_message_at ?? b.started_at).localeCompare(
            a.last_message_at ?? a.started_at
          )
        );
        return next.slice(0, 200);
      });
    },
    [isAdmin, myTeamMemberId]
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
        // Only the newest page — merged in, so pages already scrolled into
        // view survive the refresh.
        const res = await fetch(
          `/api/conversations/${conversationId}/messages?limit=${MESSAGE_PAGE_SIZE}`
        );
        const data = await res.json();
        setMessages((prev) => mergeMessages(prev, data.messages ?? []));
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
    onConversationChanged: onRealtimeConversation,
  });

  const isTyping = useTyping();

  // Presence subscriptions live on the engine's WhatsApp socket and die with
  // it, so the inbox re-asks on mount instead of trusting they survived.
  useEffect(() => {
    void fetch("/api/whatsapp/presence", { method: "POST" }).catch(() => {});
  }, []);

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

  // While a thread is open on a phone, the app-wide nav row (التقارير،
  // الموظفون، ربط واتساب…) is 50px of things you can't act on from inside a
  // conversation. Flag it on <html> and let CSS collapse it — the nav lives in
  // the server layout, which has no idea a thread is open.
  useEffect(() => {
    const root = document.documentElement;
    if (selectedId) root.dataset.thread = "open";
    else delete root.dataset.thread;
    return () => {
      delete root.dataset.thread;
    };
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

  /**
   * Name the customer from the thread header. Patched locally first — the row,
   * the header and every order sheet read the name off `selected`, and waiting
   * for the server round trip would make the rename feel broken.
   */
  const saveCustomerName = useCallback(async () => {
    if (!selected) return;
    const name = nameDraft.trim().slice(0, 80);
    if (name === (selected.customer_name ?? "")) {
      setEditingName(false);
      return;
    }
    setSavingName(true);
    try {
      const res = await fetch(`/api/conversations/${selected.id}/name`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) return;
      setSelected((p) => (p ? { ...p, customer_name: name || null } : p));
      setEditingName(false);
      router.refresh();
    } catch {
      // Leave the field open with what was typed so it can be retried.
    } finally {
      setSavingName(false);
    }
  }, [nameDraft, router, selected]);

  const act = useCallback(
    async (path: string, body?: unknown) => {
      if (!selected) return;
      setBusy(true);
      try {
        const response = await fetch(`/api/conversations/${selected.id}/${path}`, {
          method: "POST",
          headers: body ? { "Content-Type": "application/json" } : undefined,
          body: body ? JSON.stringify(body) : undefined,
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          setMediaError(data?.error ?? "تعذّر تنفيذ الإجراء");
          return;
        }
        // Ownership changes must show without waiting for the server refresh —
        // the row chip, the header chip, and the options modal all read
        // selected.assigned_to.
        const ownerPatch =
          path === "take" || path === "takeover"
            ? { assigned_to: myTeamMemberId }
            : path === "release"
              ? { assigned_to: null }
              : path === "transfer"
                ? {
                    assigned_to: (body as { targetTeamMemberId: string })
                      .targetTeamMemberId,
                  }
                : null;
        if (ownerPatch) setSelected((p) => (p ? { ...p, ...ownerPatch } : p));

        // Section, routing, and booking stage live in metadata — mirror them
        // locally so the modal and status chip update without a refresh delay.
        if (
          path === "section" ||
          path === "routing" ||
          path === "booking-stage"
        ) {
          const routedTo =
            path === "routing"
              ? ((body as { targetTeamMemberId: string | null }).targetTeamMemberId ??
                null)
              : undefined;
          const bookingStage =
            path === "booking-stage"
              ? (body as { stage: BookingStage }).stage
              : undefined;
          setSelected((p) =>
            p
              ? {
                  ...p,
                  metadata: {
                    ...(p.metadata ?? {}),
                    ...(path === "section"
                      ? { section: (body as { section: string | null }).section }
                      : path === "routing"
                        ? { routed_to: routedTo }
                        : {
                            booking_stage: bookingStage,
                            cs_status:
                              bookingStage === "completed" ? "resolved" : "open",
                          }),
                  },
                  // Routing hands the chat to that employee as well.
                  ...(routedTo ? { assigned_to: routedTo } : {}),
                  ...(bookingStage
                    ? {
                        status:
                          bookingStage === "completed" ? "resolved" : "active",
                      }
                    : {}),
                }
              : p
          );
        }
        router.refresh();
      } finally {
        setBusy(false);
      }
    },
    [selected, router, myTeamMemberId]
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
    async (
      file: File,
      caption = "",
      options: { voiceNote?: boolean } = {}
    ): Promise<boolean> => {
      if (!selected) return false;
      setMediaError(null);
      try {
        const form = new FormData();
        form.append("file", file);
        if (caption) form.append("caption", caption);
        // Keep uploaded songs/audio files as regular attachments. Only audio
        // captured with the microphone should become a WhatsApp voice note.
        if (options.voiceNote) form.append("voiceNote", "true");
        const res = await fetch(`/api/conversations/${selected.id}/media`, {
          method: "POST",
          body: form,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setMediaError(data?.error ?? "تعذّر إرسال الملف");
          return false;
        }
        const m = await fetch(
          `/api/conversations/${selected.id}/messages?limit=${MESSAGE_PAGE_SIZE}`
        );
        const sent = (await m.json()).messages ?? [];
        setMessages((prev) => mergeMessages(prev, sent));
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

  /**
   * A picked service goes into the composer as its photo plus the price text
   * as the caption, so one send carries both. Services without a photo (or
   * whose photo won't load) still fill the draft the way they always did.
   */
  const pickCatalogItem = useCallback(
    async (item: CatalogItem, text: string) => {
      if (!item.imageUrl) {
        setDraft((d) => (d.trim() ? `${d.trim()}\n${text}` : text));
        return;
      }
      setCatalogImageBusy(true);
      const file = await catalogImageFile(item).catch(() => null);
      setCatalogImageBusy(false);
      if (!file) {
        setDraft((d) => (d.trim() ? `${d.trim()}\n${text}` : text));
        return;
      }
      setPending((prev) => {
        // Same rule as picking a file: whatever was typed rides on the first
        // attachment's caption rather than being left behind in the box.
        const typed = prev.length === 0 ? draft.trim() : "";
        if (prev.length === 0) setDraft("");
        return [
          ...prev,
          {
            id: `${item.id}-${prev.length}`,
            file,
            url: URL.createObjectURL(file),
            isImage: true,
            caption: typed ? `${typed}\n${text}` : text,
          },
        ];
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
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 48_000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      // Prefer ogg/opus — that's what WhatsApp uses for voice notes; Safari
      // only offers mp4, which still sends fine as audio.
      const mime = MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")
        ? "audio/ogg;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "";
      // Do not leave quality to browser defaults: some devices choose a very
      // low audio bitrate for MediaRecorder, which becomes worse after
      // WhatsApp's own voice-note processing.
      const rec = new MediaRecorder(stream, {
        ...(mime ? { mimeType: mime } : {}),
        audioBitsPerSecond: 128_000,
      });
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
            await sendFile(
              new File([blob], `voice-${Date.now()}.${ext}`, { type }),
              "",
              { voiceNote: true }
            );
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

  /**
   * What an exclusive route reads as. Only two kinds of people ever see a
   * routed chat: the employee it belongs to, and the admins.
   */
  const routeLabel = (c: Conversation): string | null => {
    const routedTo = routedToOf(c);
    if (!routedTo) return null;
    if (routedTo === myTeamMemberId) return "موجّهة لك";
    return `موجّهة: ${agentDisplayName(agentMap[routedTo])}`;
  };

  const selectedLabelIds = selected ? assignments[selected.id] ?? [] : [];
  const selectedBookingStage = selected ? bookingStageOf(selected) : null;
  const selectedReminder = selected
    ? latestReservationFollowUpOf(selected.metadata)
    : null;
  // Admin is deliberately NOT a blanket reply permission. Overriding another
  // employee goes through takeover, which records a reason on the event.
  const canReply = Boolean(
    selected && myTeamMemberId && selected.assigned_to === myTeamMemberId
  );
  const canTakeOver = Boolean(
    isAdmin &&
      selected?.assigned_to &&
      myTeamMemberId &&
      selected.assigned_to !== myTeamMemberId
  );
  const canTake = Boolean(selected && !selected.assigned_to && myTeamMemberId);
  const selectedReplyOverdue = selected
    ? replyDelayMinutes(selected, now, dangerExcludedPhoneSet) !== null
    : false;

  // Feeds the order's location field: a pin or a maps link she shared fills it
  // outright, a typed line is only offered as a suggestion.
  const sharedLocation = findSharedLocation(messages);

  const updateReminderStatus = async (
    status: "awaiting_reply" | "confirmed"
  ) => {
    const conversation = selectedRef.current;
    const reminder = conversation
      ? latestReservationFollowUpOf(conversation.metadata)
      : null;
    if (!conversation || !reminder || reminderStatusBusy) return;
    setReminderStatusBusy(status);
    setReminderStatusError(null);
    try {
      const response = await fetch(
        `/api/conversations/${conversation.id}/reservation-follow-up`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dayKey: reminder.dayKey, status }),
        }
      );
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        followUp?: {
          status: ReservationFollowUpStatus;
          reminded_at: string | null;
          updated_at: string;
          updated_by: string | null;
        };
      };
      if (!response.ok || !data.followUp) {
        throw new Error(data.error ?? "تعذّر تحديث تأكيد العميلة");
      }

      const patch = (current: Conversation): Conversation => {
        const metadata = current.metadata ?? {};
        const followUps = reservationFollowUpsOf(metadata);
        return {
          ...current,
          metadata: {
            ...metadata,
            reservation_follow_ups: {
              ...followUps,
              [reminder.dayKey]: data.followUp,
            },
            booking_stage:
              status === "confirmed" ? "booking_confirmed" : "awaiting_confirmation",
          },
        };
      };
      setSelected((current) => (current?.id === conversation.id ? patch(current) : current));
      setConversations((current) =>
        current.map((item) => (item.id === conversation.id ? patch(item) : item))
      );
    } catch (error) {
      setReminderStatusError(
        error instanceof Error ? error.message : "تعذّر تحديث تأكيد العميلة"
      );
    } finally {
      setReminderStatusBusy(null);
    }
  };

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
            {/* The count used to own a line of its own under the filters. */}
            <span
              aria-label={`${filtered.length} محادثة`}
              className="shrink-0 text-[11px] tabular-nums text-[var(--subtle)]"
            >
              {filtered.length.toLocaleString("ar")}
            </span>
          </div>
          {/* One scrolling row, not a wrapping block: the chips + both selects
              used to stack into three lines and push the list down. Touch-sized
              (≥36px) rather than 11px pills. */}
          <div className="scroll-pane flex items-center gap-1.5 overflow-x-auto pb-0.5 [&::-webkit-scrollbar]:hidden">
            <ToggleGroup
              type="single"
              value={view}
              onValueChange={(value) => value && setView(value as View)}
              variant="outline"
              spacing={1}
              aria-label="تصفية المحادثات"
              className="w-auto"
            >
              {(["new", "mine", "unassigned", "danger"] as View[]).map((v) => (
                <ToggleGroupItem
                  key={v}
                  value={v}
                  aria-label={
                    v === "new"
                      ? "المحادثات الجديدة"
                      : v === "mine"
                        ? "المحادثات المستلمة بواسطتي"
                      : v === "unassigned"
                        ? "المحادثات غير المستلمة"
                        : "المحادثات التي تأخر الرد عليها"
                  }
                  className={cn(
                    "min-h-9 rounded-full px-3 text-xs",
                    v === "danger" &&
                      "text-destructive data-[state=on]:border-destructive data-[state=on]:bg-destructive data-[state=on]:text-white"
                  )}
                >
                  {v === "new"
                    ? "جديد"
                    : v === "mine"
                      ? "محادثاتي"
                      : v === "unassigned"
                        ? "غير مستلمة"
                        : "خطر"}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as CsStatus | "all")}
              aria-label="تصفية حسب الحالة"
              className="min-h-9 shrink-0 rounded-full border px-2 text-xs text-muted-foreground"
            >
              <option value="all">كل الحالات</option>
              {CS_STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {CS_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
            <select
              value={sectionFilter}
              onChange={(e) =>
                setSectionFilter(e.target.value as ConversationSection | "all")
              }
              aria-label="تصفية حسب القسم"
              className="min-h-9 shrink-0 rounded-full border px-2 text-xs text-muted-foreground"
            >
              <option value="all">كل الأقسام</option>
              {SECTION_ORDER.map((s) => (
                <option key={s} value={s}>
                  {SECTION_LABEL[s]}
                </option>
              ))}
            </select>
            {labels.length > 0 ? (
              <select
                value={labelFilter}
                onChange={(e) => setLabelFilter(e.target.value)}
                aria-label="تصفية حسب التصنيف"
                className="min-h-9 shrink-0 rounded-full border px-2 text-xs text-muted-foreground"
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
        </div>

        <div className="scroll-pane min-h-0 flex-1">
          {filtered.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">لا توجد نتائج.</p>
          ) : (
            filtered.map((conversation) => (
              <ConversationListRow
                key={conversation.id}
                conversation={conversation}
                selected={selected?.id === conversation.id}
                typing={isTyping(conversation.id)}
                unreadCount={unreadOf(conversation)}
                bookingCleared={clearedBookings.has(conversation.id)}
                labelIds={assignments[conversation.id] ?? EMPTY_LABEL_IDS}
                labelMap={labelMap}
                owner={ownerLabel(conversation)}
                route={routeLabel(conversation)}
                now={now}
                dangerExcludedPhoneSet={dangerExcludedPhoneSet}
                onSelect={loadMessages}
              />
            ))
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
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
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
                  className="flex size-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-[var(--brand-soft)] lg:hidden"
                >
                  <ChevronRight size={20} aria-hidden="true" />
                </button>
                <div className="min-w-0 flex-1">
                  {editingName ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void saveCustomerName();
                      }}
                      className="flex items-center gap-1"
                    >
                      <input
                        autoFocus
                        value={nameDraft}
                        onChange={(e) => setNameDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") setEditingName(false);
                        }}
                        maxLength={80}
                        placeholder="اسم الزبونة"
                        aria-label="اسم الزبونة"
                        className="min-w-0 flex-1 rounded-lg border px-2 py-1 text-sm font-semibold outline-none focus:border-[var(--brand)]"
                      />
                      <button
                        type="submit"
                        disabled={savingName}
                        aria-label="حفظ الاسم"
                        className="flex size-8 shrink-0 items-center justify-center rounded-lg text-[var(--brand)] hover:bg-[var(--brand-soft)] disabled:opacity-50"
                      >
                        {savingName ? (
                          <Loader2 size={15} className="animate-spin" />
                        ) : (
                          <Check size={16} />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingName(false)}
                        aria-label="إلغاء"
                        className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-black/5"
                      >
                        <X size={15} />
                      </button>
                    </form>
                  ) : (
                    <div className="flex items-center gap-1">
                      <p
                        dir={selected.customer_name ? undefined : "ltr"}
                        className={cn(
                          "min-w-0 truncate font-semibold text-[var(--foreground)]",
                          !selected.customer_name && "text-right"
                        )}
                      >
                        {selected.customer_name || selected.customer_phone}
                      </p>
                      {/* WhatsApp rarely gives a usable name; staff know who
                          these customers actually are. */}
                      <button
                        type="button"
                        onClick={() => {
                          setNameDraft(selected.customer_name ?? "");
                          setEditingName(true);
                        }}
                        aria-label={
                          selected.customer_name ? "تعديل اسم الزبونة" : "إضافة اسم الزبونة"
                        }
                        title={
                          selected.customer_name ? "تعديل اسم الزبونة" : "إضافة اسم الزبونة"
                        }
                        className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-[var(--brand-soft)] hover:text-[var(--brand)]"
                      >
                        <Pencil size={13} aria-hidden="true" />
                      </button>
                    </div>
                  )}
                  {/* Second line: the number only when it isn't already the
                      title (most customers have no saved name), otherwise the
                      last activity — repeating the phone twice said nothing. */}
                  <p
                    dir={selected.customer_name ? "ltr" : undefined}
                    className={cn(
                      "truncate text-xs text-muted-foreground",
                      selected.customer_name && "text-right"
                    )}
                  >
                    {isTyping(selected.id) ? (
                      <span className="flex items-center gap-1 font-medium text-[var(--brand)]">
                        يكتب الآن
                        <TypingDots />
                      </span>
                    ) : selected.customer_name ? (
                      selected.customer_phone
                    ) : (
                      `آخر رسالة ${formatRelativeTime(
                        selected.last_message_at ?? selected.started_at,
                        now
                      )}`
                    )}
                  </p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1">
                    {selected.assigned_to ? (
                      <span className="inline-flex max-w-full items-center gap-1 truncate rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-700">
                        <UserCheck size={11} className="shrink-0" aria-hidden="true" />
                        المسؤول: {ownerLabel(selected)}
                      </span>
                    ) : null}
                    {routeLabel(selected) ? (
                      <span className="inline-flex max-w-full items-center gap-1 truncate rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                        <Lock size={11} className="shrink-0" aria-hidden="true" />
                        {routeLabel(selected)}
                      </span>
                    ) : null}
                    {sectionOf(selected) ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-700">
                        {SECTION_LABEL[sectionOf(selected)!]}
                      </span>
                    ) : null}
                    {selectedBookingStage ? (
                      <Badge variant="secondary">
                        {BOOKING_STAGE_LABEL[selectedBookingStage]}
                      </Badge>
                    ) : null}
                  </div>
                </div>
                {/* Create the visit first; dispatch happens from /orders. */}
                <Button
                  type="button"
                  onClick={() => {
                    setOrderSheetMounted(true);
                    setOrderOpen(true);
                  }}
                  onPointerEnter={preloadOrderSheet}
                  onFocus={preloadOrderSheet}
                  onPointerDown={preloadOrderSheet}
                  aria-label="حجز موعد"
                  aria-haspopup="dialog"
                  variant="secondary"
                  size="lg"
                  className="min-h-10 shrink-0"
                >
                  <CalendarDays data-icon="inline-start" aria-hidden="true" />
                  <span className="hidden sm:inline">حجز</span>
                </Button>
                {/* Every other control lives behind this one button so the chat
                    screen itself stays free of chrome. */}
                <button
                  type="button"
                  onClick={() => setOptionsOpen(true)}
                  aria-label="خيارات المحادثة"
                  aria-haspopup="dialog"
                  className="flex size-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-[var(--brand-soft)]"
                >
                  <MoreVertical size={20} aria-hidden="true" />
                </button>
              </div>
            </header>

            {selectedReplyOverdue ? (
              <Alert variant="destructive" className="rounded-none border-x-0 border-t-0">
                <AlertTriangle />
                <AlertTitle>تأخر الرد على العميلة</AlertTitle>
                <AlertDescription>
                  آخر رسالة من العميلة ما زالت تنتظر ردًا.
                </AlertDescription>
              </Alert>
            ) : null}

            {selectedReminder ? (
              <div className="flex flex-wrap items-center gap-2 border-b bg-[var(--surface)] px-3 py-2 sm:px-5">
                <Bell size={16} className="shrink-0 text-[var(--brand)]" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">هل أكدت العميلة التذكير؟</p>
                  <p className="text-xs text-muted-foreground">
                    موعد {REMINDER_DAY_FMT.format(new Date(`${selectedReminder.dayKey}T12:00:00+03:00`))}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant={selectedReminder.status === "confirmed" ? "default" : "outline"}
                  disabled={Boolean(reminderStatusBusy) || !canReply}
                  onClick={() => void updateReminderStatus("confirmed")}
                >
                  {reminderStatusBusy === "confirmed" ? (
                    <Loader2 data-icon="inline-start" className="animate-spin" />
                  ) : (
                    <Check data-icon="inline-start" />
                  )}
                  أكدت الحضور
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={selectedReminder.status === "awaiting_reply" ? "secondary" : "outline"}
                  disabled={Boolean(reminderStatusBusy) || !canReply}
                  onClick={() => void updateReminderStatus("awaiting_reply")}
                >
                  {reminderStatusBusy === "awaiting_reply" ? (
                    <Loader2 data-icon="inline-start" className="animate-spin" />
                  ) : (
                    <CalendarClock data-icon="inline-start" />
                  )}
                  لم تؤكد بعد
                </Button>
                {reminderStatusError ? (
                  <p role="alert" className="w-full text-xs text-destructive">
                    {reminderStatusError}
                  </p>
                ) : null}
              </div>
            ) : null}

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

            {/* The bot collected booking details; the employee confirms the
                date now, while specialist/driver assignment happens later. */}
            {(() => {
              const booking = bookingRequestOf(selected);
              if (!booking || clearedBookings.has(selected.id)) return null;
              return (
                <div className="border-b bg-background px-4 py-2.5">
                  <Alert>
                    <CalendarDays />
                    <AlertTitle>جمع المساعد تفاصيل حجز</AlertTitle>
                    <AlertDescription className="flex flex-col gap-3">
                      <dl className="flex flex-col gap-0.5 text-xs">
                        {booking.service ? (
                          <div>الخدمة: {booking.service}</div>
                        ) : null}
                        {booking.time ? <div>الموعد: {booking.time}</div> : null}
                        {booking.location ? (
                          <div className="break-words">الموقع: {booking.location}</div>
                        ) : null}
                        {!booking.service && !booking.time && !booking.location && booking.summary ? (
                          <div className="break-words">{booking.summary}</div>
                        ) : null}
                      </dl>
                      <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        onClick={() => {
                          setOrderSheetMounted(true);
                          setOrderOpen(true);
                        }}
                        size="sm"
                      >
                        تأكيد الحجز
                      </Button>
                      <Button
                        type="button"
                        aria-label="تجاهل طلب الحجز"
                        onClick={() => {
                          setClearedBookings((prev) => new Set(prev).add(selected.id));
                          void fetch(`/api/conversations/${selected.id}/booking-request`, {
                            method: "DELETE",
                          }).catch(() => {});
                        }}
                        variant="ghost"
                        size="icon-sm"
                      >
                        <X aria-hidden="true" />
                      </Button>
                      </div>
                    </AlertDescription>
                  </Alert>
                </div>
              );
            })()}

            <div
              ref={listRef}
              onScroll={onListScroll}
              className="scroll-pane min-h-0 flex-1 space-y-2 p-3 sm:p-5"
            >
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                  <Loader2 size={14} className="animate-spin" /> جارٍ التحميل…
                </div>
              ) : messages.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  لا توجد رسائل.
                </p>
              ) : (
                <>
                  {loadingOlder ? (
                    <div
                      aria-live="polite"
                      className="flex items-center justify-center gap-2 py-2 text-xs text-muted-foreground"
                    >
                      <Loader2 size={13} className="animate-spin" aria-hidden="true" />
                      جارٍ تحميل الرسائل الأقدم…
                    </div>
                  ) : hasMoreMessages ? (
                    <div className="flex justify-center py-1">
                      <button
                        type="button"
                        onClick={() => void loadOlderMessages()}
                        className="rounded-full border px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-[var(--brand-soft)] hover:text-[var(--brand)]"
                      >
                        عرض الرسائل الأقدم
                      </button>
                    </div>
                  ) : null}
                  {messages.map((m, i) => {
                    const prev = i > 0 ? messages[i - 1] : null;
                    const newDay =
                      !prev || dayKey(prev.created_at) !== dayKey(m.created_at);
                    return (
                      <Fragment key={m.id}>
                        {newDay ? <DaySeparator iso={m.created_at} /> : null}
                        <MessageBubble message={m} />
                      </Fragment>
                    );
                  })}
                  {isTyping(selected.id) ? (
                    <div className="flex justify-start">
                      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-500 shadow-sm">
                        <TypingDots />
                      </div>
                    </div>
                  ) : null}
                </>
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

            {catalogImageBusy ? (
              <p
                aria-live="polite"
                className="flex shrink-0 items-center gap-1.5 bg-[var(--brand-soft)] px-4 py-1.5 text-xs text-[var(--brand)]"
              >
                <Loader2 size={12} className="animate-spin" aria-hidden="true" />
                جارٍ تجهيز صورة الخدمة…
              </p>
            ) : null}

            {!canReply ? (
              <div className="safe-b shrink-0 border-t bg-[var(--surface)] px-3 pt-3 sm:px-4">
                {canTake ? (
                  <Button
                    type="button"
                    size="lg"
                    className="min-h-11 w-full"
                    onClick={() => act("take")}
                    disabled={busy}
                  >
                    {busy ? (
                      <Loader2 data-icon="inline-start" className="animate-spin" />
                    ) : (
                      <UserCheck data-icon="inline-start" />
                    )}
                    استلام المحادثة والبدء بالرد
                  </Button>
                ) : canTakeOver ? (
                  // The reason is required, not optional: it is what the owner
                  // report shows next to the override.
                  <div className="flex flex-col gap-2">
                    <p className="text-sm text-[var(--muted-foreground)]">
                      {`المحادثة مستلمة من ${ownerLabel(selected)}. لاستلامها اكتبي السبب.`}
                    </p>
                    <div className="flex items-end gap-2">
                      <input
                        type="text"
                        value={takeoverReason}
                        onChange={(event) => setTakeoverReason(event.target.value)}
                        placeholder="سبب الاستلام…"
                        aria-label="سبب استلام المحادثة من موظفة أخرى"
                        className="min-h-11 flex-1 rounded-md border bg-[var(--background)] px-3 text-sm"
                      />
                      <Button
                        type="button"
                        size="lg"
                        className="min-h-11 shrink-0"
                        disabled={busy || takeoverReason.trim().length < 3}
                        onClick={async () => {
                          await act("takeover", { reason: takeoverReason.trim() });
                          setTakeoverReason("");
                        }}
                      >
                        {busy ? (
                          <Loader2 data-icon="inline-start" className="animate-spin" />
                        ) : (
                          <UserCheck data-icon="inline-start" />
                        )}
                        استلام مع تسجيل السبب
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    type="button"
                    size="lg"
                    variant="outline"
                    className="min-h-11 w-full"
                    onClick={() => setOptionsOpen(true)}
                  >
                    <Lock data-icon="inline-start" />
                    {selected.assigned_to
                      ? `المحادثة مستلمة من ${ownerLabel(selected)}`
                      : "عيّني موظفة للمحادثة قبل الرد"}
                  </Button>
                )}
              </div>
            ) : (
              <div className="safe-b flex shrink-0 items-end gap-2 border-t bg-[var(--surface)] px-3 pt-3 sm:px-4">
              <input
                ref={fileInputRef}
                type="file"
                hidden
                multiple
                accept="image/*,video/*,audio/*,application/pdf,.doc,.docx,.xls,.xlsx,.txt,.csv"
                onChange={onPickFile}
              />
              {/* One entry point for everything you *insert*. Four separate
                  buttons left the text field 91px wide on a 375px phone — the
                  box you actually type in was the smallest thing in the row. */}
              <div className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setPlusOpen((o) => !o);
                    setPlusView("menu");
                  }}
                  disabled={uploading || recording}
                  aria-label="إرفاق أو إدراج"
                  aria-expanded={plusOpen}
                  aria-haspopup="menu"
                  className={cn(
                    "flex size-11 items-center justify-center rounded-lg border transition-colors disabled:opacity-60",
                    plusOpen
                      ? "border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)]"
                      : "text-muted-foreground hover:bg-[var(--brand-soft)]"
                  )}
                >
                  {uploading ? (
                    <Loader2 size={18} className="animate-spin" aria-hidden="true" />
                  ) : (
                    <Plus
                      size={20}
                      aria-hidden="true"
                      className={cn("transition-transform", plusOpen && "rotate-45")}
                    />
                  )}
                </button>

                {plusOpen ? (
                  <>
                    {/* Tap-away layer — a menu that only closes via its own
                        button is a trap on touch. */}
                    <button
                      type="button"
                      aria-label="إغلاق القائمة"
                      onClick={() => setPlusOpen(false)}
                      className="fixed inset-0 z-10 cursor-default"
                    />
                    <div
                      role="menu"
                      className="absolute bottom-13 right-0 z-20 w-60 overflow-hidden rounded-xl border bg-[var(--surface)] p-1 shadow-lg"
                    >
                      {plusView === "menu" ? (
                        <>
                          <MenuItem
                            icon={<Paperclip size={16} aria-hidden="true" />}
                            label="إرفاق صورة أو ملف"
                            onClick={() => {
                              setPlusOpen(false);
                              fileInputRef.current?.click();
                            }}
                          />
                          <MenuItem
                            icon={<BookOpen size={16} aria-hidden="true" />}
                            label="الباقات والخدمات"
                            onClick={() => {
                              setPlusOpen(false);
                              setCatalogOpen(true);
                            }}
                          />
                          {savedReplies.length ? (
                            <MenuItem
                              icon={<MessageSquareText size={16} aria-hidden="true" />}
                              label="الرسائل الجاهزة"
                              onClick={() => setPlusView("replies")}
                            />
                          ) : null}
                        </>
                      ) : (
                        <div className="max-h-64 overflow-y-auto">
                          <button
                            type="button"
                            onClick={() => setPlusView("menu")}
                            className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-xs text-muted-foreground hover:bg-[var(--brand-soft)]"
                          >
                            <ChevronRight size={14} aria-hidden="true" /> رجوع
                          </button>
                          {savedReplies.map((r) => (
                            <button
                              key={r.id}
                              type="button"
                              onClick={() => {
                                setDraft((d) => (d.trim() ? `${d.trim()}\n` : "") + r.body);
                                setPlusOpen(false);
                              }}
                              title={r.body}
                              className="block w-full rounded-lg px-2 py-2 text-right hover:bg-[var(--brand-soft)]"
                            >
                              <span className="block truncate text-sm font-medium text-[var(--foreground)]">
                                {r.title}
                              </span>
                              <span className="block truncate text-[11px] text-muted-foreground">
                                {r.body}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                ) : null}
              </div>
              <button
                type="button"
                onClick={recording ? stopRecording : startRecording}
                disabled={uploading}
                aria-label={recording ? "إيقاف التسجيل وإرسال" : "تسجيل رسالة صوتية"}
                className={cn(
                  "flex size-11 shrink-0 items-center justify-center rounded-lg border transition-colors disabled:opacity-60",
                  recording
                    ? "animate-pulse border-red-300 bg-red-50 text-red-600"
                    : "text-muted-foreground hover:bg-[var(--brand-soft)]"
                )}
              >
                {recording ? (
                  <Square size={16} aria-hidden="true" />
                ) : (
                  <Mic size={18} aria-hidden="true" />
                )}
              </button>
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
            )}

            {/* Everything that isn't the conversation itself. */}
            <Modal
              open={optionsOpen}
              onClose={() => setOptionsOpen(false)}
              title="خيارات المحادثة"
              description="حددي مرحلة الحجز، ثم أديري المسؤول والتوجيه والتصنيفات."
              contentClassName="sm:max-w-2xl"
              mobileBottomSheet
            >
              <div className="flex flex-col gap-5">
                <FieldSet className="rounded-xl border p-4">
                  <FieldLegend variant="label">مرحلة متابعة الحجز</FieldLegend>
                  <ToggleGroup
                    type="single"
                    value={selectedBookingStage ?? ""}
                    onValueChange={(value) =>
                      value &&
                      act("booking-stage", { stage: value as BookingStage })
                    }
                    disabled={busy}
                    variant="outline"
                    spacing={1}
                    className="grid w-full grid-cols-2 sm:grid-cols-3"
                    aria-label="مرحلة متابعة الحجز"
                  >
                    {BOOKING_STAGE_ORDER.map((stage) => {
                      const Icon = BOOKING_STAGE_ICON[stage];
                      return (
                        <ToggleGroupItem
                          key={stage}
                          value={stage}
                          className="min-h-16 min-w-0 flex-col gap-1 whitespace-normal px-2 text-center leading-tight"
                        >
                          <Icon aria-hidden="true" />
                          {BOOKING_STAGE_LABEL[stage]}
                        </ToggleGroupItem>
                      );
                    })}
                  </ToggleGroup>
                  <FieldDescription>
                    عند اختيار «إرفاق الفاتورة»، أرسلي الصورة أو ملف PDF من زر
                    المرفقات أسفل المحادثة.
                  </FieldDescription>
                </FieldSet>

                <div className="grid gap-5 md:grid-cols-2">
                  <section className="flex flex-col gap-2">
                    <h3 className="text-xs font-semibold text-[var(--subtle)]">
                      حالة التواصل
                    </h3>
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

                  <section className="flex flex-col gap-2">
                    <h3 className="text-xs font-semibold text-[var(--subtle)]">
                      المسؤول
                    </h3>
                    {selected.assigned_to === myTeamMemberId && myTeamMemberId ? (
                      <button
                        type="button"
                        onClick={() => act("release")}
                        disabled={busy}
                        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border text-sm text-muted-foreground hover:bg-[var(--brand-soft)] disabled:opacity-60"
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
                      <Repeat
                        size={16}
                        className="shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <select
                        value=""
                        disabled={busy}
                        onChange={(e) =>
                          e.target.value &&
                          act("transfer", {
                            targetTeamMemberId: e.target.value,
                          })
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
                </div>

                {/* Owner-only desk routing. Employees never see this block —
                    and the API rejects them even if they find the endpoint. */}
                {isAdmin ? (
                  <section className="flex flex-col gap-2 rounded-xl border p-4">
                    <h3 className="flex items-center gap-1.5 text-xs font-semibold text-[var(--subtle)]">
                      <Inbox size={13} aria-hidden="true" /> القسم والتوجيه
                    </h3>
                    <select
                      value={sectionOf(selected) ?? ""}
                      disabled={busy}
                      onChange={(e) =>
                        act("section", { section: e.target.value || null })
                      }
                      aria-label="قسم المحادثة"
                      className="min-h-11 w-full rounded-lg border bg-white px-3 text-sm"
                    >
                      <option value="">بدون قسم</option>
                      {SECTION_ORDER.map((s) => (
                        <option key={s} value={s}>
                          {SECTION_LABEL[s]}
                        </option>
                      ))}
                    </select>
                    <div className="flex items-center gap-2">
                      <Lock
                        size={16}
                        className="shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <select
                        value={routedToOf(selected) ?? ""}
                        disabled={busy}
                        onChange={(e) =>
                          act("routing", {
                            targetTeamMemberId: e.target.value || null,
                          })
                        }
                        aria-label="توجيه المحادثة لموظف واحد"
                        className="min-h-11 flex-1 rounded-lg border bg-white px-3 text-sm"
                      >
                        <option value="">متاحة لكل الموظفين</option>
                        {agents.map((a) => (
                          <option key={a.id} value={a.id}>
                            {agentDisplayName(a)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <p className="text-[11px] leading-5 text-[var(--subtle)]">
                      {routedToOf(selected)
                        ? "هذه المحادثة تظهر لهذا الموظف وللمديرين فقط — لا يراها بقية الموظفين ولا تصلهم إشعاراتها."
                        : "اختاري موظفًا لتوجيه المحادثة له وحده؛ عندها تختفي عن بقية الموظفين."}
                    </p>
                  </section>
                ) : null}

                <section className="flex flex-col gap-2">
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
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <input
                      value={newLabelName}
                      onChange={(e) => setNewLabelName(e.target.value)}
                      aria-label="اسم التصنيف الجديد"
                      placeholder="تصنيف جديد…"
                      className="min-h-10 w-full min-w-0 flex-1 rounded-lg border px-2 text-sm outline-none"
                    />
                    <div className="flex justify-center gap-1 sm:justify-start">
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
                      className="flex min-h-10 items-center justify-center gap-1 rounded-lg bg-[var(--brand)] px-3 text-xs text-white disabled:opacity-60"
                    >
                      <Plus size={13} aria-hidden="true" /> إضافة
                    </button>
                  </div>
                </section>

                <section className="flex flex-col gap-2">
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
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
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
                      className="min-h-10 w-full min-w-0 flex-1 rounded-lg border px-2 text-sm outline-none"
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

            {catalogOpen ? (
              <Suspense fallback={null}>
                <CatalogSheet
                  open={catalogOpen}
                  onClose={() => setCatalogOpen(false)}
                  onPick={pickCatalogItem}
                />
              </Suspense>
            ) : null}

            {orderSheetMounted ? (
              <Suspense
                fallback={
                  <Modal
                    open={orderOpen}
                    onClose={() => setOrderOpen(false)}
                    title="حجز موعد"
                  >
                    <div
                      className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground"
                      aria-live="polite"
                    >
                      <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                      جارٍ تجهيز الطلب…
                    </div>
                  </Modal>
                }
              >
                <CreateOrderSheet
                  key={selected.id}
                  open={orderOpen}
                  onClose={() => setOrderOpen(false)}
                  conversationId={selected.id}
                  sharedLocation={sharedLocation}
                  booking={
                    clearedBookings.has(selected.id)
                      ? null
                      : bookingRequestOf(selected)
                  }
                  onOrderCreated={() =>
                    setClearedBookings((prev) => new Set(prev).add(selected.id))
                  }
                />
              </Suspense>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
