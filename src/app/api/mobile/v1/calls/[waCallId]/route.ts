/**
 * GET    /api/mobile/v1/calls/:waCallId — current state, including the SDP answer.
 * DELETE /api/mobile/v1/calls/:waCallId — hang up.
 *
 * The GET exists because realtime broadcast is not durable. Meta's `connect`
 * webhook can land before the device has finished subscribing to the call
 * channel, and a broadcast with no listener is gone; the app polls this as its
 * safety net while the channel carries the fast path. A phone changing networks
 * mid-dial makes that race routine rather than exotic.
 */
import { endCall, getCall } from "@/lib/calls";
import {
  authorizeMobileRequest,
  mobileData,
  mobileError,
} from "@/lib/mobile/http";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ waCallId: string }> },
) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;

  const { waCallId } = await params;
  const call = await getCall(waCallId);
  if (!call) return mobileError(404, "CALL_NOT_FOUND", "Call not found");

  return mobileData({ call });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ waCallId: string }> },
) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;

  const { waCallId } = await params;
  try {
    await endCall(waCallId);
    return mobileData({ ok: true });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[mobile-api] CALL_HANGUP_FAILED ${waCallId}: ${detail}`);
    // The employee has already decided the call is over, and the device tears
    // its own peer connection down regardless. The terminate webhook reconciles
    // the row, so this reports the failure without implying the call is live.
    return mobileError(502, "CALL_HANGUP_FAILED", "تعذّر إنهاء المكالمة من الخادم");
  }
}
