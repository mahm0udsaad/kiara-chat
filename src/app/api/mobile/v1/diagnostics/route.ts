import { authorizeAnyMobileRequest, mobileData } from "@/lib/mobile/http";
import {
  parseDiagnosticDevice,
  parseDiagnosticEvents,
  saveMobileDiagnostics,
} from "@/lib/mobile-diagnostics";

/**
 * POST /api/mobile/v1/diagnostics — the phone reports its own failures.
 *
 * Fire-and-forget from the app's side. It always answers 200 once the caller
 * is known: a report that cannot be stored (for instance before the table's
 * migration lands) must not come back as an error the app then reports.
 */
export async function POST(request: Request) {
  const auth = await authorizeAnyMobileRequest(request);
  if (auth.response) return auth.response;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const saved = await saveMobileDiagnostics(
    { userId: auth.session.userId, role: auth.session.role },
    parseDiagnosticDevice(body?.device),
    parseDiagnosticEvents(body?.events),
  ).catch(() => 0);
  return mobileData({ saved });
}
