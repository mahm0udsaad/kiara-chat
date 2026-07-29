import { requireAdmin } from "@/lib/tenant";
import { getDispatchSettings } from "@/lib/dispatch";
import { SettingsClient } from "@/components/settings-client";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await requireAdmin();
  return <SettingsClient initial={await getDispatchSettings()} />;
}
