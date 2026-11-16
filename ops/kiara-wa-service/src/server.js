import "dotenv/config";
import express from "express";
import QRCode from "qrcode";
import pino from "pino";
import {
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  getContentType,
  jidNormalizedUser,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";
import makeWASocket from "@whiskeysockets/baileys";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const config = {
  host: process.env.HOST || "127.0.0.1",
  port: Number(process.env.PORT || 2787),
  clientId: process.env.WA_CLIENT_ID || "kiara",
  sendToken: process.env.SEND_TOKEN || "",
  ingestToken: process.env.INGEST_TOKEN || "",
  ingestUrl: process.env.INGEST_URL || "",
  sessionsDir: process.env.SESSIONS_DIR || path.resolve(".sessions"),
  maxMediaBytes: Number(process.env.MAX_MEDIA_BYTES || 20 * 1024 * 1024),
};

if (!config.sendToken) throw new Error("SEND_TOKEN is required");

const logger = pino({ level: process.env.LOG_LEVEL || "info" });
const authDir = path.join(config.sessionsDir, `baileys-${config.clientId}`);
let socket = null;
let state = "initializing";
let number = null;
let pushname = null;
let qr = null;
let qrDataUrl = null;
let qrUpdatedAt = null;
let lastReadyAt = null;
let reconnectAttempts = 0;
let restartTimer = null;
let generation = 0;
const qrMaxAgeMs = 55_000;

function digitsFromJid(jid) {
  const normalized = jid ? jidNormalizedUser(jid) : "";
  const match = normalized.match(/^(\d+)(?::\d+)?@s\.whatsapp\.net$/);
  return match?.[1] || null;
}

function unwrapMessage(message) {
  let current = message;
  while (current?.ephemeralMessage?.message || current?.viewOnceMessage?.message || current?.viewOnceMessageV2?.message || current?.documentWithCaptionMessage?.message) {
    current = current.ephemeralMessage?.message
      || current.viewOnceMessage?.message
      || current.viewOnceMessageV2?.message
      || current.documentWithCaptionMessage?.message;
  }
  return current || {};
}

function bodyFromMessage(message) {
  const m = unwrapMessage(message);
  return m.conversation
    || m.extendedTextMessage?.text
    || m.imageMessage?.caption
    || m.videoMessage?.caption
    || m.documentMessage?.caption
    || m.buttonsResponseMessage?.selectedDisplayText
    || m.listResponseMessage?.title
    || m.templateButtonReplyMessage?.selectedDisplayText
    || "";
}

/**
 * Message kinds that carry no text and no media of their own. Without this
 * they reached Kiara as an empty "text" and showed as «رسالة بدون نص».
 * Returns null for ordinary messages, `{ skip: true }` for ones that are not
 * worth a bubble, or the readable body and type to forward instead.
 */
function describeSpecial(message, contentType) {
  const m = unwrapMessage(message);
  if (contentType === "reactionMessage") {
    const emoji = m.reactionMessage?.text?.trim();
    // Taking a reaction back is not a message.
    if (!emoji) return { skip: true };
    return { messageType: "reaction", body: `تفاعل بـ ${emoji}`, reactionTo: m.reactionMessage?.key?.id || null };
  }
  if (contentType === "locationMessage" || contentType === "liveLocationMessage") {
    const loc = m.locationMessage || m.liveLocationMessage || {};
    const lat = loc.degreesLatitude;
    const lng = loc.degreesLongitude;
    const label = [loc.name, loc.address].filter(Boolean).join(" — ");
    const link = Number.isFinite(lat) && Number.isFinite(lng) ? `https://maps.google.com/?q=${lat},${lng}` : "";
    const head = contentType === "liveLocationMessage" ? "📍 موقع مباشر" : "📍 الموقع";
    return {
      messageType: "location",
      body: [label ? `${head}: ${label}` : head, link].filter(Boolean).join("\n"),
      location: Number.isFinite(lat) && Number.isFinite(lng) ? { latitude: lat, longitude: lng, name: loc.name || null, address: loc.address || null } : null,
    };
  }
  if (contentType === "contactMessage" || contentType === "contactsArrayMessage") {
    const cards = contentType === "contactMessage" ? [m.contactMessage] : (m.contactsArrayMessage?.contacts || []);
    const lines = cards.filter(Boolean).map((card) => {
      const phones = [...String(card.vcard || "").matchAll(/TEL[^:]*:([+\d\s-]+)/g)].map((match) => match[1].trim()).filter(Boolean);
      const name = card.displayName?.trim() || "بدون اسم";
      return phones.length ? `${name} — ${phones.join("، ")}` : name;
    });
    return { messageType: "contacts", body: `👤 جهة اتصال:\n${lines.join("\n")}` };
  }
  if (contentType === "pollCreationMessage" || contentType === "pollCreationMessageV2" || contentType === "pollCreationMessageV3") {
    const poll = m.pollCreationMessage || m.pollCreationMessageV2 || m.pollCreationMessageV3 || {};
    const options = (poll.options || []).map((option) => `• ${option.optionName}`).join("\n");
    return { messageType: "text", body: [`📊 استطلاع: ${poll.name || ""}`.trim(), options].filter(Boolean).join("\n") };
  }
  // Bookkeeping WhatsApp sends alongside real messages: an album header before
  // its photos (which arrive on their own), votes, pins, keep-in-chat flags.
  if (["albumMessage", "pollUpdateMessage", "pinInChatMessage", "keepInChatMessage", "senderKeyDistributionMessage", "messageContextInfo"].includes(contentType)) {
    return { skip: true };
  }
  return null;
}

/**
 * The phone behind a chat. WhatsApp increasingly addresses chats by an
 * anonymized lid; Baileys 7 carries the phone in `remoteJidAlt` /
 * `participantAlt` (the old `senderPn` is kept for older sessions) and keeps a
 * lid→phone table of its own. Without the phone Kiara cannot place a message
 * in a thread it has not seen this lid on before, and drops it.
 */
async function phoneForMessage(sock, key, group, peerJid) {
  const direct = digitsFromJid(key.senderPn)
    || digitsFromJid(group ? key.participantAlt : key.remoteJidAlt)
    || digitsFromJid(peerJid);
  if (direct) return direct;
  if (!peerJid?.endsWith("@lid")) return null;
  try {
    return digitsFromJid(await sock.signalRepository?.lidMapping?.getPNForLID(peerJid));
  } catch (error) {
    logger.warn({ err: error, lid: peerJid }, "lid lookup failed");
    return null;
  }
}

function mediaNode(message) {
  const m = unwrapMessage(message);
  const entries = [
    ["image", m.imageMessage],
    ["video", m.videoMessage],
    ["audio", m.audioMessage],
    ["document", m.documentMessage],
    ["sticker", m.stickerMessage],
  ];
  return entries.find(([, value]) => value) || null;
}

async function postIngest(event) {
  if (!config.ingestUrl || !config.ingestToken) return;
  try {
    const response = await fetch(config.ingestUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.ingestToken}`,
      },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) logger.warn({ status: response.status, body: await response.text() }, "ingest rejected event");
  } catch (error) {
    logger.warn({ err: error }, "failed to deliver ingest event");
  }
}

function scheduleRestart(delay = Math.min(60_000, 3_000 * 2 ** Math.min(reconnectAttempts, 5))) {
  if (restartTimer) return;
  reconnectAttempts += 1;
  restartTimer = setTimeout(() => {
    restartTimer = null;
    void startSocket();
  }, delay);
}

async function archiveInvalidAuth() {
  try {
    await fs.access(authDir);
    await fs.rename(authDir, `${authDir}.invalid-${Date.now()}`);
  } catch (error) {
    if (error?.code !== "ENOENT") logger.warn({ err: error }, "could not archive invalid auth");
  }
}

async function startSocket() {
  const currentGeneration = ++generation;
  try {
    socket?.end?.(new Error("restarting"));
  } catch {}
  socket = null;
  state = "initializing";
  qr = null;
  qrDataUrl = null;
  qrUpdatedAt = null;

  await fs.mkdir(authDir, { recursive: true });
  const { state: authState, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({
    version,
    auth: {
      creds: authState.creds,
      keys: makeCacheableSignalKeyStore(authState.keys, logger),
    },
    logger,
    browser: ["Kiara Chat", "Chrome", "1.0.0"],
    markOnlineOnConnect: false,
    syncFullHistory: true,
    generateHighQualityLinkPreview: false,
  });
  socket = sock;

  sock.ev.on("creds.update", saveCreds);
  sock.ev.on("connection.update", async (update) => {
    if (currentGeneration !== generation) return;
    if (update.qr) {
      state = "awaiting_qr";
      qr = update.qr;
      qrDataUrl = await QRCode.toDataURL(update.qr, { margin: 1, width: 360 });
      qrUpdatedAt = Date.now();
      number = null;
      pushname = null;
    }
    if (update.connection === "open") {
      state = "ready";
      reconnectAttempts = 0;
      qr = null;
      qrDataUrl = null;
      qrUpdatedAt = null;
      number = digitsFromJid(sock.user?.id);
      pushname = sock.user?.name || null;
      lastReadyAt = Date.now();
      logger.info({ number }, "WhatsApp ready");
    }
    if (update.connection === "close") {
      const code = update.lastDisconnect?.error?.output?.statusCode
        || update.lastDisconnect?.error?.statusCode
        || update.lastDisconnect?.error?.data?.statusCode;
      logger.warn({ code }, "WhatsApp connection closed");
      socket = null;
      state = "disconnected";
      if (code === DisconnectReason.loggedOut || code === 401 || code === 403) {
        number = null;
        pushname = null;
        await archiveInvalidAuth();
        scheduleRestart(2_000);
      } else {
        scheduleRestart();
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages }) => {
    for (const msg of messages || []) {
      const remoteJid = msg.key?.remoteJid;
      const message = unwrapMessage(msg.message);
      const contentType = getContentType(message);
      if (!remoteJid || !msg.key?.id || !contentType || contentType === "protocolMessage" || remoteJid === "status@broadcast") continue;

      const group = remoteJid.endsWith("@g.us");
      const fromMe = Boolean(msg.key.fromMe);
      const participantJid = msg.key.participant || msg.key.senderPn || null;
      const peerJid = group ? participantJid : remoteJid;
      const special = describeSpecial(msg.message, contentType);
      if (special?.skip) continue;
      const customerPhone = await phoneForMessage(sock, msg.key, group, peerJid);
      const chatLid = remoteJid.endsWith("@lid") ? remoteJid : null;
      let groupSubject = null;
      if (group) {
        try { groupSubject = (await sock.groupMetadata(remoteJid)).subject || null; } catch {}
      }

      const media = [];
      const mediaEntry = mediaNode(message);
      if (mediaEntry) {
        try {
          const [, node] = mediaEntry;
          const buffer = await downloadMediaMessage(msg, "buffer", {}, { logger, reuploadRequest: sock.updateMediaMessage });
          if (buffer.length <= config.maxMediaBytes) {
            media.push({
              base64: buffer.toString("base64"),
              contentType: node.mimetype || "application/octet-stream",
              filename: node.fileName || null,
            });
          }
        } catch (error) {
          logger.warn({ err: error, id: msg.key.id }, "media download failed");
        }
      }

      await postIngest({
        type: "message",
        waMessageId: msg.key.id,
        fromMe,
        customerPhone,
        customerName: fromMe ? null : (msg.pushName || null),
        chatLid,
        chatJid: remoteJid,
        groupSubject,
        participantName: fromMe ? null : (msg.pushName || null),
        messageType: special?.messageType || mediaEntry?.[0] || "text",
        body: special?.body ?? bodyFromMessage(message),
        reactionTo: special?.reactionTo || null,
        location: special?.location || null,
        timestamp: Number(msg.messageTimestamp || Math.floor(Date.now() / 1000)),
        media,
      });
    }
  });

  sock.ev.on("messages.update", async (updates) => {
    const statuses = { 2: "sent", 3: "delivered", 4: "read" };
    for (const item of updates || []) {
      const status = statuses[item.update?.status];
      if (item.key?.id && status) await postIngest({ type: "ack", waMessageId: item.key.id, status });
    }
  });

  sock.ev.on("presence.update", async ({ id, presences }) => {
    for (const [jid, presence] of Object.entries(presences || {})) {
      const value = presence?.lastKnownPresence;
      if (!value) continue;
      await postIngest({
        type: "presence",
        customerPhone: digitsFromJid(jid) || digitsFromJid(id),
        chatLid: id?.endsWith("@lid") ? id : null,
        state: value,
      });
    }
  });
}

async function forceNewQr() {
  if (state === "ready") throw Object.assign(new Error("already linked"), { status: 409 });
  generation += 1;
  try { socket?.end?.(new Error("fresh QR requested")); } catch {}
  socket = null;
  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = null;
  try {
    await fs.access(authDir);
    await fs.rename(authDir, `${authDir}.refresh-${Date.now()}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await startSocket();
}

function requireAuth(req, res, next) {
  if (req.get("authorization") !== `Bearer ${config.sendToken}`) return res.status(401).json({ error: "Unauthorized" });
  next();
}

function waJid(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) throw Object.assign(new Error("invalid recipient"), { status: 400 });
  return `${digits}@s.whatsapp.net`;
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    execFile(
      "ffmpeg",
      ["-hide_banner", "-loglevel", "error", "-y", ...args],
      { timeout: 30_000, encoding: "buffer", maxBuffer: 64 * 1024 * 1024 },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
  });
}

