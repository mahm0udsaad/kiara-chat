import type { SupabaseClient } from "@supabase/supabase-js";

import type { Message } from "@/lib/types";

/**
 * Message types a WhatsApp pin arrives as. "location" is what the engine
 * writes once it has resolved coordinates ("name — address\nmaps link");
 * the two raw Baileys names are pins ingested before that step.
 */
const PIN_TYPES = new Set([
  "location",
  "locationMessage",
  "liveLocationMessage",
]);

/** Maps links customers actually paste: Google, its shorteners, and Waze. */
const MAP_LINK =
  /https?:\/\/(?:maps\.app\.goo\.gl\/\S+|goo\.gl\/maps\/\S+|(?:www\.)?google\.[a-z.]+\/maps\S*|maps\.google\.[a-z.]+\/\S*|(?:www\.)?waze\.com\/\S+)/i;

const ANY_LINK = /https?:\/\/\S+/;

export type SharedLocationSource = "pin" | "link" | "text";

export interface SharedLocation {
  /** One line, ready to drop into the order's location field. */
  value: string;
  /** The maps link, when the customer shared one. */
  url: string | null;
  /** Whatever text came with it — a pin's "name — address", or the typed line. */
  label: string | null;
  source: SharedLocationSource;
  /** ISO timestamp of the message it came from. */
  at: string;
}

/**
 * Words that make a typed line an address rather than conversation.
 *
 * The pin and maps-link branches below are self-evidently locations; a typed
 * line is not. Without this guard the "last thing she wrote" is offered as her
 * address — "لي ساعة ونص انتظر" is not an address — and a suggestion that is
 * usually wrong is worse than none, because someone eventually accepts one.
 *
 * Matched as whole words, never as substrings: "حسابها" ends in the letters of
 * أبها, and a city hiding inside an ordinary word is exactly how "كم كل وحده
 * حسابها" got offered as somewhere to send a driver.
 */
const ADDRESS_WORDS = new Set(
  [
    // Structure
    "حي", "الحي", "شارع", "الشارع", "طريق", "الطريق", "جاده", "مخرج", "بوابه",
    "فيلا", "فله", "عماره", "مبني", "برج", "شقه", "الدور", "مجمع", "كمبوند",
    "بلوك", "ضاحيه", "منطقه", "حاره", "بجانب", "بجنب", "خلف", "امام", "قرب",
    "عنواني", "العنوان", "موقعي",
    // Cities
    "الرياض", "جده", "مكه", "المدينه", "الدمام", "الخبر", "الظهران", "الطايف",
    "بريده", "تبوك", "ابها", "القصيم", "ينبع", "الجبيل", "نجران", "جازان",
    "حايل", "عرعر", "سكاكا", "الاحساء", "الهفوف", "القطيف",
    // Latin
    "street", "district", "road", "building", "villa", "compound",
  ].map(normalizeArabic)
);

/** Two-word markers, checked on the normalized text. */
const ADDRESS_PHRASES = ["قريب من", "جنب ال", "خميس مشيط", "المدينه المنوره"];

/** Google plus code — a location on its own, e.g. "7GQ4+2M الرياض". */
const PLUS_CODE = /\b[23456789CFGHJMPQRVWX]{4,6}\+[23456789CFGHJMPQRVWX]{2,3}\b/;

/** A coordinate pair, whether typed or left as the provider's pin body. */
const COORDS = /(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)/;

/**
 * Fold the spellings that vary keystroke to keystroke — hamzas, ta marbuta,
 * alef maqsura, diacritics — so one spelling in the list matches them all.
 */
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
  if (PLUS_CODE.test(text) || COORDS.test(text)) return true;
  const normalized = normalizeArabic(text);
  if (ADDRESS_PHRASES.some((phrase) => normalized.includes(phrase))) return true;
  // Split on anything outside the Arabic block, the Latin letters and the
  // digits, so each token is a whole word and "حسابها" can never be read as
  // "ابها". Spelled as an explicit range rather than \p{L}: the same file runs
  // on Hermes, where unicode property escapes are not something to rely on.
  return normalized
    .split(/[^0-9a-z\u0600-\u06FF]+/)
    .some((word) => word && ADDRESS_WORDS.has(word));
}

const RANK: Record<SharedLocationSource, number> = { pin: 3, link: 2, text: 1 };

type Coordinates = { latitude: number; longitude: number };

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

function coordinatesFrom(message: Message): Coordinates | null {
  const metadata = recordOf(message.metadata);
  const candidates = [
    recordOf(metadata?.location),
    recordOf(metadata?.locationMessage),
    recordOf(metadata?.liveLocationMessage),
    metadata,
  ].filter((candidate): candidate is Record<string, unknown> => Boolean(candidate));

  for (const candidate of candidates) {
    const latitude = finiteNumber(
      candidate.latitude ?? candidate.lat ?? candidate.degreesLatitude
    );
    const longitude = finiteNumber(
      candidate.longitude ?? candidate.lng ?? candidate.lon ?? candidate.degreesLongitude
    );
    if (latitude !== null && longitude !== null) {
      const valid = validCoordinates(latitude, longitude);
      if (valid) return valid;
    }
  }

  const match = COORDS.exec(message.content ?? "");
  return match ? validCoordinates(Number(match[1]), Number(match[2])) : null;
}

function mapUrl(coordinates: Coordinates): string {
  return `https://www.google.com/maps/search/?api=1&query=${coordinates.latitude},${coordinates.longitude}`;
}

