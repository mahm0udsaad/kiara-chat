"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, Send, Plus, Trash2, FileText, Loader2, Crop } from "lucide-react";
import { cn } from "@/lib/utils";
import { ImageCropper } from "./image-cropper";

export interface PendingAttachment {
  id: string;
  file: File;
  /** Object URL for local preview — revoked by the owner when discarded. */
  url: string;
  isImage: boolean;
  caption: string;
}

function prettyBytes(n: number): string {
  if (n < 1024) return `${n} بايت`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} ك.ب`;
  return `${(n / (1024 * 1024)).toFixed(1)} م.ب`;
}

/**
 * Full-screen "review before sending" step, like WhatsApp's: nothing is
 * uploaded until Send is pressed, several files can be queued at once, and
 * each gets its own caption.
 */
export function AttachmentPreview({
  items,
  activeIndex,
  sending,
  error,
  onSetActive,
  onCaptionChange,
  onRemove,
  onAddMore,
  onCancel,
  onSend,
  onCropped,
}: {
  items: PendingAttachment[];
  activeIndex: number;
  sending: boolean;
  error: string | null;
  onSetActive: (i: number) => void;
  onCaptionChange: (id: string, caption: string) => void;
  onRemove: (id: string) => void;
  onAddMore: () => void;
  onCancel: () => void;
  onSend: () => void;
  onCropped: (id: string, blob: Blob) => void;
}) {
  const [cropping, setCropping] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !sending) onCancel();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onCancel, sending]);

  if (!items.length || typeof document === "undefined") return null;
  const active = items[Math.min(activeIndex, items.length - 1)];

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="معاينة المرفقات قبل الإرسال"
      className="fixed inset-0 z-50 flex flex-col bg-slate-900 text-white"
    >
      <div className="safe-t flex shrink-0 items-center justify-between px-2 py-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={sending}
          aria-label="إلغاء"
          className="flex size-11 items-center justify-center rounded-full hover:bg-white/10 disabled:opacity-50"
        >
          <X size={20} aria-hidden="true" />
        </button>
        <span className="text-sm tabular-nums text-white/80">
          {items.length > 1
            ? `${(activeIndex + 1).toLocaleString("ar")} / ${items.length.toLocaleString("ar")}`
            : active.file.name}
        </span>
        <div className="flex items-center">
          {active.isImage ? (
            <button
              type="button"
              onClick={() => setCropping(true)}
              disabled={sending}
              aria-label="اقتصاص الصورة"
              className="flex size-11 items-center justify-center rounded-full hover:bg-white/10 disabled:opacity-50"
            >
              <Crop size={18} aria-hidden="true" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => onRemove(active.id)}
            disabled={sending}
            aria-label="حذف هذا المرفق"
            className="flex size-11 items-center justify-center rounded-full hover:bg-white/10 disabled:opacity-50"
          >
            <Trash2 size={18} aria-hidden="true" />
          </button>
        </div>
      </div>

      {cropping && active.isImage ? (
        <ImageCropper
          src={active.url}
          onCancel={() => setCropping(false)}
          onApply={(blob) => {
            onCropped(active.id, blob);
            setCropping(false);
          }}
        />
      ) : (
        <>
      <div className="flex min-h-0 flex-1 items-center justify-center p-3">
        {active.isImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={active.url}
            alt={active.file.name}
            className="max-h-full max-w-full object-contain"
          />
        ) : (
          <div className="flex flex-col items-center gap-3 text-center">
            <FileText size={56} aria-hidden="true" className="text-white/70" />
            <p className="max-w-xs break-words text-sm">{active.file.name}</p>
            <p className="text-xs text-white/60">{prettyBytes(active.file.size)}</p>
          </div>
        )}
      </div>

      {error ? (
        <p
          aria-live="polite"
          className="mx-3 mb-2 rounded-lg bg-red-500/20 px-3 py-2 text-sm text-red-100"
        >
          {error}
        </p>
      ) : null}

      {items.length > 1 ? (
        <div className="scroll-pane flex shrink-0 gap-2 px-3 pb-2 [&::-webkit-scrollbar]:hidden">
          {items.map((it, i) => (
            <button
              key={it.id}
              type="button"
              onClick={() => onSetActive(i)}
              aria-label={`المرفق ${i + 1}`}
              aria-current={i === activeIndex}
              className={cn(
                "size-14 shrink-0 overflow-hidden rounded-lg border-2 bg-white/10",
                i === activeIndex ? "border-emerald-400" : "border-transparent opacity-60"
              )}
            >
              {it.isImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={it.url} alt="" className="size-full object-cover" />
              ) : (
                <FileText size={20} aria-hidden="true" className="mx-auto" />
              )}
            </button>
          ))}
          <button
            type="button"
            onClick={onAddMore}
            disabled={sending}
            aria-label="إضافة مرفقات أخرى"
            className="flex size-14 shrink-0 items-center justify-center rounded-lg border-2 border-dashed border-white/40 hover:bg-white/10 disabled:opacity-50"
          >
            <Plus size={20} aria-hidden="true" />
          </button>
        </div>
      ) : null}

      <div className="safe-b flex shrink-0 items-end gap-2 border-t border-white/10 px-3 pt-3">
        {items.length === 1 ? (
          <button
            type="button"
            onClick={onAddMore}
            disabled={sending}
            aria-label="إضافة مرفقات أخرى"
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-50"
          >
            <Plus size={20} aria-hidden="true" />
          </button>
        ) : null}
        <textarea
          value={active.caption}
          onChange={(e) => onCaptionChange(active.id, e.target.value)}
          rows={1}
          aria-label="تعليق على المرفق"
          placeholder="أضيفي تعليقًا…"
          className="max-h-28 min-h-11 flex-1 resize-none rounded-2xl bg-white/10 px-4 py-2.5 text-sm text-white outline-none placeholder:text-white/50 focus:bg-white/15"
        />
        <button
          type="button"
          onClick={onSend}
          disabled={sending}
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-emerald-600 disabled:opacity-60"
        >
          {sending ? (
            <Loader2 size={20} className="animate-spin" aria-hidden="true" />
          ) : (
            <Send size={20} aria-hidden="true" />
          )}
          <span className="sr-only">
            إرسال {items.length > 1 ? `${items.length} مرفقات` : "المرفق"}
          </span>
        </button>
      </div>
        </>
      )}
    </div>,
    document.body
  );
}
