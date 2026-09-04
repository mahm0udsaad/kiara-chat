import { requireAdmin } from "@/lib/tenant";
import { BroadcastClient } from "@/components/broadcast-client";

export const dynamic = "force-dynamic";

export default async function BroadcastPage() {
  await requireAdmin();
  return <BroadcastClient templateKey="number_notice" />;
}
