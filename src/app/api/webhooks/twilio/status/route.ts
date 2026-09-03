/**
 * POST /api/webhooks/twilio/status
 *
 * Delivery receipts. The Business Platform reports these on a separate URL from
 * inbound messages — unlike the OpenWA engine, which folded acks into the same
 * endpoint as an event type — so this is its own route rather than a branch.
 */
import { NextRequest, NextResponse } from "next/server";
import { updateDeliveryStatus } from "@/lib/server-conversations";
import { formToObject, isValidTwilioSignature } from "@/lib/transport/twilio-signature";

export const runtime = "nodejs";

/**
 * Twilio's vocabulary onto the inbox's.
 *
 * `undelivered` is kept rather than folded into `failed`: the two mean
 * different things to whoever is looking at the thread — one is our send going
 * wrong, the other is WhatsApp declining to hand it over — and the message
 * bubble already styles both.
 */
const STATUS_MAP: Record<string, string> = {
  queued: "queued",
  accepted: "queued",
  scheduled: "queued",
  sending: "sent",
  sent: "sent",
  delivered: "delivered",
  read: "read",
  failed: "failed",
  undelivered: "undelivered",
};

export async function POST(request: NextRequest) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const baseUrl = process.env.TWILIO_WEBHOOK_BASE_URL;
  if (!authToken || !baseUrl) {
    console.error("[twilio/status] TWILIO_AUTH_TOKEN / TWILIO_WEBHOOK_BASE_URL not set");
    return NextResponse.json({ error: "Not configured" }, { status: 500 });
  }

  let form: Record<string, string>;
  try {
    form = formToObject(await request.formData());
  } catch {
    return NextResponse.json({ error: "Invalid form body" }, { status: 400 });
  }

  const signed = `${baseUrl.replace(/\/+$/, "")}/api/webhooks/twilio/status`;
  if (
    !isValidTwilioSignature({
      authToken,
      url: signed,
      form,
      signature: request.headers.get("x-twilio-signature"),
    })
  ) {
    return NextResponse.json({ error: "Bad signature" }, { status: 403 });
  }

  const sid = form.MessageSid || form.SmsSid || "";
  const raw = (form.MessageStatus || form.SmsStatus || "").toLowerCase();
  if (!sid || !raw) {
    return NextResponse.json({ error: "Missing MessageSid or MessageStatus" }, { status: 400 });
  }

  const mapped = STATUS_MAP[raw];
  if (!mapped) {
    // An unrecognised status is Twilio telling us something new, not an error
    // worth a retry — record nothing and take the 200.
    console.warn(`[twilio/status] unmapped status "${raw}" for ${sid}`);
    return NextResponse.json({ ok: true, ignored: raw });
  }

  await updateDeliveryStatus(sid, mapped, raw);

  if (form.ErrorCode) {
    // 63016 is the one worth reading in logs: the 24-hour service window has
    // closed and that message needed an approved template.
    console.warn(`[twilio/status] ${sid} ${raw} ErrorCode=${form.ErrorCode}`);
  }

  return NextResponse.json({ ok: true });
}
