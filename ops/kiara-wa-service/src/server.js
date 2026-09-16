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
import fs from "node:fs/promises";
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
      const customerPhone = digitsFromJid(msg.key.senderPn) || digitsFromJid(peerJid);
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
        messageType: mediaEntry?.[0] || "text",
        body: bodyFromMessage(message),
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

function mediaContent(media) {
  const bytes = Buffer.from(media.base64 || "", "base64");
  if (!bytes.length || bytes.length > config.maxMediaBytes) throw Object.assign(new Error("invalid media"), { status: 400 });
  const type = String(media.contentType || "application/octet-stream");
  const caption = media.caption || "";
  if (type.startsWith("image/")) return { image: bytes, mimetype: type, caption };
  if (type.startsWith("video/")) return { video: bytes, mimetype: type, caption };
  if (type.startsWith("audio/")) return { audio: bytes, mimetype: type, ptt: Boolean(media.ptt) };
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
    const content = req.body?.media ? mediaContent(req.body.media) : { text: String(req.body?.body || "") };
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
app.post("/lids/seed", (_req, res) => res.json({ ok: true }));

app.listen(config.port, config.host, () => logger.info({ host: config.host, port: config.port }, "Kiara WhatsApp gateway listening"));
void startSocket();

