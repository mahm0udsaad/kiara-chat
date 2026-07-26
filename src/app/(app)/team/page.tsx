import { requireAdmin } from "@/lib/tenant";
import { listTeam } from "@/lib/team";
import { TeamClient } from "@/components/team-client";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  await requireAdmin();
  return <TeamClient initialTeam={await listTeam()} />;
}
