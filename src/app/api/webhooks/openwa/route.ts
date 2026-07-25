/**
 * POST /api/webhooks/openwa
 * Ingest endpoint for the persistent OpenWA service. Server-to-server, bearer
 * authenticated (OPENWA_INGEST_TOKEN). Persists live inbound + fromMe messages
 * into Kiara's conversations/messages, deduped by the WhatsApp message id, and
 * flags "handled on WhatsApp" for phone-app replies our app didn't send.
 */
import { NextRequest, NextResponse } from "next/server";
import { KIARA_RESTAURANT_ID } from "@/lib/tenant";
import {
  findOrCreateConversation,
  hasMessageWithSid,
  saveMessage,
  bumpConversationActivity,
  markHandledOnWhatsApp,
  updateDeliveryStatus,
} from "@/lib/server-conversations";
import {
  uploadBase64Media,
  messageTypeFromContentType,
  type StoredMediaSlot,
} from "@/lib/storage-media";
import type { OpenWaEvent } from "@/lib/transport/types";

export const runtime = "nodejs";
export const maxDuration = 60;

function authorized(request: NextRequest): boolean {
  const token = process.env.OPENWA_INGEST_TOKEN;
  return Boolean(token) && request.headers.get("authorization") === `Bearer ${token}`;
}

function normalizeE164(value: string): string | null {
  const s = (value || "").trim();
  if (!s) return null;
  if (s.startsWith("+")) return s;
  const digits = s.replace(/\D/g, "");
  return digits ? `+${digits}` : null;
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let event: OpenWaEvent;
  try {
    event = (await request.json()) as OpenWaEvent;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Delivery/read acks.
  if (event.type === "ack") {
    await updateDeliveryStatus(event.waMessageId, event.status);
    return NextResponse.json({ ok: true });
  }
  if (event.type !== "message") {
    return NextResponse.json({ error: "Unknown event type" }, { status: 400 });
  }

  // Idempotency: WA message id == external_message_sid. A known id means we
  // already stored it (including messages OUR app sent, which we record on send).
  if (await hasMessageWithSid(event.waMessageId)) {
    return NextResponse.json({ deduped: true });
  }

  const phone = normalizeE164(event.customerPhone);
  if (!phone) {
    return NextResponse.json({ error: "Missing customerPhone" }, { status: 400 });
  }

  const conv = await findOrCreateConversation(phone);

  let messageType = event.messageType || "text";
  const mediaSlots: StoredMediaSlot[] = [];
  if (event.media?.length) {
    for (const blob of event.media) {
      mediaSlots.push(
        await uploadBase64Media({
          restaurantId: KIARA_RESTAURANT_ID,
          conversationId: conv.id,
          contentType: blob.contentType,
          base64: blob.base64,
          originalFilename: blob.filename ?? null,
        })
      );
    }
    if (event.media[0]) {
      messageType = messageTypeFromContentType(event.media[0].contentType);
    }
  }

  const role: "customer" | "agent" = event.fromMe ? "agent" : "customer";
  const metadata: Record<string, unknown> = {};
  if (mediaSlots.length) metadata.media = mediaSlots;
  if (event.fromMe) metadata.source = "whatsapp_app";

  const messageId = await saveMessage({
    conversationId: conv.id,
    role,
    content: event.body || "",
    messageType,
    externalMessageSid: event.waMessageId,
    metadata,
    deliveryStatus: event.fromMe ? "sent" : "received",
    // Preserve the WhatsApp send time (epoch seconds) so backfilled history
    // interleaves correctly with live messages.
    createdAt: event.timestamp ? new Date(event.timestamp * 1000).toISOString() : undefined,
  });

  await bumpConversationActivity(conv.id, { inbound: !event.fromMe });

  // fromMe + new id => sent from the phone app (our sends are deduped above).
  if (event.fromMe) await markHandledOnWhatsApp(conv.id);

  return NextResponse.json({ ok: true, messageId, conversationId: conv.id });
}
