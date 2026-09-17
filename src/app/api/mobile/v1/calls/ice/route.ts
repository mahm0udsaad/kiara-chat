/**
 * GET /api/mobile/v1/calls/ice — ICE servers for a call the app is about to place.
 *
 * Fetched before the peer connection is constructed rather than alongside the
 * call: candidates are gathered against these servers, and the Calling API
 * takes one complete SDP rather than trickling candidates afterwards.
 *
 * TURN credentials are minted per request and expire within the hour, so this
 * is deliberately not cached on the device.
 */
import { iceConfig } from "@/lib/ice-servers";
import { authorizeMobileRequest, mobileData } from "@/lib/mobile/http";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;

  return mobileData(iceConfig(auth.session.userId));
}
