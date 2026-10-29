import { requireAdmin } from "@/lib/tenant";
import { getBotSettings } from "@/lib/ai-settings";
import { listCatalog } from "@/lib/catalog";
import { listSavedReplies } from "@/lib/saved-replies";
import { getWelcomeSettings, WELCOME_QUIET_DAYS } from "@/lib/welcome-message";
import { SettingsClient } from "@/components/settings-client";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await requireAdmin();
  const [bot, welcome, savedReplies, catalog] = await Promise.all([
    getBotSettings(),
    getWelcomeSettings(),
    listSavedReplies(),
    listCatalog(),
  ]);
  return (
    <SettingsClient
      bot={bot}
      welcome={welcome}
      welcomeQuietDays={WELCOME_QUIET_DAYS}
      savedReplies={savedReplies}
      catalog={catalog}
    />
  );
}
