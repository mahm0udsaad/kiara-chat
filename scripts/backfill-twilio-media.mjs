/**
 * Recover inbound media the Twilio webhook failed to store.
 *
 * A message whose media slot reads `delivery_status: "failed"` with a null
 * `size_bytes` never got its bytes: the fetch from Twilio failed (usually a
 * 404 in the moment right after the webhook fires, before the media is
 * readable) and the single-shot fetch in `storeMediaFromUrl` gave up. The
 * inbox then shows "تعذّر تخزين الملف" where a customer's transfer receipt
 * should be.
 *
 * Twilio keeps inbound media until the account deletes it, so those files are
 * still there. The media list for a message is addressable from its sid alone
 * — `/Messages/{MessageSid}/Media` — which is what makes rows written before
 * `source_url` existed recoverable too.
 *
 * Idempotent: a slot that already has a `storage_path` is skipped, so a second
 * run reports zero changes.
 *
 *   node --env-file=.env.local scripts/backfill-twilio-media.mjs
 *   node --env-file=.env.local scripts/backfill-twilio-media.mjs --apply
 */
import { randomUUID } from "node:crypto";

const KIARA_RESTAURANT_ID = "2ba8f6c8-aff9-4147-8f13-cdcb732de698";
const BUCKET = "whatsapp-media";
const PAGE = 500;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const twilioSid = process.env.TWILIO_ACCOUNT_SID;
const twilioToken = process.env.TWILIO_AUTH_TOKEN;
const apply = process.argv.includes("--apply");

if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  process.exit(1);
}
if (!twilioSid || !twilioToken) {
  console.error("TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are required (pull them from Vercel).");
  process.exit(1);
}

const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
};
const twilioAuth = `Basic ${Buffer.from(`${twilioSid}:${twilioToken}`).toString("base64")}`;

const CONTENT_TYPE_TO_EXT = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/heic": "heic",
  "audio/ogg": "ogg",
  "audio/opus": "opus",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/amr": "amr",
  "audio/wav": "wav",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "text/csv": "csv",
  "text/vcard": "vcf",
};

function buildPath(conversationId, contentType, createdAt) {
  const at = new Date(createdAt);
  const yyyy = at.getUTCFullYear().toString();
  const mm = String(at.getUTCMonth() + 1).padStart(2, "0");
  const ct = (contentType || "").toLowerCase().split(";")[0].trim();
  const ext = CONTENT_TYPE_TO_EXT[ct] || "bin";
  const id = `${Date.now().toString(36)}${randomUUID().replace(/-/g, "").slice(0, 18)}`;
  return `${KIARA_RESTAURANT_ID}/${conversationId}/${yyyy}/${mm}/${id}.${ext}`;
}

/** Every media message, paged; the failed ones are a rounding error among them. */
async function loadCandidates() {
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const q = new URL(`${url}/rest/v1/messages`);
    q.searchParams.set("select", "id,created_at,conversation_id,metadata,external_message_sid,twilio_message_sid");
    q.searchParams.set("message_type", "in.(image,video,audio,voice,document,file)");
    q.searchParams.set("order", "created_at.asc");
    q.searchParams.set("limit", String(PAGE));
    q.searchParams.set("offset", String(offset));
    const res = await fetch(q, { headers });
    if (!res.ok) throw new Error(`messages ${res.status}: ${await res.text()}`);
    const page = await res.json();
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return rows.filter((m) =>
    (m.metadata?.media ?? []).some((s) => !s.storage_path && s.delivery_status === "failed"),
  );
}

/** Twilio's media list for one message, in the order the customer sent it. */
async function twilioMediaList(messageSid) {
  const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages/${messageSid}/Media.json?PageSize=50`;
  const res = await fetch(endpoint, { headers: { Authorization: twilioAuth } });
  if (!res.ok) throw new Error(`media list ${res.status}`);
  const body = await res.json();
  return (body.media_list ?? []).map((m) => ({
    contentType: m.content_type,
    url: `https://api.twilio.com${m.uri.replace(/\.json$/, "")}`,
  }));
}

async function upload(path, buffer, contentType) {
  const res = await fetch(`${url}/storage/v1/object/${BUCKET}/${path}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": contentType || "application/octet-stream",
      "Cache-Control": "3600",
    },
    body: buffer,
  });
  if (!res.ok) throw new Error(`storage ${res.status}: ${await res.text()}`);
}

async function patchMetadata(id, metadata) {
  const res = await fetch(`${url}/rest/v1/messages?id=eq.${id}`, {
    method: "PATCH",
    headers: { ...headers, Prefer: "return=minimal" },
    body: JSON.stringify({ metadata }),
  });
  if (!res.ok) throw new Error(`patch ${res.status}: ${await res.text()}`);
}

const candidates = await loadCandidates();
console.log(`${candidates.length} message(s) with unstored media${apply ? "" : " (dry run)"}`);

let repaired = 0;
let stillGone = 0;

for (const message of candidates) {
  const sid = message.twilio_message_sid ?? message.external_message_sid;
  const slots = message.metadata.media;
  if (!sid?.startsWith("MM") && !sid?.startsWith("SM")) {
    console.log(`- ${message.created_at} no Twilio sid, skipping`);
    stillGone += 1;
    continue;
  }

  let list;
  try {
    list = await twilioMediaList(sid);
  } catch (err) {
    console.log(`- ${message.created_at} ${sid}: ${err.message}`);
    stillGone += 1;
    continue;
  }

  const next = [...slots];
  let changed = false;

  for (let i = 0; i < next.length; i += 1) {
    const slot = next[i];
    if (slot.storage_path || slot.delivery_status !== "failed") continue;
    const source = slot.source_url ? { url: slot.source_url, contentType: slot.content_type } : list[i];
    if (!source) {
      console.log(`- ${message.created_at} ${sid}: slot ${i} not on Twilio any more`);
      continue;
    }
    try {
      const res = await fetch(source.url, { headers: { Authorization: twilioAuth } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      const path = buildPath(message.conversation_id, slot.content_type, message.created_at);
      if (apply) await upload(path, buffer, slot.content_type);
      next[i] = {
        ...slot,
        storage_path: path,
        size_bytes: buffer.byteLength,
        delivery_status: "stored",
        source_url: null,
        fetch_error: null,
      };
      changed = true;
      console.log(`+ ${message.created_at} ${slot.content_type} ${buffer.byteLength}B`);
    } catch (err) {
      console.log(`- ${message.created_at} ${sid}: slot ${i} ${err.message}`);
    }
  }

  if (!changed) {
    stillGone += 1;
    continue;
  }
  if (apply) await patchMetadata(message.id, { ...message.metadata, media: next });
  repaired += 1;
}

console.log(
  `${apply ? "repaired" : "would repair"} ${repaired} message(s); ${stillGone} unrecoverable.`,
);
