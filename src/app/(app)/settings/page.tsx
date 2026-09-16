import { requireAdmin } from "@/lib/tenant";
import { getBotSettings } from "@/lib/ai-settings";
import { listCatalog } from "@/lib/catalog";
import { listSavedReplies } from "@/lib/saved-replies";
import { SettingsClient } from "@/components/settings-client";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await requireAdmin();
  const [bot, savedReplies, catalog] = await Promise.all([
    getBotSettings(),
    listSavedReplies(),
    listCatalog(),
  ]);
  return (
    <SettingsClient
      bot={bot}
      savedReplies={savedReplies}
      catalog={catalog}
    />
  );
}
