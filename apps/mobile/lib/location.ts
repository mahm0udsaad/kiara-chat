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
 * Markers that make a typed line an address rather than conversation.
 *
 * The pin and maps-link branches below are self-evidently locations; a typed
 * line is not. Without this guard the "last thing she wrote" is offered as her
 * address — "لي ساعة ونص انتظر" is not an address — and a suggestion that is
 * usually wrong is worse than none, because someone eventually accepts one.
 */
const ADDRESS_HINT =
  /(حي\s|الحي|شارع|طريق|جاده|جادة|مخرج|بوابة|بوابه|فيلا|فلة|عمارة|عماره|مبنى|برج|شقة|شقه|الدور|مجمع|كمبوند|بلوك|ضاحية|ضاحيه|منطقة|منطقه|قريب من|بجانب|بجنب|خلف\s|أمام\s|امام\s|الرياض|جدة|جده|مكة|مكه|المدينة المنورة|الدمام|الخبر|الظهران|الطائف|الطايف|بريدة|بريده|تبوك|أبها|ابها|خميس مشيط|القصيم|ينبع|الجبيل|نجران|جازان|حائل|عرعر|سكاكا|الأحساء|الاحساء|الهفوف|street|district|road|building)/i;

/** Google plus code — a location on its own, e.g. "7GQ4+2M الرياض". */
const PLUS_CODE = /\b[23456789CFGHJMPQRVWX]{4,6}\+[23456789CFGHJMPQRVWX]{2,3}\b/;

/** A pasted coordinate pair. */
const COORDS = /-?\d{1,2}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,}/;

function looksLikeAddress(text: string): boolean {
  return ADDRESS_HINT.test(text) || PLUS_CODE.test(text) || COORDS.test(text);
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
