import { inboxProvider } from "@/lib/transport/inbox-provider";
import { createHmac, timingSafeEqual } from "crypto";
import { after, NextRequest, NextResponse } from "next/server";
import { runBotTurn } from "@/lib/bot/reply";
import { notifyInboundInboxMessage } from "@/lib/inbox-notifications";
import {
  bumpConversationActivity,
  findOrCreateConversation,
  hasMessageWithSid,
  rememberConversationTransport,
  saveMessage,
  updateDeliveryStatus,
} from "@/lib/server-conversations";
import {
  messageTypeFromContentType,
  uploadBase64Media,
  type StoredMediaSlot,
} from "@/lib/storage-media";
import { KIARA_RESTAURANT_ID } from "@/lib/tenant";
import { metaCloudConfig } from "@/lib/transport/meta-api";
import { downloadMetaMedia } from "@/lib/transport/meta";
import { parseCallPermissionReply } from "@/lib/transport/meta-calling";
import { applyCallPermissionReply } from "@/lib/call-permissions";
import { ingestCalls } from "@/lib/calls";
import { customerProvider } from "@/lib/transport";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 60;

type MetaMessage = {
  id?: string;
  from?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  button?: { text?: string; payload?: string };
  interactive?: {
    type?: string;
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string; description?: string };
    call_permission_reply?: {
      response?: string;
      is_permanent?: boolean;
      expiration_timestamp?: number | string;
      response_source?: string;
    };
  };
  location?: {
    latitude?: number;
    longitude?: number;
    name?: string;
    address?: string;
  };
  /** Set when this message answers another — a call permission reply points
   * back at the request that produced it. */
  context?: { id?: string; from?: string };
  image?: MetaMedia;
  video?: MetaMedia;
  audio?: MetaMedia & { voice?: boolean };
  document?: MetaMedia;
  sticker?: MetaMedia;
  /** An emoji on one of the thread's messages. An empty `emoji` removes it. */
  reaction?: { message_id?: string; emoji?: string };
  contacts?: Array<{
    name?: { formatted_name?: string };
    phones?: Array<{ phone?: string; wa_id?: string }>;
  }>;
  /** Present on `type: "unsupported"` — e.g. polls, view-once media past its
   * viewing window, or a message shape this API version doesn't relay. */
  errors?: Array<{ code?: number; title?: string; message?: string }>;
};

type MetaMedia = {
  id?: string;
  mime_type?: string;
  caption?: string;
  filename?: string;
};

type MetaValue = {
  messaging_product?: string;
  metadata?: { display_phone_number?: string; phone_number_id?: string };
  contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
  messages?: MetaMessage[];
  statuses?: Array<{
    id?: string;
    status?: string;
    timestamp?: string;
    errors?: Array<{ code?: number; title?: string; message?: string }>;
  }>;
};

type WebhookPayload = {
  object?: string;
  entry?: Array<{ changes?: Array<{ field?: string; value?: MetaValue }> }>;
};

const STATUS_MAP: Record<string, string> = {
  sent: "sent",
  delivered: "delivered",
  read: "read",
  failed: "failed",
};

function e164(value: string | undefined): string | null {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits ? `+${digits}` : null;
}

function validSignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature?.startsWith("sha256=")) return false;
  const received = signature.slice("sha256=".length);
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  if (!/^[a-f0-9]{64}$/i.test(received) || received.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(received, "hex"), Buffer.from(expected, "hex"));
}

function messageText(message: MetaMessage): string {
  if (message.text?.body) return message.text.body;
  if (message.button?.text) return message.button.text;
  if (message.interactive?.button_reply?.title) return message.interactive.button_reply.title;
  if (message.interactive?.list_reply?.title) return message.interactive.list_reply.title;
  if (message.location) {
    return (
      message.location.name ||
      message.location.address ||
      `${message.location.latitude ?? ""},${message.location.longitude ?? ""}`
    );
  }
  return (
    message.image?.caption ||
    message.video?.caption ||
    message.document?.caption ||
    ""
  );
}

