/**
 * GET    /api/calls/:waCallId — current state, including the SDP answer.
 * DELETE /api/calls/:waCallId — hang up.
 *
 * The GET exists because realtime broadcast is not durable. Meta's `connect`
 * webhook can land before the caller's browser has finished subscribing to the
 * call channel, and a broadcast with no listener is gone; the client polls this
 * as its safety net while the channel carries the fast path.
 */
import { NextResponse } from "next/server";

import { endCall, getCall } from "@/lib/calls";
import { getKiaraSession } from "@/lib/tenant";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ waCallId: string }> },
) {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { waCallId } = await params;
  const call = await getCall(waCallId);
  if (!call) return NextResponse.json({ error: "Call not found" }, { status: 404 });

  return NextResponse.json({ call });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ waCallId: string }> },
) {
  const session = await getKiaraSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { waCallId } = await params;
  try {
    await endCall(waCallId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[calls] hangup of ${waCallId} failed: ${detail}`);
    // The employee has already decided the call is over. Say so rather than
    // leaving a dead call on screen; the terminate webhook reconciles the row.
    return NextResponse.json(
      { ok: false, error: "تعذّر إنهاء المكالمة من الخادم" },
      { status: 502 },
    );
  }
}
