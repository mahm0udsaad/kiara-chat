import type { ConversationMessage, SharedLocation } from "@/types/api";

/**
 * Where the customer already said she is, read straight out of the thread.
 *
 * A port of the web inbox's `findSharedLocation`, kept client-side for the same
 * reason: the messages are already here, so the booking sheet can prefill the
 * address without waiting on another round trip — and without anyone retyping
 * a pin she dropped an hour ago.
 */

/**
 * Message types a WhatsApp pin arrives as. "location" is what the engine writes
 * once it has resolved coordinates ("name — address\nmaps link"); the two raw
 * Baileys names are pins ingested before that step.
 */
const PIN_TYPES = new Set(["location", "locationMessage", "liveLocationMessage"]);

/** Maps links customers actually paste: Google, its shorteners, and Waze. */
const MAP_LINK =
  /https?:\/\/(?:maps\.app\.goo\.gl\/\S+|goo\.gl\/maps\/\S+|(?:www\.)?google\.[a-z.]+\/maps\S*|maps\.google\.[a-z.]+\/\S*|(?:www\.)?waze\.com\/\S+)/i;

const ANY_LINK = /https?:\/\/\S+/;

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

/** A pasted coordinate pair. */
const COORDS = /-?\d{1,2}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,}/;

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

const RANK: Record<SharedLocation["source"], number> = { pin: 3, link: 2, text: 1 };

function fromPin(message: ConversationMessage): SharedLocation {
  const content = message.content ?? "";
  const url = ANY_LINK.exec(content)?.[0] ?? null;
  const label = content.replace(url ?? "", "").replace(/\s+/g, " ").trim();
  return {
    value: [label, url].filter(Boolean).join(" — "),
    url,
    label: label || null,
    source: "pin",
    at: message.created_at,
  };
}

/**
 * Best evidence first: a dropped pin IS the address, a pasted maps link is
 * nearly as good, and the last line she typed is only a guess worth offering —
 * never worth filling in on its own.
 *
 * Only her own messages count; an agent's link is usually the salon's.
 */
export function findSharedLocation(
  messages: ConversationMessage[],
): SharedLocation | null {
  let best: SharedLocation | null = null;

  // Newest first, so the first hit at any rank is the freshest one.
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== "customer") continue;
    const content = message.content?.trim();
    if (!content) continue;

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

    if (!found || !found.value) continue;
    if (!best || RANK[found.source] > RANK[best.source]) best = found;
    if (best.source === "pin") break; // Nothing outranks a pin.
  }

  return best;
}
