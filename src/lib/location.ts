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

const RANK: Record<SharedLocationSource, number> = { pin: 3, link: 2, text: 1 };

function fromPin(message: Message): SharedLocation {
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
 * The location the customer already shared in the thread, best evidence first:
 * a dropped pin IS the address, a pasted maps link is nearly as good, and the
 * last line she typed is only a guess worth offering — never worth filling in
 * on its own.
 *
 * Only her own messages count; an agent's link is usually the clinic's.
 */
export function findSharedLocation(messages: Message[]): SharedLocation | null {
  let best: SharedLocation | null = null;

  // Newest first, so the first hit at any rank is the freshest one.
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== "customer") continue;
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
      } else {
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
