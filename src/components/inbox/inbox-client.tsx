"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  Send,
  UserCheck,
  UserX,
  Repeat,
  Smartphone,
  Search,
  Tag,
  Plus,
  X,
  StickyNote,
  MessageSquareText,
} from "lucide-react";
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
import { formatRelativeTime } from "@/lib/format";
import { MessageBubble } from "./message-bubble";
import { useInboxRealtime } from "./use-inbox-realtime";

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
  labels: initialLabels,
  labelAssignments: initialAssignments,
  savedReplies,
}: {
  conversations: Conversation[];
  agents: AgentInfo[];
  myTeamMemberId: string | null;
  myEmail: string | null;
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
  const [notesOpen, setNotesOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [repliesOpen, setRepliesOpen] = useState(false);

  const [labels, setLabels] = useState<Label[]>(initialLabels);
  const [assignments, setAssignments] =
    useState<Record<string, string[]>>(initialAssignments);
  const [labelEditorOpen, setLabelEditorOpen] = useState(false);
  const [newLabelName, setNewLabelName] = useState("");
  const [newLabelColor, setNewLabelColor] = useState<LabelColor>("blue");

  // Filters
  const [search, setSearch] = useState("");
  const [view, setView] = useState<View>("all");
  const [statusFilter, setStatusFilter] = useState<CsStatus | "all">("all");
  const [labelFilter, setLabelFilter] = useState<string>("all");

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
      if (view === "unread" && !c.unread_count) return false;
      if (statusFilter !== "all" && csStatusOf(c) !== statusFilter) return false;
      if (labelFilter !== "all" && !(assignments[c.id] ?? []).includes(labelFilter))
        return false;
      return true;
    });
  }, [conversations, search, view, statusFilter, labelFilter, assignments, myTeamMemberId]);

  const loadMessages = useCallback(async (c: Conversation) => {
    setSelected(c);
    setLabelEditorOpen(false);
    setNotesOpen(false);
    setNoteDraft("");
    setLoading(true);
    setMessages([]);
    setNotes([]);
    setDraft("");
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
  }, []);

  // ---- live updates (Supabase Realtime) ----
  // Refs so the realtime callbacks always see the current selection without
  // resubscribing on every render.
  const selectedRef = useRef<Conversation | null>(null);
  selectedRef.current = selected;

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
  const refetchThread = useCallback(async (conversationId: string) => {
    if (selectedRef.current?.id !== conversationId) return;
    try {
      const res = await fetch(`/api/conversations/${conversationId}/messages`);
      const data = await res.json();
      setMessages(data.messages ?? []);
    } catch {
      // keep whatever is on screen; the next event or refresh will catch up
    }
  }, []);

  useInboxRealtime({
    onNewMessage: refetchThread,
    onConversationsChanged: scheduleListRefresh,
  });

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
    setBusy(true);
    const text = draft.trim();
    setDraft("");
    try {
      await fetch(`/api/conversations/${selected.id}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text }),
      });
      const res = await fetch(`/api/conversations/${selected.id}/messages`);
      const data = await res.json();
      setMessages(data.messages ?? []);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }, [selected, draft, router]);

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
    return agentMap[c.assigned_to]?.email || "موظف";
  };

  const selectedLabelIds = selected ? assignments[selected.id] ?? [] : [];

  return (
    <div className="flex h-[calc(100vh-57px)]">
      {/* Conversation list */}
      <aside className="flex w-full max-w-sm flex-col border-l bg-[var(--surface)]">
        <div className="space-y-2 border-b px-3 py-3">
          <div className="flex items-center gap-2 rounded-lg border px-2">
            <Search size={14} className="text-[var(--subtle)]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث بالاسم أو الرقم…"
              className="w-full bg-transparent py-1.5 text-sm outline-none"
            />
          </div>
          <div className="flex flex-wrap gap-1">
            {(["all", "mine", "unassigned", "unread"] as View[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[11px]",
                  view === v
                    ? "border-[var(--brand)] bg-[var(--brand)] text-white"
                    : "text-[var(--muted)]"
                )}
              >
                {v === "all" ? "الكل" : v === "mine" ? "لي" : v === "unassigned" ? "غير مسندة" : "غير مقروءة"}
              </button>
            ))}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as CsStatus | "all")}
              className="rounded-full border px-1.5 py-0.5 text-[11px] text-[var(--muted)]"
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
                className="rounded-full border px-1.5 py-0.5 text-[11px] text-[var(--muted)]"
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

        <div className="flex-1 overflow-y-auto">
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
                        <span className="flex items-center gap-0.5 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] text-emerald-700">
                          <Smartphone size={9} /> واتساب
                        </span>
                      ) : null}
                      {c.unread_count ? (
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
      <section className="flex flex-1 flex-col bg-[var(--background)]">
        {!selected ? (
          <div className="flex flex-1 items-center justify-center text-sm text-[var(--muted)]">
            اختر محادثة لعرضها
          </div>
        ) : (
          <>
            <header className="flex flex-wrap items-center justify-between gap-2 border-b bg-[var(--surface)] px-5 py-3">
              <div>
                <p className="font-semibold text-[var(--foreground)]">
                  {selected.customer_name || selected.customer_phone}
                </p>
                <p dir="ltr" className="text-xs text-[var(--muted)]">
                  {selected.customer_phone}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={csStatusOf(selected)}
                  disabled={busy}
                  onChange={(e) => act("status", { status: e.target.value })}
                  className="rounded-md border bg-white px-2 py-1 text-xs"
                >
                  {CS_STATUS_ORDER.map((s) => (
                    <option key={s} value={s}>
                      {CS_STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => setLabelEditorOpen((o) => !o)}
                  className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-[var(--muted)] hover:bg-[var(--brand-soft)]"
                >
                  <Tag size={12} /> تصنيفات
                </button>
                <button
                  onClick={() => setNotesOpen((o) => !o)}
                  className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-[var(--muted)] hover:bg-[var(--brand-soft)]"
                >
                  <StickyNote size={12} /> ملاحظات
                  {notes.length ? ` (${notes.length})` : ""}
                </button>
                {selected.assigned_to === myTeamMemberId && myTeamMemberId ? (
                  <button
                    onClick={() => act("release")}
                    disabled={busy}
                    className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-[var(--muted)] hover:bg-[var(--brand-soft)]"
                  >
                    <UserX size={12} /> إطلاق
                  </button>
                ) : (
                  <button
                    onClick={() => act("take")}
                    disabled={busy || !myTeamMemberId}
                    className="flex items-center gap-1 rounded-md bg-[var(--brand)] px-2 py-1 text-xs text-white disabled:opacity-60"
                  >
                    <UserCheck size={12} /> استلام
                  </button>
                )}
                <div className="flex items-center gap-1">
                  <Repeat size={12} className="text-[var(--muted)]" />
                  <select
                    value=""
                    disabled={busy}
                    onChange={(e) =>
                      e.target.value && act("transfer", { targetTeamMemberId: e.target.value })
                    }
                    className="rounded-md border bg-white px-2 py-1 text-xs"
                  >
                    <option value="">تحويل إلى…</option>
                    {agents
                      .filter((a) => a.id !== selected.assigned_to)
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.email || a.role}
                        </option>
                      ))}
                  </select>
                </div>
              </div>
            </header>

            {/* Label editor */}
            {labelEditorOpen ? (
              <div className="space-y-2 border-b bg-white px-5 py-3">
                <div className="flex flex-wrap gap-1.5">
                  {labels.map((l) => {
                    const on = selectedLabelIds.includes(l.id);
                    return (
                      <button
                        key={l.id}
                        onClick={() => toggleLabel(l.id)}
                        className={cn(
                          "rounded-full border px-2 py-0.5 text-[11px] transition",
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
                    placeholder="تصنيف جديد…"
                    className="w-32 rounded-md border px-2 py-1 text-xs outline-none"
                  />
                  <div className="flex gap-1">
                    {NEW_LABEL_COLORS.map((col) => (
                      <button
                        key={col}
                        onClick={() => setNewLabelColor(col)}
                        className={cn(
                          "size-4 rounded-full border",
                          LABEL_CLASSES[col].split(" ")[0],
                          newLabelColor === col ? "ring-2 ring-offset-1 ring-[var(--brand)]" : ""
                        )}
                        aria-label={col}
                      />
                    ))}
                  </div>
                  <button
                    onClick={createLabel}
                    disabled={!newLabelName.trim()}
                    className="flex items-center gap-1 rounded-md bg-[var(--brand)] px-2 py-1 text-[11px] text-white disabled:opacity-60"
                  >
                    <Plus size={11} /> إضافة
                  </button>
                </div>
              </div>
            ) : selectedLabelIds.length ? (
              <div className="flex flex-wrap items-center gap-1.5 border-b bg-white px-5 py-2">
                {selectedLabelIds
                  .map((id) => labelMap[id])
                  .filter(Boolean)
                  .map((l) => (
                    <span
                      key={(l as Label).id}
                      className={cn(
                        "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]",
                        LABEL_CLASSES[(l as Label).color]
                      )}
                    >
                      {(l as Label).name}
                      <button onClick={() => toggleLabel((l as Label).id)}>
                        <X size={10} />
                      </button>
                    </span>
                  ))}
              </div>
            ) : null}

            {notesOpen ? (
              <div className="space-y-2 border-b bg-amber-50 px-5 py-3">
                <p className="text-[11px] font-medium text-amber-800">
                  ملاحظات داخلية — لا تُرسل للعميل
                </p>
                {notes.length === 0 ? (
                  <p className="text-xs text-amber-700/70">لا توجد ملاحظات.</p>
                ) : (
                  <ul className="space-y-1">
                    {notes.map((n) => (
                      <li
                        key={n.id}
                        className="rounded border border-amber-200 bg-white px-2 py-1 text-xs text-slate-700"
                      >
                        {n.body}
                        <span className="mr-2 text-[9px] text-slate-400">
                          {new Date(n.created_at).toLocaleString("ar")}
                        </span>
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
                    placeholder="أضف ملاحظة داخلية…"
                    className="flex-1 rounded-md border border-amber-200 px-2 py-1 text-xs outline-none"
                  />
                  <button
                    onClick={addNote}
                    disabled={!noteDraft.trim()}
                    className="rounded-md bg-amber-600 px-2 py-1 text-[11px] text-white disabled:opacity-60"
                  >
                    إضافة
                  </button>
                </div>
              </div>
            ) : null}

            {isHandledOnWhatsApp(selected) ? (
              <div className="flex items-center gap-2 bg-emerald-50 px-5 py-1.5 text-xs text-emerald-700">
                <Smartphone size={12} /> تمت معالجة هذه المحادثة عبر تطبيق واتساب.
              </div>
            ) : null}

            <div className="flex-1 space-y-2 overflow-y-auto p-5">
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

            <div className="flex items-end gap-2 border-t bg-[var(--surface)] px-4 py-3">
              {savedReplies.length ? (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setRepliesOpen((o) => !o)}
                    className="flex h-10 items-center rounded-lg border px-2 text-[var(--muted)] hover:bg-[var(--brand-soft)]"
                    title="الردود المحفوظة"
                  >
                    <MessageSquareText size={16} />
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
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void sendReply();
                  }
                }}
                rows={1}
                placeholder="اكتب ردًا…"
                className="max-h-32 min-h-[40px] flex-1 resize-none rounded-lg border px-3 py-2 text-sm outline-none focus:border-[var(--brand)]"
              />
              <button
                onClick={sendReply}
                disabled={busy || !draft.trim()}
                className="flex h-10 items-center gap-1 rounded-lg bg-emerald-600 px-4 text-sm font-medium text-white disabled:opacity-60"
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                إرسال
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
