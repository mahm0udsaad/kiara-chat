import { requireAdmin } from "@/lib/tenant";
import { getTeamReport } from "@/lib/analytics";
import { ReportsClient } from "@/components/reports-client";
import { getOperationsReport } from "@/lib/operations-report";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  await requireAdmin();
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const [teamReport, operationsReport] = await Promise.all([
    getTeamReport(),
    getOperationsReport({ from: today, to: today }),
  ]);
  return <ReportsClient report={teamReport} operationsReport={operationsReport} />;
}
