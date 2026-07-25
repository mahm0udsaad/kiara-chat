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
