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

async function post(path: string, body: unknown): Promise<Response> {
  if (!BASE || !TOKEN) {
    throw new Error("OpenWA not configured: set OPENWA_URL and OPENWA_SEND_TOKEN");
  }
  return fetch(`${BASE.replace(/\/+$/, "")}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
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
  async sendText(toE164, body) {
    return parse(await post("/messages", { to: toE164, body }));
  },
  async sendMedia(toE164, media) {
    return parse(await post("/messages", { to: toE164, media }));
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
      fetch(`${base}/status`, { headers, cache: "no-store" }),
      fetch(`${base}/qr`, { headers, cache: "no-store" }),
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
