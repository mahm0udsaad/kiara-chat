"use client";

import { useState } from "react";
import { ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CatalogItem } from "@/lib/catalog";

/**
 * The service photo the salon uploaded to Rekaz, served straight from its CDN
 * (same origin the parent app already stores in `menu_items.image_url`).
 * A missing or dead link falls back to a placeholder rather than a broken
 * image — a handful of services have no photo at all.
 */
export function CatalogThumb({
  item,
  className,
}: {
  item: Pick<CatalogItem, "name" | "imageUrl">;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const box = cn(
    "size-12 shrink-0 overflow-hidden rounded-lg border bg-[var(--surface)]",
    className
  );

  if (!item.imageUrl || failed) {
    return (
      <span className={cn(box, "flex items-center justify-center")}>
        <ImageIcon size={16} className="text-[var(--subtle)]" aria-hidden="true" />
      </span>
    );
  }

  return (
    <span className={box}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={item.imageUrl}
        alt={item.name}
        loading="lazy"
        onError={() => setFailed(true)}
        className="size-full object-cover"
      />
    </span>
  );
}
