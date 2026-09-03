import type { MessageTransport, SendResult } from "./types";

/**
 * OpenWA transport — HTTP client to the persistent OpenWA service (VPS) that
 * holds Kiara's linked number. The send token never leaves the server.
 */
const BASE = process.env.OPENWA_URL;
const TOKEN = process.env.OPENWA_SEND_TOKEN;

export function isOpenWaConfigured(): boolean {
  return Boolean(BASE && TOKEN);
}

/**
 * Every call to the engine is bounded.
 *
 * The engine runs on a VPS that can be reachable at the TCP level while far too
 * busy to answer — the worst shape of failure, because a bare `fetch` then waits
 * far longer than any caller intended. That wait is not confined to WhatsApp
 * features: dispatching an order awaits a notification send, so an engine that
 * is merely unwell would hang the order screen and burn the whole function
 * budget before returning nothing useful.
 *
 * A fast, explicit failure lets each caller decide what to do without one — and
 * every caller here already has that branch.
 */
const ENGINE_TIMEOUT_MS = 8_000;

/** A send crosses to WhatsApp itself, so it gets more room than a status poll. */
const ENGINE_SEND_TIMEOUT_MS = 15_000;

async function engineFetch(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
  } catch (cause) {
    throw new Error(
      controller.signal.aborted
        ? `OpenWA engine did not respond within ${timeoutMs}ms`
        : "OpenWA engine unreachable",
      { cause },
    );
  } finally {
    clearTimeout(timer);
  }
}

async function post(
  path: string,
  body: unknown,
  timeoutMs = ENGINE_TIMEOUT_MS,
): Promise<Response> {
  if (!BASE || !TOKEN) {
    throw new Error("OpenWA not configured: set OPENWA_URL and OPENWA_SEND_TOKEN");
  }
  return engineFetch(
    `${BASE.replace(/\/+$/, "")}${path}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify(body),
    },
    timeoutMs,
  );
}

async function parse(res: Response): Promise<SendResult> {
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`OpenWA send failed (${res.status}): ${detail}`);
  }
  const data = await res.json();
  return { providerMessageId: data.waMessageId ?? data.id ?? "" };
}

export const openWaTransport: MessageTransport = {
  provider: "openwa",
  async sendText(toE164, body) {
    return parse(
      await post("/messages", { to: toE164, body }, ENGINE_SEND_TIMEOUT_MS),
    );
  },
  async sendMedia(toE164, media) {
    // `storagePath` is Twilio's way in; a linked device takes the bytes.
    const blob = {
      base64: media.base64,
      contentType: media.contentType,
      filename: media.filename,
      caption: media.caption,
      ptt: media.ptt,
    };
    return parse(
      await post("/messages", { to: toE164, media: blob }, ENGINE_SEND_TIMEOUT_MS),
    );
  },
  /**
   * A linked device has no notion of an approved template — it is a phone, and
   * a phone can say anything to anyone. Callers on this transport send the text
   * directly; only the Business Platform needs a content sid, so reaching here
   * means a caller resolved the wrong transport rather than that a send failed.
   */
  async sendTemplate() {
    throw new Error("TEMPLATES_NOT_SUPPORTED: OpenWA sends free-form text");
  },
};

export interface EngineState {
  configured: boolean;
  state: string; // not_configured | unreachable | awaiting_qr | authenticated | ready | disconnected | error | initializing
  number: string | null;
  qrDataUrl: string | null;
  /** When the engine minted the current QR (epoch ms), for the expiry countdown. */
  qrUpdatedAt: number | null;
  /** How long the engine considers a QR usable before cycling it (ms). */
  qrMaxAgeMs: number | null;
}

/** Poll the engine for its connection state + QR (for the Connect page). */
export async function getEngineState(): Promise<EngineState> {
  if (!BASE || !TOKEN) {
    return {
      configured: false,
      state: "not_configured",
      number: null,
      qrDataUrl: null,
      qrUpdatedAt: null,
      qrMaxAgeMs: null,
    };
  }
  const base = BASE.replace(/\/+$/, "");
  const headers = { Authorization: `Bearer ${TOKEN}` };
  try {
    const [statusRes, qrRes] = await Promise.all([
      engineFetch(`${base}/status`, { headers }, ENGINE_TIMEOUT_MS),
      engineFetch(`${base}/qr`, { headers }, ENGINE_TIMEOUT_MS),
    ]);
    const status = statusRes.ok ? await statusRes.json() : {};
    const qr = qrRes.ok ? await qrRes.json() : {};
    return {
      configured: true,
      state: status.state ?? qr.state ?? "unknown",
      number: status.number ?? null,
      qrDataUrl: qr.qrDataUrl ?? null,
      qrUpdatedAt: qr.qrUpdatedAt ?? null,
      qrMaxAgeMs: qr.qrMaxAgeMs ?? null,
    };
  } catch {
    return {
      configured: true,
      state: "unreachable",
      number: null,
      qrDataUrl: null,
      qrUpdatedAt: null,
      qrMaxAgeMs: null,
    };
  }
}

/**
 * Ask the engine to mint a brand-new QR. Needed because whatsapp-web.js cannot
 * refresh one in place against current WhatsApp Web builds, so a displayed code
 * silently dies after ~60s.
 */
export async function refreshEngineQr(): Promise<void> {
  const res = await post("/qr/refresh", {});
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`QR refresh failed (${res.status}): ${detail}`);
  }
}

/**
 * Ask the engine to watch these chats for typing indicators. WhatsApp only
 * pushes presence for subscribed chats, and the subscriptions die with the
 * socket — so the inbox re-sends its list rather than assuming they stuck.
 */
export async function watchPresence(phones: string[]): Promise<void> {
  if (!phones.length) return;
  const res = await post("/presence/watch", { phones });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`presence watch failed (${res.status}): ${detail}`);
  }
}
