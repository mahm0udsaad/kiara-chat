/**
 * GET /api/calls/ice — ICE servers for a call the browser is about to place.
 *
 * Fetched before the peer connection is constructed, not alongside the call:
 * candidates have to be gathered against these servers before there is an SDP
 * to send, and this API takes one complete SDP rather than trickling.
 *
 * TURN credentials are minted per request and expire within the hour.
 */
import { NextResponse } from "next/server";

import { iceConfig } from "@/lib/ice-servers";
import { getKiaraSession } from "@/lib/tenant";

export const runtime = "nodejs";

export async function GET() {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(iceConfig(session.userId));
}
