/**
 * Phone matching for the inbox and orders search boxes.
 *
 * Numbers are stored E.164 (`+966502376231`) but nobody types them that way —
 * staff read `0502376231` off a note or a caller ID. Both forms have to find
 * the same customer, so comparisons run on a normalized national number: no
 * punctuation, no international prefix, no trunk zero.
 */

const digitsOf = (value: string) => value.replace(/\D/g, "");

/**
 * `+966 50 237 6231`, `00966502376231`, `0502376231` and `502376231` all
 * reduce to `502376231`.
 *
 * The country code is only stripped when what follows still looks like a
 * subscriber number — otherwise searching for the digits `966` itself would
 * silently become an empty query.
 */
export function normalizePhone(value: string): string {
  let digits = digitsOf(value);
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("966") && digits.length > 6) digits = digits.slice(3);
  return digits.replace(/^0+/, "");
}

/**
 * A deliverable phone address for Kiara's Saudi WhatsApp account.
 *
 * Local roster/Rekaz values commonly arrive as `05…` or bare `5…`; storing
 * them as `+05…` creates an address WhatsApp cannot deliver to. Explicit
 * international numbers keep their country code, while local mobile numbers
 * receive Saudi Arabia's `966` prefix.
 */
export function canonicalPhone(value: string): string | null {
  const raw = value.trim();
  let digits = digitsOf(raw);
  if (!digits) return null;
  if (raw.startsWith("00")) digits = digits.slice(2);

  // Some integrations accidentally prepend `+` to a local trunk number
  // (`+050…`). Treat that as local rather than preserving an undeliverable
  // pseudo-country code.
  if ((raw.startsWith("+") && !digits.startsWith("0")) || raw.startsWith("00")) {
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  if (digits.startsWith("966") && digits.length === 12) return `+${digits}`;

  const national = digits.replace(/^0+/, "");
  if (national.startsWith("5") && national.length === 9) {
    return `+966${national}`;
  }
  return null;
}

/**
 * Does this phone answer to what was typed? Partial input matches, so typing
 * the last few digits is enough to find a chat.
 */
export function phoneMatches(phone: string | null | undefined, query: string): boolean {
  if (!phone) return false;
  const needle = normalizePhone(query);
  if (!needle) return false;
  return normalizePhone(phone).includes(needle);
}
