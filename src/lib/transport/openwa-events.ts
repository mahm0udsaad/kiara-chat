import type { OpenWaEvent } from "./types";

const PRESENCE = new Set(["unavailable", "available", "composing", "recording", "paused"]);
const ACKS = new Set(["sent", "delivered", "read", "failed"]);

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function optionalString(value: unknown): boolean {
  return value == null || typeof value === "string";
}

/** Validate the authenticated engine payload before touching conversation data. */
export function isOpenWaEvent(value: unknown): value is OpenWaEvent {
  if (!record(value)) return false;
  if (value.type === "ack") {
    return typeof value.waMessageId === "string" && !!value.waMessageId.trim()
      && typeof value.status === "string" && ACKS.has(value.status);
  }
  if (value.type === "presence") {
    return optionalString(value.customerPhone) && optionalString(value.chatLid)
      && typeof value.state === "string" && PRESENCE.has(value.state);
  }
  if (value.type !== "message" || typeof value.waMessageId !== "string"
    || !value.waMessageId.trim() || typeof value.fromMe !== "boolean") return false;
  for (const key of ["customerPhone", "chatLid", "chatJid", "groupSubject",
    "participantName", "customerName", "messageType", "body"]) {
    if (!optionalString(value[key])) return false;
  }
  if (value.timestamp !== undefined && (typeof value.timestamp !== "number"
    || !Number.isFinite(value.timestamp) || value.timestamp <= 0
    || !Number.isFinite(new Date(value.timestamp * 1000).getTime()))) return false;
  if (value.media != null && (!Array.isArray(value.media) || !value.media.every((blob) =>
    record(blob) && typeof blob.base64 === "string"
    && typeof blob.contentType === "string" && !!blob.contentType.trim()
    && optionalString(blob.filename)))) return false;
  return true;
}