const MEDIA_TYPES = new Set(["image", "video", "audio", "document", "sticker"]);

function messageMedia(message: MetaMessage): MetaMedia | null {
  return (
    message.image ||
    message.video ||
    message.audio ||
    message.document ||
    message.sticker ||
    null
  );
}

async function storeInboundMedia(
  message: MetaMessage,
  conversationId: string,
): Promise<StoredMediaSlot | null> {
  const media = messageMedia(message);
  if (!media?.id) return null;
  try {
    const downloaded = await downloadMetaMedia(media.id);
    return uploadBase64Media({
      restaurantId: KIARA_RESTAURANT_ID,
      conversationId,
      contentType: media.mime_type || downloaded.contentType,
      base64: downloaded.buffer.toString("base64"),
      originalFilename: media.filename || downloaded.filename,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[meta/webhook] media ${media.id} failed: ${detail}`);
    return {
      storage_path: null,
      content_type: media.mime_type || "application/octet-stream",
      size_bytes: null,
      original_filename: media.filename || null,
      delivery_status: "failed",
      fetch_error: detail.slice(0, 300),
    };
  }
}

/**
 * A reaction as a line staff can read. Stored as the message text so every
 * surface — web, phone, inbox preview, older app builds — shows it without
 * knowing about reactions; the bot never sees it, because it reads `content`
 * from `messageText`, which stays empty.
 */
async function reactionText(
  conversationId: string,
  reaction: NonNullable<MetaMessage["reaction"]>,
): Promise<string> {
  const emoji = reaction.emoji?.trim() || "";
  let quoted = "";
  if (reaction.message_id) {
    const { data } = await getAdminSupabaseClient()
      .from("messages")
      .select("content")
      .eq("conversation_id", conversationId)
      .eq("external_message_sid", reaction.message_id)
      .maybeSingle();
    const text = ((data?.content as string | null) ?? "").replace(/\s+/g, " ").trim();
    if (text) quoted = text.length > 60 ? `${text.slice(0, 60)}…` : text;
  }
  const head = `تفاعلت العميلة بـ ${emoji}`;
  return quoted ? `${head} على: «${quoted}»` : `${head} على رسالة`;
}

/**
 * What a swipe-reply was answering. Meta sends only the quoted message's id,
 * so the quote is resolved here and frozen on the row: a customer who answers
 * "هذا" to one of two offers is unreadable without it, and staff were
 * confirming the wrong option. A quote we never stored (sent before Kiara, or
 * from another device) keeps its id and renders as "رسالة سابقة".
 */
async function replyContext(
  conversationId: string,
  context: NonNullable<MetaMessage["context"]>,
): Promise<Record<string, unknown> | null> {
  const quotedId = context.id?.trim();
  if (!quotedId) return null;
  const { data } = await getAdminSupabaseClient()
    .from("messages")
    .select("id, role, content, message_type")
    .eq("conversation_id", conversationId)
    .eq("external_message_sid", quotedId)
    .maybeSingle();
  const text = ((data?.content as string | null) ?? "").trim();
  return {
    external_id: quotedId,
    message_id: (data?.id as string | undefined) ?? null,
    role: (data?.role as string | undefined) ?? null,
    message_type: (data?.message_type as string | undefined) ?? null,
    text: text ? (text.length > 300 ? `${text.slice(0, 300)}…` : text) : null,
  };
}

function contactsText(contacts: NonNullable<MetaMessage["contacts"]>): string {
  const lines = contacts.map((contact) => {
    const name = contact.name?.formatted_name?.trim() || "بدون اسم";
    const phones = (contact.phones ?? [])
      .map((phone) => phone.phone?.trim() || (phone.wa_id ? `+${phone.wa_id}` : ""))
      .filter(Boolean);
    return phones.length ? `${name} — ${phones.join("، ")}` : name;
  });
  return `👤 جهة اتصال:\n${lines.join("\n")}`;
}

async function ingestMessage(value: MetaValue, message: MetaMessage): Promise<void> {
  const messageSid = message.id?.trim();
  const phone = e164(message.from);
  if (!messageSid || !phone || (await hasMessageWithSid(messageSid))) return;
  // Taking a reaction back is not something to post into the thread.
  if (message.type === "reaction" && !message.reaction?.emoji?.trim()) return;

  const contact = value.contacts?.find(
    (candidate) => e164(candidate.wa_id) === phone,
  );
  const conversation = await findOrCreateConversation(
    phone,
    contact?.profile?.name || null,
  );
  const kiaraNumber = e164(value.metadata?.display_phone_number);
  await rememberConversationTransport(conversation.id, "meta", kiaraNumber);

  const content = messageText(message);
  const metadata: Record<string, unknown> = {
    provider: "meta",
    meta_type: message.type || "unknown",
    ...(kiaraNumber ? { via: kiaraNumber } : {}),
  };
  if (message.button) metadata.button = message.button;
  if (message.interactive) metadata.interactive = message.interactive;
  if (message.location) metadata.location = message.location;
  if (message.reaction) metadata.reaction = message.reaction;
  if (message.contacts) metadata.contacts = message.contacts;
  // A reaction's context is its own target, already quoted in its text.
  if (message.context?.id && message.type !== "reaction") {
    const replyTo = await replyContext(conversation.id, message.context).catch(
      () => ({ external_id: message.context!.id, text: null }),
    );
    if (replyTo) metadata.reply_to = replyTo;
  }

  if (message.type === "unsupported" && message.errors?.length) {
    // Kept on the row, not just in the log. Meta's `errors[]` is the only
    // place that says *why* a message arrived with nothing in it, and runtime
    // logs roll off long before someone reports "my client sent a voice note
    // and I see an empty bubble" — which is exactly how this was found.
    metadata.meta_errors = message.errors.map((e) => ({
      code: e.code ?? null,
      title: e.title ?? null,
      message: e.message ?? null,
    }));
    console.warn(
      `[meta/webhook] message ${messageSid} unsupported: ` +
        message.errors.map((e) => `${e.code ?? ""} ${e.title || e.message || ""}`).join("; "),
    );
  }

  const media = await storeInboundMedia(message, conversation.id);
  if (media) metadata.media = [media];
  else if (message.type && MEDIA_TYPES.has(message.type)) {
    // Meta marked this message as carrying media, but none of the known
    // fields (image/video/audio/document/sticker) had an id to download —
    // otherwise storeInboundMedia would have returned a "failed" slot, not
    // null. Surface it loudly instead of silently rendering as if nothing
    // was ever attached, so a payload-shape drift shows up in logs the day
    // it happens rather than as a support screenshot weeks later.
    console.error(
      `[meta/webhook] message ${messageSid} declared type "${message.type}" but no matching media field was found`,
    );
    metadata.media_parse_failed = true;
  }
  const contentType = media?.content_type || "";
  const messageType = message.location
    ? "location"
    : message.audio?.voice
      ? "voice"
      : media
        ? messageTypeFromContentType(contentType)
        : message.type === "button" || message.type === "interactive"
          ? "text"
          : message.type === "unsupported"
            ? "text"
            : message.type || "text";
  // A call permission reply carries no text of its own, so without this it
  // would render as an empty bubble — the same failure the `unsupported`
  // branch above exists to prevent. `content` deliberately stays empty: it is
  // what the bot reads, and the customer did not write anything for it to
  // answer.
  const permissionReply = parseCallPermissionReply(message);
  const displayContent =
    content ||
    (message.type === "reaction" && message.reaction
      ? await reactionText(conversation.id, message.reaction)
      : null) ||
    (message.type === "contacts" && message.contacts?.length
      ? contactsText(message.contacts)
      : null) ||
    (permissionReply
      ? permissionReply.response === "accept"
        ? "✅ سمحت العميلة باستقبال مكالمة"
        : "🚫 رفضت العميلة استقبال مكالمة"
      : message.type === "unsupported"
        ? "⚠️ رسالة غير مدعومة من واتساب"
        : content);

  const createdAt = message.timestamp
    ? new Date(Number(message.timestamp) * 1000).toISOString()
    : undefined;
  const messageId = await saveMessage({
    conversationId: conversation.id,
    role: "customer",
    content: displayContent,
    messageType,
    externalMessageSid: messageSid,
    metadata,
    deliveryStatus: "received",
    createdAt,
  });
  if (!messageId) return;

  await bumpConversationActivity(conversation.id, { inbound: true });
  after(() => notifyInboundInboxMessage(conversation.id));
  // Deferred: the customer's answer is already stored as a message, and the
  // permission bookkeeping must never be able to fail the ingestion that
  // carries the spa's live inbox.
  if (permissionReply) {
    after(() =>
      applyCallPermissionReply(conversation.id, phone, permissionReply),
    );
  }
  if (content.trim() && inboxProvider() === "meta") {
    after(() =>
      runBotTurn({ conversationId: conversation.id, customerPhone: phone, body: content }),
    );
  }
}

async function ingestValue(value: MetaValue): Promise<void> {
  const configuredPhoneId = metaCloudConfig().phoneNumberId;
  if (
    configuredPhoneId &&
    value.metadata?.phone_number_id &&
    value.metadata.phone_number_id !== configuredPhoneId
  ) {
    console.warn("[meta/webhook] ignored event for a different phone number id");
    return;
  }

  for (const status of value.statuses ?? []) {
    const raw = status.status?.toLowerCase() || "";
    if (status.id && STATUS_MAP[raw]) {
      await updateDeliveryStatus(status.id, STATUS_MAP[raw]);
    }
    if (status.errors?.length) {
      console.warn(
        `[meta/webhook] delivery ${status.id || "unknown"} ${raw}: ` +
          status.errors.map((error) => `${error.code || ""} ${error.title || error.message || ""}`).join("; "),
      );
    }
  }
  for (const message of value.messages ?? []) await ingestMessage(value, message);
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const mode = searchParams.get("hub.mode");
  const verify = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");
  const configured = metaCloudConfig().verifyToken;
  if (mode === "subscribe" && configured && verify === configured && challenge) {
    return new NextResponse(challenge, { status: 200 });
  }
  return NextResponse.json({ error: "Verification failed" }, { status: 403 });
}

export async function POST(request: NextRequest) {
  const secret = metaCloudConfig().appSecret;
  if (!secret) {
    console.error("[meta/webhook] META_APP_SECRET is not configured");
    return NextResponse.json({ error: "Not configured" }, { status: 500 });
  }
  const rawBody = await request.text();
  if (!validSignature(rawBody, request.headers.get("x-hub-signature-256"), secret)) {
    return NextResponse.json({ error: "Bad signature" }, { status: 403 });
  }

  let payload: WebhookPayload;
  try {
    payload = JSON.parse(rawBody) as WebhookPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (payload.object !== "whatsapp_business_account") {
    return NextResponse.json({ ok: true, ignored: payload.object || "unknown" });
  }

  // The app and webhook can be prepared before cutover without duplicating
  // Twilio's inbound messages. Only the environment flag opens ingestion.
  //
  // Scoped to messages rather than to the whole request, which is what it used
  // to guard. Calling exists only on the Business Platform — there is no
  // Twilio path for it to duplicate — so gating calls on the *messaging*
  // provider switch would silently drop live call signalling the day anyone
  // flipped that flag, and a dropped SDP answer is a call that never connects.
  const messagesEnabled = customerProvider() === "meta";

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field === "messages" && change.value && messagesEnabled) {
        await ingestValue(change.value);
      } else if (change.field === "calls" && change.value) {
        // A sibling branch, never a step inside message ingestion: a call
        // event must not be able to touch the path that carries the spa's
        // customer inbox, and ingestCalls swallows its own per-entry errors.
        await ingestCalls(change.value as { calls?: unknown[]; statuses?: unknown[] });
      }
    }
  }
  return NextResponse.json({ ok: true });
}
