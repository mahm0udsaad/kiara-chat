/**
 * Phone matching for the inbox and orders search boxes.
 *
 * Numbers are stored E.164 (`+966502376231`) but nobody types them that way —
 * staff read `0502376231` off a note or a caller ID. Both forms have to find
 * the same customer, so comparisons run on a normalized national number: no
 * punctuation, no international prefix, no trunk zero.
 */

/**
 * Arabic-Indic (`٠١٢`) and Persian (`۰۱۲`) digits, folded to ASCII.
 *
 * The app is Arabic throughout, so a number pasted from WhatsApp or the
 * contacts app on an Arabic-locale keyboard arrives in Arabic-Indic digits.
 * Treating those as punctuation reduced the whole paste to an empty string,
 * and an empty needle matches nothing — the search came back blank for a
 * customer who was sitting right there in the inbox.
 */
const ARABIC_INDIC_ZERO = 0x0660;
const PERSIAN_ZERO = 0x06f0;

const toAsciiDigits = (value: string) =>
  value.replace(/[\u0660-\u0669\u06f0-\u06f9]/g, (char) => {
    const code = char.charCodeAt(0);
    return String(code - (code >= PERSIAN_ZERO ? PERSIAN_ZERO : ARABIC_INDIC_ZERO));
  });

const digitsOf = (value: string) => toAsciiDigits(value).replace(/\D/g, "");

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
  // Folded before the `+`/`00` tests below, which read the raw string:
  // an Arabic-digit `٠٠٩٦٦…` is the same international prefix as `00966…`.
  const raw = toAsciiDigits(value.trim());
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
