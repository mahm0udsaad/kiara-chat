"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/**
 * Bottom sheet on phones, centred dialog from sm up. Used to keep the chat
 * screen free of controls — everything else opens in here.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    // Stop the page behind the sheet from scrolling with it.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <button
        type="button"
        aria-label="إغلاق"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        className="safe-b relative max-h-[85dvh] w-full overflow-y-auto rounded-t-2xl bg-[var(--surface)] shadow-xl outline-none [overscroll-behavior:contain] sm:max-w-md sm:rounded-2xl sm:pb-0"
      >
        {/* Grab handle — signals the sheet is dismissable on touch. */}
        <div className="sticky top-0 z-10 bg-[var(--surface)] pt-2">
          <div className="mx-auto mb-1 h-1 w-10 rounded-full bg-slate-300 sm:hidden" />
          <div className="flex items-center justify-between border-b px-4 pb-2">
            <h2 className="font-semibold text-[var(--foreground)]">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="إغلاق"
              className="flex size-10 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-[var(--brand-soft)]"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className="px-4 py-3">{children}</div>
      </div>
    </div>,
    document.body
  );
}
