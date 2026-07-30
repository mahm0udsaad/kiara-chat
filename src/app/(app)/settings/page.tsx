import { requireAdmin } from "@/lib/tenant";
import { getDispatchSettings } from "@/lib/dispatch";
import { getBotSettings } from "@/lib/ai-settings";
import { listCatalog } from "@/lib/catalog";
import { listSavedReplies } from "@/lib/saved-replies";
import { SettingsClient } from "@/components/settings-client";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await requireAdmin();
  const [dispatch, bot, savedReplies, catalog] = await Promise.all([
    getDispatchSettings(),
    getBotSettings(),
    listSavedReplies(),
    listCatalog(),
  ]);
  return (
    <SettingsClient
      initial={dispatch}
      bot={bot}
      savedReplies={savedReplies}
      catalog={catalog}
    />
  );
}
