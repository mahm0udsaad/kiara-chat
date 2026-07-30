import { NextResponse } from "next/server";
import { getKiaraSession } from "@/lib/tenant";
import {
  getDispatchSettings,
  listDrivers,
  listSpecialists,
} from "@/lib/dispatch";

/**
 * The order sheet used to make separate requests for specialists, drivers, and
 * (for admins) prices. Each request repeated middleware + verified auth + tenant
 * authorization. Resolve the session once and parallelize the three small reads.
 */
export async function GET() {
  const session = await getKiaraSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [specialists, drivers, settings] = await Promise.all([
    listSpecialists({ activeOnly: true }),
    listDrivers({ activeOnly: true }),
    session.role === "admin"
      ? getDispatchSettings()
      : Promise.resolve(null),
  ]);

  return NextResponse.json({ specialists, drivers, settings });
}
