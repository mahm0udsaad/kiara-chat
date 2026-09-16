"use client";

import { Settings } from "lucide-react";
import { BotSettingsCard } from "@/components/bot-settings-card";
import { CatalogManager } from "@/components/catalog-manager";
import { SavedRepliesManager } from "@/components/saved-replies-manager";
import type { BotSettings } from "@/lib/bot-schedule";
import type { CatalogItem } from "@/lib/catalog";
import type { SavedReply } from "@/lib/saved-replies";
export function SettingsClient({
  bot,
  savedReplies,
  catalog,
}: {
  bot: BotSettings;
  savedReplies: SavedReply[];
  catalog: CatalogItem[];
}) {
  return (
    <div className="mx-auto max-w-lg px-4 py-6" dir="rtl">
      <div className="mb-5 flex items-center gap-2">
        <Settings size={20} className="text-[var(--brand)]" aria-hidden="true" />
        <h1 className="text-lg font-bold text-[var(--foreground)]">
          الإعدادات
        </h1>
      </div>

      <p className="mb-5 text-sm text-muted-foreground">
        تكلفة كل مشوار تُسجل يدوياً حسب المسافة من داخل تفاصيل الطلب، ويمكن
        تعديلها حتى بعد اكتمال الطلب.
      </p>

      <SavedRepliesManager initial={savedReplies} />
      <CatalogManager initial={catalog} />
      <BotSettingsCard initial={bot} />
    </div>
  );
}
