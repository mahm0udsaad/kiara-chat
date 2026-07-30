"use client";

import { useEffect, useState } from "react";
import {
  Mic,
  FileText,
  ExternalLink,
  Loader2,
  Check,
  CheckCheck,
  Clock3,
  AlertCircle,
} from "lucide-react";
import { formatDayLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Message, MediaSlot } from "@/lib/types";

const MEDIA_TYPES = new Set([
  "image",
  "audio",
  "voice",
  "video",
  "document",
  "file",
]);

const AR = /[؀-ۿ]/;

/**
 * Pinned to Riyadh: the salon runs on KSA wall-clock, and an explicit zone also
 * keeps the server render and the client render agreeing (the server is UTC).
 */
const TIME_FMT = new Intl.DateTimeFormat("ar", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Riyadh",
});

/**
 * The thread used to render as one flat list, so a reply three days later sat
 * flush against the message before it — you couldn't tell an hour from a week.
 */
export function DaySeparator({ iso }: { iso: string }) {
  return (
    <div className="flex justify-center py-1">
      <span className="rounded-full bg-slate-200/80 px-3 py-1 text-[11px] font-medium text-slate-600">
        {formatDayLabel(iso)}
      </span>
    </div>
  );
}

function formatBytes(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes.toLocaleString("ar")} بايت`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} ك.ب`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} م.ب`;
}

const STATUS_LABEL: Record<string, string> = {
  queued: "في قائمة الإرسال",
  sent: "مرسلة",
  delivered: "تم التسليم",
  read: "تمت القراءة",
  failed: "فشلت",
  undelivered: "لم يتم التسليم",
  received: "",
};

/**
 * Delivery state as a tick, not a sentence. "في قائمة الإرسال" under a
 * four-word reply was longer than the reply. The Arabic stays as the accessible
 * name, so nothing is lost for a screen reader or a long-press tooltip.
 */
function StatusTick({ status }: { status: string }) {
  const label = STATUS_LABEL[status] ?? status;
  if (!label) return null;

  const icon =
    status === "read" || status === "delivered" ? (
      <CheckCheck size={13} aria-hidden="true" />
    ) : status === "queued" ? (
      <Clock3 size={11} aria-hidden="true" />
    ) : status === "failed" || status === "undelivered" ? (
      <AlertCircle size={12} aria-hidden="true" />
    ) : (
      <Check size={12} aria-hidden="true" />
    );

  return (
    <span
      title={label}
      aria-label={label}
      role="img"
      className={cn(
        "flex shrink-0 items-center",
        // Read is the one state worth a colour; failure needs to shout.
        status === "read" && "text-sky-200",
        (status === "failed" || status === "undelivered") && "text-rose-200"
      )}
    >
      {icon}
    </span>
  );
}

function MetaFooter({ message }: { message: Message }) {
  const status = message.delivery_status || message.twilio_status || "";
  return (
    <p className="mt-1 flex items-center justify-end gap-1 text-[10px] opacity-70">
      {/* Rendered from the ISO string on both server and client, and pinned to
          hour/minute + Riyadh so locale defaults can't cause a mismatch. */}
      <time dateTime={message.created_at} className="tabular-nums">
        {TIME_FMT.format(new Date(message.created_at))}
      </time>
      <StatusTick status={status} />
    </p>
  );
}

function MediaSlotView({
  slot,
  messageType,
}: {
  slot: MediaSlot;
  messageType: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!slot.storage_path) return;
    (async () => {
      try {
        const res = await fetch(
          `/api/media?path=${encodeURIComponent(slot.storage_path!)}`
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json();
        if (!cancelled) setUrl(body.url);
      } catch (e) {
        if (!cancelled)
          setErr(e instanceof Error ? e.message : "تعذّر تحميل الملف");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slot.storage_path]);

  if (slot.delivery_status === "too_large") {
    return (
      <div className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-800">
        ملف كبير لم يتم تحميله. {formatBytes(slot.size_bytes)}
      </div>
    );
  }
  if (!slot.storage_path) {
    return (
      <div className="rounded-md border border-rose-300 bg-rose-50 px-2 py-1 text-xs text-rose-800">
        تعذّر تخزين الملف. {slot.content_type}
      </div>
    );
  }
  if (err) {
    return (
      <div className="rounded-md border border-rose-300 bg-rose-50 px-2 py-1 text-xs text-rose-800">
        {err}
      </div>
    );
  }
  if (!url) {
    return (
      <div className="flex items-center gap-2 rounded-md bg-black/5 px-2 py-1 text-xs">
        <Loader2 size={12} className="animate-spin" /> جارٍ التحميل…
      </div>
    );
  }

  if (messageType === "image") {
    return (
      <a href={url} target="_blank" rel="noreferrer noopener">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={slot.original_filename || "صورة"}
          loading="lazy"
          className="max-h-64 max-w-full rounded-lg object-contain"
        />
      </a>
    );
  }
  if (messageType === "voice" || messageType === "audio") {
    return (
      <div className="flex items-center gap-2">
        {messageType === "voice" ? (
          <Mic size={14} className="flex-shrink-0 opacity-70" />
        ) : null}
        <audio controls src={url} className="max-w-full" />
      </div>
    );
  }
  if (messageType === "video") {
    return (
      <video
        controls
        preload="metadata"
        src={url}
        className="max-h-[300px] max-w-full rounded-lg"
      />
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex items-center gap-2 rounded-md border border-current/20 bg-black/5 px-2 py-1 text-xs"
    >
      <FileText size={14} />
      <span className="max-w-[200px] truncate">
        {slot.original_filename || slot.content_type || "ملف"}
      </span>
      {slot.size_bytes ? (
        <span className="opacity-70">{formatBytes(slot.size_bytes)}</span>
      ) : null}
      <ExternalLink size={12} />
    </a>
  );
}

export function MessageBubble({ message }: { message: Message }) {
  const isCustomer = message.role === "customer";
  const isSystem = message.role === "system";

  if (isSystem) {
    return (
      <div className="flex justify-center">
        <div className="rounded-full bg-slate-200/70 px-3 py-1 text-[11px] text-slate-600">
          {message.content}
        </div>
      </div>
    );
  }

  // Outgoing is the brand indigo, not WhatsApp green — green already means
  // "handled on the WhatsApp app" on the conversation card.
  const bubbleColor = isCustomer
    ? "bg-white border border-slate-200 text-slate-900"
    : "bg-[var(--brand)] text-white";
  const align = isCustomer ? "justify-start" : "justify-end";
  const dir = AR.test(message.content || "") ? "rtl" : "ltr";

  const meta = (message.metadata as { media?: MediaSlot[] }) || {};
  const slots = MEDIA_TYPES.has(message.message_type) ? meta.media || [] : [];

  if (slots.length > 0) {
    return (
      <div className={cn("flex", align)}>
        <div
          className={cn(
            "max-w-[85%] space-y-2 break-words rounded-2xl px-3 py-2 text-sm shadow-sm sm:max-w-[75%]",
            bubbleColor
          )}
          dir={dir}
        >
          {slots.map((slot, idx) => (
            <MediaSlotView
              key={`${message.id}-m${idx}`}
              slot={slot}
              messageType={message.message_type}
            />
          ))}
          {message.content ? (
            <p className="whitespace-pre-wrap">{message.content}</p>
          ) : null}
          <MetaFooter message={message} />
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex", align)}>
      <div
        className={cn(
          "max-w-[85%] break-words rounded-2xl px-3 py-2 text-sm shadow-sm sm:max-w-[75%]",
          bubbleColor
        )}
        dir={dir}
      >
        <p className="whitespace-pre-wrap">{message.content}</p>
        <MetaFooter message={message} />
      </div>
    </div>
  );
}
