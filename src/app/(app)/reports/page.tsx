import { requireAdmin } from "@/lib/tenant";
import { getTeamReport } from "@/lib/analytics";
import { ReportsClient } from "@/components/reports-client";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  await requireAdmin();
  return <ReportsClient report={await getTeamReport()} />;
}
