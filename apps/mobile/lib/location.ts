import type { ConversationMessage, SharedLocation } from "@/types/api";

/** WhatsApp message types used for a dropped or live pin. */
export const PIN_TYPES = new Set([
  "location",
  "locationMessage",
  "liveLocationMessage",
]);

/** Maps links customers commonly paste into a text message. */
const MAP_LINK =
  /https?:\/\/(?:maps\.app\.goo\.gl\/\S+|goo\.gl\/maps\/\S+|(?:www\.)?google\.[a-z.]+\/maps\S*|maps\.google\.[a-z.]+\/\S*|(?:www\.)?waze\.com\/\S+)/i;
const ANY_LINK = /https?:\/\/\S+/i;
const COORDINATES = /(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)/;

const ADDRESS_WORDS = new Set(
  [
    "حي", "الحي", "شارع", "الشارع", "طريق", "الطريق", "جاده", "مخرج", "بوابه",
    "فيلا", "فله", "عماره", "مبني", "برج", "شقه", "الدور", "مجمع", "كمبوند",
    "بلوك", "ضاحيه", "منطقه", "حاره", "بجانب", "بجنب", "خلف", "امام", "قرب",
    "عنواني", "العنوان", "موقعي", "الرياض", "جده", "مكه", "المدينه", "الدمام",
    "الخبر", "الظهران", "الطايف", "بريده", "تبوك", "ابها", "القصيم", "ينبع",
    "الجبيل", "نجران", "جازان", "حايل", "عرعر", "سكاكا", "الاحساء", "الهفوف",
    "القطيف", "street", "district", "road", "building", "villa", "compound",
  ].map(normalizeArabic),
);
const ADDRESS_PHRASES = ["قريب من", "جنب ال", "خميس مشيط", "المدينه المنوره"];
const PLUS_CODE = /\b[23456789CFGHJMPQRVWX]{4,6}\+[23456789CFGHJMPQRVWX]{2,3}\b/i;
const RANK: Record<SharedLocation["source"], number> = { pin: 3, link: 2, text: 1 };

type Coordinates = { latitude: number; longitude: number };

