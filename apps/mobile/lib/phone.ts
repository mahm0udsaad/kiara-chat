/**
 * Phone matching for the search boxes, mirroring `src/lib/phone.ts` on the
 * server.
 *
 * The inbox searches server-side, so its box has always understood that
 * `0502376231` and `+966502376231` are the same customer. The orders agenda
 * filters a window it already holds in memory, so it needs the same rules on
 * this side of the wire — otherwise typing the number off a note finds a chat
 * but not the visit it is about.
 *
 * Keep the two in step: any change to the server's normalization is a change
 * to what an employee can type here.
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
 * Does this phone answer to what was typed? Partial input matches, so the last
 * few digits are enough to find a visit.
 */
export function phoneMatches(
  phone: string | null | undefined,
  query: string,
): boolean {
  if (!phone) return false;
  const needle = normalizePhone(query);
  if (!needle) return false;
  return normalizePhone(phone).includes(needle);
}

/** True when the query is digits — a phone hunt rather than a name search. */
export function looksLikePhoneQuery(query: string): boolean {
  return digitsOf(query).length >= 3;
}
