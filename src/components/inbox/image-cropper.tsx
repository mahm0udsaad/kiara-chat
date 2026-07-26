"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RotateCw, Check, X, Loader2 } from "lucide-react";

/** Crop rect in relative units (0–1) of the image, so it survives resizes. */
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const FULL: Rect = { x: 0, y: 0, w: 1, h: 1 };
const MIN = 0.08; // don't let the selection collapse to nothing

type DragMode = "move" | "nw" | "ne" | "sw" | "se";

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Rotate an image 90° clockwise by baking it into a new blob, rather than
 * carrying a rotation flag around. Keeps the crop maths trivial: the image on
 * screen is always the image we export from.
 */
async function rotate90(src: string): Promise<Blob | null> {
  const img = await loadImage(src);
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalHeight;
  canvas.height = img.naturalWidth;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
  return toBlob(canvas);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function toBlob(canvas: HTMLCanvasElement, type = "image/jpeg"): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, 0.92));
}

export function ImageCropper({
  src,
  onCancel,
  onApply,
}: {
  src: string;
  onCancel: () => void;
  onApply: (blob: Blob) => void;
}) {
  const [workingSrc, setWorkingSrc] = useState(src);
  const [crop, setCrop] = useState<Rect>(FULL);
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ mode: DragMode; px: number; py: number; start: Rect } | null>(
    null
  );
  // Object URLs minted for rotated intermediates, revoked on unmount.
  const tempUrls = useRef<string[]>([]);

  useEffect(() => {
    const urls = tempUrls.current;
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, []);

  const onPointerDown = useCallback(
    (mode: DragMode) => (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      (e.target as Element).setPointerCapture?.(e.pointerId);
      dragRef.current = { mode, px: e.clientX, py: e.clientY, start: crop };
    },
    [crop]
  );

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current;
    const box = boxRef.current;
    if (!drag || !box) return;
    const rect = box.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    // Convert the pointer delta into the image's relative space.
    const dx = (e.clientX - drag.px) / rect.width;
    const dy = (e.clientY - drag.py) / rect.height;
    const s = drag.start;

    setCrop(() => {
      if (drag.mode === "move") {
        return {
          ...s,
          x: clamp(s.x + dx, 0, 1 - s.w),
          y: clamp(s.y + dy, 0, 1 - s.h),
        };
      }
      let { x, y, w, h } = s;
      if (drag.mode === "nw") {
        const nx = clamp(s.x + dx, 0, s.x + s.w - MIN);
        const ny = clamp(s.y + dy, 0, s.y + s.h - MIN);
        w = s.x + s.w - nx;
        h = s.y + s.h - ny;
        x = nx;
        y = ny;
      } else if (drag.mode === "ne") {
        const ny = clamp(s.y + dy, 0, s.y + s.h - MIN);
        w = clamp(s.w + dx, MIN, 1 - s.x);
        h = s.y + s.h - ny;
        y = ny;
      } else if (drag.mode === "sw") {
        const nx = clamp(s.x + dx, 0, s.x + s.w - MIN);
        w = s.x + s.w - nx;
        h = clamp(s.h + dy, MIN, 1 - s.y);
        x = nx;
      } else {
        w = clamp(s.w + dx, MIN, 1 - s.x);
        h = clamp(s.h + dy, MIN, 1 - s.y);
      }
      return { x, y, w, h };
    });
  }, []);

  const endDrag = useCallback(() => {
    dragRef.current = null;
  }, []);

  const doRotate = useCallback(async () => {
    setBusy(true);
    try {
      const blob = await rotate90(workingSrc);
      if (blob) {
        const url = URL.createObjectURL(blob);
        tempUrls.current.push(url);
        setWorkingSrc(url);
        setCrop(FULL); // the frame no longer matches the new orientation
      }
    } finally {
      setBusy(false);
    }
  }, [workingSrc]);

  const doApply = useCallback(async () => {
    setBusy(true);
    try {
      const img = await loadImage(workingSrc);
      // Crop is relative, so it maps straight onto natural pixels — the export
      // is full resolution regardless of how large the preview happened to be.
      const sx = Math.round(crop.x * img.naturalWidth);
      const sy = Math.round(crop.y * img.naturalHeight);
      const sw = Math.max(1, Math.round(crop.w * img.naturalWidth));
      const sh = Math.max(1, Math.round(crop.h * img.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = sw;
      canvas.height = sh;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
      const blob = await toBlob(canvas);
      if (blob) onApply(blob);
    } finally {
      setBusy(false);
    }
  }, [workingSrc, crop, onApply]);

  const pct = (n: number) => `${n * 100}%`;
  const handleClass =
    "absolute size-8 rounded-full border-2 border-white bg-emerald-500/90 shadow touch-none";

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1 items-center justify-center p-3">
        <div
          ref={boxRef}
          className="relative inline-block max-h-full max-w-full touch-none select-none"
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={workingSrc}
            alt="اقتصاص الصورة"
            draggable={false}
            className="block max-h-[60dvh] max-w-full object-contain"
          />

          {/* Dim everything outside the selection. overflow-hidden is load
              bearing: the huge spread shadow would otherwise darken the whole
              screen instead of just the area around the crop. */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div
              className="absolute border-2 border-emerald-400"
              style={{
                left: pct(crop.x),
                top: pct(crop.y),
                width: pct(crop.w),
                height: pct(crop.h),
                boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
              }}
            />
          </div>

          {/* Move the whole selection. */}
          <div
            role="presentation"
            onPointerDown={onPointerDown("move")}
            className="absolute cursor-move touch-none"
            style={{
              left: pct(crop.x),
              top: pct(crop.y),
              width: pct(crop.w),
              height: pct(crop.h),
            }}
          />

          {(
            [
              ["nw", crop.x, crop.y],
              ["ne", crop.x + crop.w, crop.y],
              ["sw", crop.x, crop.y + crop.h],
              ["se", crop.x + crop.w, crop.y + crop.h],
            ] as [DragMode, number, number][]
          ).map(([mode, cx, cy]) => (
            <div
              key={mode}
              role="presentation"
              aria-label={`تغيير حجم الاقتصاص (${mode})`}
              onPointerDown={onPointerDown(mode)}
              className={handleClass}
              style={{ left: pct(cx), top: pct(cy), transform: "translate(-50%, -50%)" }}
            />
          ))}
        </div>
      </div>

      <div className="safe-b flex shrink-0 items-center justify-between gap-2 border-t border-white/10 px-3 pt-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm text-white/80 hover:bg-white/10 disabled:opacity-50"
        >
          <X size={18} aria-hidden="true" /> إلغاء
        </button>
        <button
          type="button"
          onClick={doRotate}
          disabled={busy}
          className="flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm text-white/80 hover:bg-white/10 disabled:opacity-50"
        >
          <RotateCw size={18} aria-hidden="true" /> تدوير
        </button>
        <button
          type="button"
          onClick={doApply}
          disabled={busy}
          className="flex min-h-11 items-center gap-1.5 rounded-lg bg-emerald-600 px-4 text-sm font-medium text-white disabled:opacity-60"
        >
          {busy ? (
            <Loader2 size={18} className="animate-spin" aria-hidden="true" />
          ) : (
            <Check size={18} aria-hidden="true" />
          )}
          تطبيق
        </button>
      </div>
    </div>
  );
}