/**
 * WhatsApp only plays a voice note that is Opus in an Ogg container. The app
 * records AAC in MP4 and Chrome records WebM, so those are re-encoded.
 *
 * `native` copies what the WhatsApp app itself writes (16 kHz voip Opus,
 * 120 ms frames, no tags) and sends a waveform and duration with it, as the
 * phone does. Plain 48 kHz Opus with no waveform (`legacy`, used 2026-10-12 to
 * 2026-10-24) was accepted by WhatsApp but specialists could not play it.
 */
const VOICE_ENCODINGS = {
  native: [
    "-map_metadata", "-1", "-vn", "-ac", "1", "-ar", "16000",
    "-c:a", "libopus", "-application", "voip", "-b:a", "24k", "-frame_duration", "120",
    "-avoid_negative_ts", "make_zero",
  ],
  legacy: [
    "-vn", "-c:a", "libopus", "-b:a", "32k", "-ac", "1", "-ar", "48000",
    "-avoid_negative_ts", "make_zero",
  ],
};

/** Test-only switch (`media.voiceVariant`); the app never sends one, so it gets `native`. */
const VOICE_VARIANTS = {
  native: { encoding: "native", waveform: true },
  legacy: { encoding: "legacy", waveform: false },
  "legacy-waveform": { encoding: "legacy", waveform: true },
};

