"use client";

import { useCallback, useState } from "react";
import { Check, Loader2, MessageSquareText, Pencil, Plus, Trash2, X } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import type { SavedReply } from "@/lib/saved-replies";

/**
 * The fixed messages behind the composer's templates button. Managed here in a
 * sheet so the settings screen stays a list of cards rather than a wall of
 * textareas. Owner/manager-only — the whole settings route is admin-guarded.
 */
export function SavedRepliesManager({ initial }: { initial: SavedReply[] }) {
  const [open, setOpen] = useState(false);
  const [replies, setReplies] = useState(initial);

  return (
    <section className="mt-6 space-y-3 rounded-2xl border bg-[var(--surface)] p-4">
      <div className="flex items-center gap-2">
        <MessageSquareText size={18} className="text-[var(--brand)]" aria-hidden="true" />
        <h2 className="font-semibold text-[var(--foreground)]">الرسائل الجاهزة</h2>
      </div>
      <p className="text-sm text-[var(--muted)]">
        رسائل تُدرَج بضغطة من زر الرسائل في شاشة المحادثة — ترحيب، تعليمات الوصول،
        سياسة الإلغاء وغيرها.
      </p>
      <p className="text-sm text-[var(--foreground)]">
        {replies.length
          ? `${replies.length.toLocaleString("ar")} رسالة محفوظة: ${replies
              .map((r) => r.title)
              .join("، ")}`
          : "لا توجد رسائل بعد."}
      </p>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border px-4 text-sm font-medium text-[var(--brand)]"
      >
        إدارة الرسائل الجاهزة
      </button>

      <RepliesSheet
        open={open}
        onClose={() => setOpen(false)}
        replies={replies}
        onReplies={setReplies}
      />
    </section>
  );
}

function RepliesSheet({
  open,
  onClose,
  replies,
  onReplies,
}: {
  open: boolean;
  onClose: () => void;
  replies: SavedReply[];
  onReplies: (updater: (prev: SavedReply[]) => SavedReply[]) => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = useCallback(async () => {
    setError(null);
    if (!title.trim()) return setError("العنوان مطلوب");
    if (!body.trim()) return setError("نص الرسالة مطلوب");
    setBusy(true);
    try {
      const res = await fetch("/api/saved-replies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), body: body.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setError(data?.error ?? "تعذّرت الإضافة");
      onReplies((prev) => [...prev, data.savedReply as SavedReply]);
      setTitle("");
      setBody("");
    } catch {
      setError("تعذّرت الإضافة");
    } finally {
      setBusy(false);
    }
  }, [title, body, onReplies]);

  return (
    <Modal open={open} onClose={onClose} title="الرسائل الجاهزة">
      <div className="space-y-4">
        <div className="space-y-2 rounded-xl border border-dashed p-3">
          <p className="text-sm font-medium text-[var(--foreground)]">إضافة رسالة</p>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="العنوان (مثل: ترحيب)"
            className="min-h-11 w-full rounded-lg border px-3 text-sm outline-none focus:border-[var(--brand)]"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            placeholder="نص الرسالة كما تُرسل للزبونة"
            className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-[var(--brand)]"
          />
          {error ? <p className="text-xs text-rose-600">{error}</p> : null}
          <button
            type="button"
            onClick={add}
            disabled={busy}
            className="flex min-h-10 w-full items-center justify-center gap-1.5 rounded-lg bg-[var(--brand)] text-sm font-medium text-white disabled:opacity-60"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            إضافة
          </button>
        </div>

        {replies.length ? (
          <ul className="space-y-2">
            {replies.map((reply) => (
              <ReplyRow
                key={reply.id}
                reply={reply}
                onSaved={(next) =>
                  onReplies((prev) => prev.map((r) => (r.id === next.id ? next : r)))
                }
                onDeleted={() =>
                  onReplies((prev) => prev.filter((r) => r.id !== reply.id))
                }
              />
            ))}
          </ul>
        ) : (
          <p className="py-4 text-center text-sm text-[var(--muted)]">
            لا توجد رسائل محفوظة بعد.
          </p>
        )}
      </div>
    </Modal>
  );
}

function ReplyRow({
  reply,
  onSaved,
  onDeleted,
}: {
  reply: SavedReply;
  onSaved: (next: SavedReply) => void;
  onDeleted: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(reply.title);
  const [body, setBody] = useState(reply.body);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/saved-replies/${reply.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, body }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setError(data?.error ?? "تعذّر الحفظ");
      onSaved(data.savedReply as SavedReply);
      setEditing(false);
    } catch {
      setError("تعذّر الحفظ");
    } finally {
      setBusy(false);
    }
  }, [reply.id, title, body, onSaved]);

  const remove = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/saved-replies/${reply.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error ?? "تعذّر الحذف");
        return;
      }
      onDeleted();
    } catch {
      setError("تعذّر الحذف");
    } finally {
      setBusy(false);
    }
  }, [reply.id, onDeleted]);

  if (editing) {
    return (
      <li className="space-y-2 rounded-xl border p-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="min-h-10 w-full rounded-lg border px-2 text-sm outline-none focus:border-[var(--brand)]"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          className="w-full rounded-lg border px-2 py-2 text-sm outline-none focus:border-[var(--brand)]"
        />
        {error ? <p className="text-xs text-rose-600">{error}</p> : null}
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="flex min-h-9 flex-1 items-center justify-center gap-1 rounded-lg bg-[var(--brand)] text-sm text-white disabled:opacity-60"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={15} />}
            حفظ
          </button>
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setTitle(reply.title);
              setBody(reply.body);
            }}
            aria-label="إلغاء"
            className="flex size-9 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-black/5"
          >
            <X size={16} />
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className="rounded-xl border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-[var(--foreground)]">{reply.title}</p>
          <p className="mt-0.5 whitespace-pre-wrap text-xs text-[var(--muted)]">
            {reply.body}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            onClick={() => setEditing(true)}
            aria-label="تعديل"
            className="flex size-9 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-black/5"
          >
            <Pencil size={15} />
          </button>
          <button
            type="button"
            onClick={() => setConfirmDelete((v) => !v)}
            aria-label="حذف"
            className="flex size-9 items-center justify-center rounded-lg text-rose-600 hover:bg-rose-50"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      {error ? <p className="mt-2 text-xs text-rose-600">{error}</p> : null}

      {/* Deleting is permanent, so it takes a second, deliberate tap. */}
      {confirmDelete ? (
        <div className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-rose-50 px-3 py-2">
          <span className="text-xs text-rose-700">حذف «{reply.title}» نهائيًا؟</span>
          <div className="flex shrink-0 gap-1.5">
            <button
              type="button"
              onClick={remove}
              disabled={busy}
              className="min-h-8 rounded-lg bg-rose-600 px-3 text-xs text-white disabled:opacity-60"
            >
              {busy ? "…" : "حذف"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="min-h-8 rounded-lg px-2 text-xs text-[var(--muted)]"
            >
              إلغاء
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}
