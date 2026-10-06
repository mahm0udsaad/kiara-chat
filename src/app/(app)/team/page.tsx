import { requireAdmin } from "@/lib/tenant";
import { listTeam } from "@/lib/team";
import { listSpecialists, listDrivers } from "@/lib/dispatch";
import { TeamClient } from "@/components/team-client";
import { RosterManager } from "@/components/roster-manager";
import { listFieldStaffAccounts } from "@/lib/field-staff";
import { listDistricts } from "@/lib/districts";
import { DistrictManager } from "@/components/district-manager";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  await requireAdmin();
  const [team, specialists, drivers, fieldAccounts, districts] = await Promise.all([
    listTeam(),
    listSpecialists(),
    listDrivers(),
    listFieldStaffAccounts(),
    listDistricts({ withPrice: true }),
  ]);
  return (
    <>
      <TeamClient initialTeam={team} />
      <RosterManager
        initialSpecialists={specialists}
        initialDrivers={drivers}
        initialAccounts={fieldAccounts}
      />
      <DistrictManager initialDistricts={districts} />
    </>
  );
}