/** Duration and the 64-bar waveform WhatsApp draws on a voice bubble (0–100 each). */
async function voiceShape(file) {
  // 8 kHz mono PCM is plenty for 64 bars and a whole-second duration.
  const pcm = await runFfmpeg(["-i", file, "-ac", "1", "-ar", "8000", "-f", "s16le", "-"]);
  const samples = Math.floor(pcm.length / 2);
  if (!samples) throw new Error("no audio samples");
  const bars = 64;
  const block = Math.max(1, Math.floor(samples / bars));
  const levels = [];
  for (let i = 0; i < bars; i++) {
    let sum = 0;
    let count = 0;
    for (let j = i * block; j < Math.min(samples, (i + 1) * block); j++) {
      sum += Math.abs(pcm.readInt16LE(j * 2));
      count++;
    }
    levels.push(count ? sum / count : 0);
  }
  const peak = Math.max(...levels) || 1;
  return {
    seconds: Math.max(1, Math.round(samples / 8000)),
    waveform: new Uint8Array(levels.map((level) => Math.round((level / peak) * 100))),
  };
}

async function toVoiceNote(bytes, { encoding, waveform, reencode }) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kiara-voice-"));
  const input = path.join(dir, "in");
  const output = path.join(dir, "out.ogg");
  try {
    await fs.writeFile(input, bytes);
    let audio = bytes;
    let file = input;
    if (reencode) {
      await runFfmpeg(["-i", input, ...VOICE_ENCODINGS[encoding], "-f", "ogg", output]);
      audio = await fs.readFile(output);
      file = output;
      if (!audio.length) throw new Error("ffmpeg produced an empty file");
    }
    // A missing waveform still leaves a playable note; Baileys then works out the duration.
    const shape = waveform
      ? await voiceShape(file).catch((error) => {
          logger.warn({ err: error }, "voice note waveform failed");
          return null;
        })
      : null;
    return { audio, seconds: shape?.seconds, waveform: shape?.waveform };
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function mediaContent(media) {
  const bytes = Buffer.from(media.base64 || "", "base64");
  if (!bytes.length || bytes.length > config.maxMediaBytes) throw Object.assign(new Error("invalid media"), { status: 400 });
  const type = String(media.contentType || "application/octet-stream");
  const caption = media.caption || "";
  if (type.startsWith("image/")) return { image: bytes, mimetype: type, caption };
  if (type.startsWith("video/")) return { video: bytes, mimetype: type, caption };
  if (type.startsWith("audio/")) {
    if (!media.ptt) return { audio: bytes, mimetype: type, ptt: false };
    const isOgg = /^audio\/(ogg|opus)/i.test(type);
    const variantName = VOICE_VARIANTS[media.voiceVariant] ? media.voiceVariant : "native";
    try {
      const note = await toVoiceNote(bytes, { ...VOICE_VARIANTS[variantName], reencode: !isOgg });
      logger.info(
        { variant: variantName, from: type, bytes: note.audio.length, seconds: note.seconds ?? null, waveform: Boolean(note.waveform) },
        "voice note prepared",
      );
      return {
        audio: note.audio,
        mimetype: isOgg ? type : "audio/ogg; codecs=opus",
        ptt: true,
        ...(note.seconds ? { seconds: note.seconds } : {}),
        ...(note.waveform ? { waveform: note.waveform } : {}),
      };
    } catch (error) {
      if (isOgg) return { audio: bytes, mimetype: type, ptt: true };
      // A plain audio file she can play beats a voice bubble that never opens.
      logger.warn({ err: error, type }, "voice note conversion failed; sending as an audio file");
      return { audio: bytes, mimetype: type, ptt: false };
    }
  }
  return { document: bytes, mimetype: type, fileName: media.filename || "file", caption };
}

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "28mb" }));
app.get("/health", (_req, res) => res.json({ ok: true, state }));
app.use(requireAuth);
app.get("/status", (_req, res) => res.json({ state, number, pushname, qrUpdatedAt, qrMaxAgeMs, lastReadyAt, reconnectAttempts }));
app.get("/qr", (_req, res) => res.json({ state, qr, qrDataUrl, qrUpdatedAt, qrMaxAgeMs }));
app.post("/qr/refresh", async (_req, res) => {
  try { await forceNewQr(); res.json({ ok: true }); }
  catch (error) { res.status(error.status || 500).json({ error: error.message || "refresh failed" }); }
});
app.post("/messages", async (req, res) => {
  try {
    if (state !== "ready" || !socket) throw Object.assign(new Error("WhatsApp is not connected"), { status: 503 });
    const content = req.body?.media ? await mediaContent(req.body.media) : { text: String(req.body?.body || "") };
    if (!req.body?.media && !content.text.trim()) throw Object.assign(new Error("message body is required"), { status: 400 });
    const sent = await socket.sendMessage(waJid(req.body?.to), content);
    res.json({ waMessageId: sent.key.id });
  } catch (error) {
    logger.warn({ err: error }, "message send failed");
    res.status(error.status || 500).json({ error: error.message || "send failed" });
  }
});
app.post("/presence/watch", async (req, res) => {
  if (state !== "ready" || !socket) return res.status(503).json({ error: "WhatsApp is not connected" });
  const phones = Array.isArray(req.body?.phones) ? req.body.phones : [];
  await Promise.allSettled(phones.slice(0, 250).map((phone) => socket.presenceSubscribe(waJid(phone))));
  res.json({ ok: true, watched: phones.length });
});
/**
 * Learn the lid of each phone Kiara cares about (its drivers and specialists)
 * before their first lid-addressed message arrives, so that message carries a
 * phone and lands in the right thread. Baileys answers from its own table and
 * only asks WhatsApp about phones it has not mapped yet.
 */
app.post("/lids/seed", async (req, res) => {
  if (state !== "ready" || !socket) return res.status(503).json({ error: "WhatsApp is not connected" });
  const phones = (Array.isArray(req.body?.phones) ? req.body.phones : []).slice(0, 250);
  try {
    const jids = phones.map((phone) => waJid(phone));
    const mappings = jids.length ? await socket.signalRepository?.lidMapping?.getLIDsForPNs(jids) : [];
    res.json({ ok: true, asked: jids.length, mapped: mappings?.length || 0 });
  } catch (error) {
    logger.warn({ err: error }, "lid seed failed");
    res.status(error.status || 500).json({ error: error.message || "lid seed failed" });
  }
});

app.listen(config.port, config.host, () => logger.info({ host: config.host, port: config.port }, "Kiara WhatsApp gateway listening"));
void startSocket();

