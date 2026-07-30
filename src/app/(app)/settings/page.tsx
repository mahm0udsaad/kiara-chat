import { requireAdmin } from "@/lib/tenant";
import { getDispatchSettings } from "@/lib/dispatch";
import { getBotSettings } from "@/lib/ai-settings";
import { SettingsClient } from "@/components/settings-client";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await requireAdmin();
  const [dispatch, bot] = await Promise.all([getDispatchSettings(), getBotSettings()]);
  return <SettingsClient initial={dispatch} bot={bot} />;
}
