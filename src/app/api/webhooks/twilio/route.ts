/**
 * POST /api/webhooks/twilio
 *
 * Ingest endpoint for the WhatsApp Business Platform sender (+966508421748).
 *
 * The shape differs from the OpenWA webhook in every mechanical way — a form
 * post rather than JSON, a request signature rather than a bearer token, media
 * behind a URL rather than inline — but lands in exactly the same conversation
 * and message rows, so the inbox cannot tell which number a thread arrived on.
 *
 * Three OpenWA concepts have no counterpart here and are absent by design:
 * `fromMe` (this number is not linked to anyone's phone, so there is nothing to
 * echo), group chats (the Business Platform has none), and `@lid` binding (a
 * Baileys anonymisation that Meta's API never produces).
 */
import { after, NextRequest, NextResponse } from "next/server";
import { KIARA_RESTAURANT_ID } from "@/lib/tenant";
import { runBotTurn } from "@/lib/bot/reply";
import { notifyInboundInboxMessage } from "@/lib/inbox-notifications";
import {
  findOrCreateConversation,
  hasMessageWithSid,
  saveMessage,
  bumpConversationActivity,
  rememberConversationTransport,
} from "@/lib/server-conversations";
import {
  storeMediaFromUrl,
  messageTypeFromContentType,
  type StoredMediaSlot,
} from "@/lib/storage-media";
import { formToObject, isValidTwilioSignature } from "@/lib/transport/twilio-signature";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Strip Twilio's channel prefix: `whatsapp:+9665…` → `+9665…`. */
function toE164(value: string | undefined): string | null {
  const raw = (value ?? "").trim().replace(/^whatsapp:/i, "");
  if (!raw) return null;
  if (raw.startsWith("+")) return raw;
  const digits = raw.replace(/\D/g, "");
  return digits ? `+${digits}` : null;
}

export async function POST(request: NextRequest) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const baseUrl = process.env.TWILIO_WEBHOOK_BASE_URL;
  if (!authToken || !baseUrl) {
    console.error("[twilio] TWILIO_AUTH_TOKEN / TWILIO_WEBHOOK_BASE_URL not set");
    return NextResponse.json({ error: "Not configured" }, { status: 500 });
  }

  let form: Record<string, string>;
  try {
    form = formToObject(await request.formData());
  } catch {
    return NextResponse.json({ error: "Invalid form body" }, { status: 400 });
  }

  // The signed URL is the one Twilio was configured with, not the one this
  // function sees — behind Vercel's proxy those differ and the hash would never
  // match.
  const signed = `${baseUrl.replace(/\/+$/, "")}/api/webhooks/twilio`;
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

  const messageSid = form.MessageSid || form.SmsMessageSid || "";
  if (!messageSid) {
    return NextResponse.json({ error: "Missing MessageSid" }, { status: 400 });
  }

  // Twilio retries on any non-2xx, so a message we already stored has to come
  // back as a success rather than an error it would keep re-delivering.
  if (await hasMessageWithSid(messageSid)) {
    return NextResponse.json({ deduped: true });
  }

  const phone = toE164(form.From);
  if (!phone) {
    return NextResponse.json({ error: "Missing From" }, { status: 400 });
  }
  const kiaraNumber = toE164(form.To);

  const conv = await findOrCreateConversation(phone, form.ProfileName || null);

  // Pin the thread to this number so the reply goes back the way it came. A
  // customer with history on the old number keeps that history — only the
  // number answering her changes.
  await rememberConversationTransport(conv.id, "twilio", kiaraNumber);

  let body = form.Body || "";
  let messageType = "text";
  const metadata: Record<string, unknown> = {
    provider: "twilio",
    ...(kiaraNumber ? { via: kiaraNumber } : {}),
  };

  // A shared pin arrives as coordinates rather than as media.
  if (form.Latitude && form.Longitude) {
    messageType = "location";
    metadata.location = {
      latitude: form.Latitude,
      longitude: form.Longitude,
      ...(form.Address ? { address: form.Address } : {}),
      ...(form.Label ? { label: form.Label } : {}),
    };
    if (!body) {
      body = form.Label || form.Address || `${form.Latitude},${form.Longitude}`;
    }
  }

  const mediaCount = Number.parseInt(form.NumMedia || "0", 10) || 0;
  if (mediaCount > 0) {
    const slots: StoredMediaSlot[] = [];
    for (let i = 0; i < mediaCount; i += 1) {
      const url = form[`MediaUrl${i}`];
      const contentType = form[`MediaContentType${i}`] || "application/octet-stream";
      if (!url) continue;
      slots.push(
        await storeMediaFromUrl({
          restaurantId: KIARA_RESTAURANT_ID,
          conversationId: conv.id,
          url,
          contentType,
          // Twilio keeps inbound media behind the account credentials and drops
          // it a few hours later, so it is fetched now or lost.
          auth: {
            username: process.env.TWILIO_ACCOUNT_SID ?? "",
            password: authToken,
          },
        }),
      );
    }
    if (slots.length) {
      metadata.media = slots;
      messageType = messageTypeFromContentType(slots[0].content_type);
    }
  }

  const messageId = await saveMessage({
    conversationId: conv.id,
    role: "customer",
    content: body,
    messageType,
    externalMessageSid: messageSid,
    twilioMessageSid: messageSid,
    metadata,
    deliveryStatus: "received",
  });

  await bumpConversationActivity(conv.id, { inbound: true });

  // Answer Twilio immediately; a slow notification or model call must not stall
  // ingestion or earn us a retry.
  after(() => notifyInboundInboxMessage(conv.id));

  if (body.trim()) {
    after(() =>
      runBotTurn({
        conversationId: conv.id,
        customerPhone: phone,
        body,
      }),
    );
  }

  return NextResponse.json({ ok: true, messageId, conversationId: conv.id });
}
