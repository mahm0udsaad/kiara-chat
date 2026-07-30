import { requireAdmin } from "@/lib/tenant";
import { listTeam } from "@/lib/team";
import { listSpecialists, listDrivers } from "@/lib/dispatch";
import { TeamClient } from "@/components/team-client";
import { RosterManager } from "@/components/roster-manager";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  await requireAdmin();
  const [team, specialists, drivers] = await Promise.all([
    listTeam(),
    listSpecialists(),
    listDrivers(),
  ]);
  return (
    <>
      <TeamClient initialTeam={team} />
      <RosterManager initialSpecialists={specialists} initialDrivers={drivers} />
    </>
  );
}