function metadataLabel(message: Message): string {
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

function fromPin(message: Message): SharedLocation {
  const content = message.content ?? "";
  const existingUrl = ANY_LINK.exec(content)?.[0] ?? null;
  const coordinates = coordinatesFrom(message);
  const url = existingUrl || (coordinates ? mapUrl(coordinates) : null);
  const fromContent = content
    .replace(existingUrl ?? "", "")
    .replace(COORDS, "")
    .replace(/^[\s\-—,:؛]+|[\s\-—,:؛]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const label =
    metadataLabel(message) ||
    (!PLUS_CODE.test(fromContent) &&
    !/^[{[]/.test(fromContent) &&
    !/(degreesLatitude|degreesLongitude|latitude|longitude)/i.test(fromContent)
      ? fromContent
      : "");
  return {
    value: [label, url].filter(Boolean).join(" — ") || "موقع مُرسل",
    url,
    label: label || null,
    source: "pin",
    at: message.created_at,
  };
}

/**
 * The location the customer already shared in the thread, best evidence first:
 * a dropped pin IS the address, a pasted maps link is nearly as good, and the
 * last line she typed is only a guess worth offering — never worth filling in
 * on its own.
 *
 * Only her own messages count; an agent's link is usually the clinic's.
 */
export function findSharedLocations(messages: Message[]): SharedLocation[] {
  const locations: SharedLocation[] = [];
  const seen = new Set<string>();
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== "customer") continue;
    const content = message.content?.trim();
    if (!content && !PIN_TYPES.has(message.message_type)) continue;

    let found: SharedLocation | null = null;
    if (PIN_TYPES.has(message.message_type)) {
      found = fromPin(message);
    } else if (message.message_type === "text") {
      const url = MAP_LINK.exec(content)?.[0] ?? null;
      if (url) {
        const label = content.replace(url, "").replace(/\s+/g, " ").trim();
        found = {
          value: [label, url].filter(Boolean).join(" — "),
          url,
          label: label || null,
          source: "link",
          at: message.created_at,
        };
      } else if (coordinatesFrom(message)) {
        const coordinateUrl = mapUrl(coordinatesFrom(message)!);
        found = {
          value: coordinateUrl,
          url: coordinateUrl,
          label: null,
          source: "pin",
          at: message.created_at,
        };
      } else if (looksLikeAddress(content)) {
        found = {
          value: content.replace(/\s+/g, " "),
          url: null,
          label: content.replace(/\s+/g, " "),
          source: "text",
          at: message.created_at,
        };
      }
    }

    if (!found || (!found.url && !found.label)) continue;
    const key = (found.url || found.value).trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    locations.push(found);
  }
  return locations;
}

export function findSharedLocation(messages: Message[]): SharedLocation | null {
  return bestSharedLocation(findSharedLocations(messages));
}

export function bestSharedLocation(locations: SharedLocation[]): SharedLocation | null {
  let best: SharedLocation | null = null;
  for (const location of locations) {
    if (!best || RANK[location.source] > RANK[best.source]) best = location;
  }
  return best;
}

/** Hosts the `MAP_LINK` pattern accepts, as SQL `ilike` needles. */
const MAP_LINK_HOSTS = [
  "maps.app.goo.gl",
  "goo.gl/maps",
  "google.com/maps",
  "maps.google.",
  "waze.com",
];

/**
 * The best location evidence anywhere in the thread, not just in the page the
 * client happens to have loaded.
 *
 * A pin is usually dropped once, early — a customer who shared her address
 * three weeks and two hundred messages ago has still shared it, and asking her
 * again is the thing this is here to prevent. Two narrow queries (the pin
 * types, then a maps link) beat pulling a whole history into memory to scan it.
 *
 * A typed line is deliberately not searched for this way: across a long history
 * the guesses outnumber the addresses, so it stays scoped to the recent
 * messages the caller already loaded.
 */
export async function findSharedLocationsInConversation(
  supabase: SupabaseClient,
  conversationId: string,
  recentMessages: Message[] = []
): Promise<SharedLocation[]> {
  const customerMessages = () =>
    supabase
      .from("messages")
      .select("id, conversation_id, role, content, message_type, metadata, created_at")
      .eq("conversation_id", conversationId)
      .eq("role", "customer");

  const [pin, link] = await Promise.all([
    customerMessages()
      .in("message_type", [...PIN_TYPES])
      .order("created_at", { ascending: false })
      .limit(20),
    customerMessages()
      .eq("message_type", "text")
      .or(MAP_LINK_HOSTS.map((host) => `content.ilike.%${host}%`).join(","))
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  // Same ranking as the in-memory scan: a pin outranks a link, which outranks
  // a line she typed — and the typed line can only come from what was loaded.
  const stored = [
    ...((link.data ?? []) as Message[]),
    ...((pin.data ?? []) as Message[]),
  ];
  return findSharedLocations(
    [...recentMessages, ...stored].sort((a, b) =>
      a.created_at.localeCompare(b.created_at)
    )
  );
}

export async function findSharedLocationInConversation(
  supabase: SupabaseClient,
  conversationId: string,
  recentMessages: Message[] = []
): Promise<SharedLocation | null> {
  return bestSharedLocation(
    await findSharedLocationsInConversation(
      supabase,
      conversationId,
      recentMessages
    )
  );
}
