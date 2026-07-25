import { requireAdmin } from "@/lib/tenant";
import { ConnectClient } from "@/components/connect-client";

export const dynamic = "force-dynamic";

export default async function ConnectPage() {
  await requireAdmin();
  return <ConnectClient />;
}