function normalizeArabic(text: string): string {
  return text
    .replace(/[\u064B-\u0652\u0670]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .toLowerCase();
}

function looksLikeAddress(text: string): boolean {
  if (PLUS_CODE.test(text) || COORDINATES.test(text)) return true;
  const normalized = normalizeArabic(text);
  if (ADDRESS_PHRASES.some((phrase) => normalized.includes(phrase))) return true;
  return normalized
    .split(/[^0-9a-z\u0600-\u06FF]+/)
    .some((word) => word && ADDRESS_WORDS.has(word));
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function validCoordinates(latitude: number, longitude: number): Coordinates | null {
  return latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180
    ? { latitude, longitude }
    : null;
}

/** Reads Twilio, Baileys, and normalized location metadata without exposing raw JSON. */
function coordinatesFrom(message: ConversationMessage): Coordinates | null {
  const metadata = recordOf(message.metadata);
  const candidates = [
    recordOf(metadata?.location),
    recordOf(metadata?.locationMessage),
    recordOf(metadata?.liveLocationMessage),
    metadata,
  ].filter((candidate): candidate is Record<string, unknown> => Boolean(candidate));

  for (const candidate of candidates) {
    const latitude = finiteNumber(
      candidate.latitude ?? candidate.lat ?? candidate.degreesLatitude,
    );
    const longitude = finiteNumber(
      candidate.longitude ?? candidate.lng ?? candidate.lon ?? candidate.degreesLongitude,
    );
    if (latitude !== null && longitude !== null) {
      const valid = validCoordinates(latitude, longitude);
      if (valid) return valid;
    }
  }

  const match = COORDINATES.exec(message.content ?? "");
  if (!match) return null;
  return validCoordinates(Number(match[1]), Number(match[2]));
}

function mapUrl(coordinates: Coordinates): string {
  return `https://www.google.com/maps/search/?api=1&query=${coordinates.latitude},${coordinates.longitude}`;
}

function locationMetadataLabel(message: ConversationMessage): string {
  const metadata = recordOf(message.metadata);
  const candidates = [
    recordOf(metadata?.location),
    recordOf(metadata?.locationMessage),
    recordOf(metadata?.liveLocationMessage),
    metadata,
  ].filter((candidate): candidate is Record<string, unknown> => Boolean(candidate));
  const pieces: string[] = [];
  for (const candidate of candidates) {
    for (const key of ["label", "name", "address"] as const) {
      const value = candidate[key];
      if (typeof value !== "string") continue;
      const clean = value.replace(/\s+/g, " ").trim();
      if (clean && !pieces.includes(clean)) pieces.push(clean);
    }
  }
  return pieces.join(" — ");
}

function readablePinLabel(message: ConversationMessage, url: string | null): string {
  const metadataLabel = locationMetadataLabel(message);
  if (metadataLabel) return metadataLabel;

  const content = (message.content ?? "")
    .replace(url ?? "", "")
    .replace(COORDINATES, "")
    .replace(/^[\s\-—,:؛]+|[\s\-—,:؛]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!content || PLUS_CODE.test(content)) return "";
  // Provider payloads occasionally arrive as serialized objects. They are
  // useful for parsing, never useful as customer-facing copy.
  if (/^[{[]/.test(content) || /(degreesLatitude|degreesLongitude|latitude|longitude)/i.test(content)) {
    return "";
  }
  return content;
}

/** Converts one message into a readable, tappable location when possible. */
export function locationFromMessage(
  message: ConversationMessage,
): SharedLocation | null {
  const content = message.content?.trim() ?? "";
  if (PIN_TYPES.has(message.message_type)) {
    const coordinates = coordinatesFrom(message);
    const existingUrl = ANY_LINK.exec(content)?.[0] ?? null;
    const url = existingUrl || (coordinates ? mapUrl(coordinates) : null);
    const label = readablePinLabel(message, existingUrl);
    return {
      value: [label, url].filter(Boolean).join(" — ") || "موقع مُرسل",
      url,
      label: label || null,
      source: "pin",
      at: message.created_at,
    };
  }

  if (message.message_type !== "text" || !content) return null;
  const pastedUrl = MAP_LINK.exec(content)?.[0] ?? null;
  if (pastedUrl) {
    const label = content.replace(pastedUrl, "").replace(/\s+/g, " ").trim();
    return {
      value: [label, pastedUrl].filter(Boolean).join(" — "),
      url: pastedUrl,
      label: label || null,
      source: "link",
      at: message.created_at,
    };
  }

  const coordinates = coordinatesFrom(message);
  if (coordinates) {
    const url = mapUrl(coordinates);
    return { value: url, url, label: null, source: "pin", at: message.created_at };
  }
  if (!looksLikeAddress(content)) return null;
  const label = content.replace(/\s+/g, " ");
  return { value: label, url: null, label, source: "text", at: message.created_at };
}

/** Every distinct customer location, newest first, for order recommendations. */
export function findSharedLocations(
  messages: ConversationMessage[],
): SharedLocation[] {
  const found: SharedLocation[] = [];
  const seen = new Set<string>();
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== "customer") continue;
    const location = locationFromMessage(message);
    if (!location || (!location.url && !location.label)) continue;
    const key = (location.url || location.value).trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    found.push(location);
  }
  return found;
}

/** Best evidence first, with newest winning when two locations have equal quality. */
export function findSharedLocation(
  messages: ConversationMessage[],
): SharedLocation | null {
  let best: SharedLocation | null = null;
  for (const location of findSharedLocations(messages)) {
    if (!best || RANK[location.source] > RANK[best.source]) best = location;
  }
  return best;
}
