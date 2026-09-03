import { createHmac, timingSafeEqual } from "crypto";

/**
 * Validate Twilio's `X-Twilio-Signature`.
 *
 * Twilio signs the exact URL it called concatenated with every POST parameter,
 * sorted by name and joined without separators, keyed by the account's auth
 * token. The auth token is the only key that works — an API key secret does not
 * sign webhooks — which is why the token is still required even when sends use
 * API keys.
 *
 * The URL is the part that bites in production: behind Vercel's proxy
 * `request.url` reports an internal host, and hashing that never matches what
 * Twilio hashed. The caller passes the public URL explicitly instead.
 */
export function isValidTwilioSignature(params: {
  authToken: string;
  /** The exact public URL Twilio was configured to call, query string included. */
  url: string;
  /** The decoded form body. */
  form: Record<string, string>;
  /** The `X-Twilio-Signature` header value. */
  signature: string | null;
}): boolean {
  if (!params.signature || !params.authToken) return false;

  const payload =
    params.url +
    Object.keys(params.form)
      .sort()
      .map((key) => key + params.form[key])
      .join("");

  const expected = createHmac("sha1", params.authToken)
    .update(Buffer.from(payload, "utf-8"))
    .digest("base64");

  const a = Buffer.from(expected);
  const b = Buffer.from(params.signature);
  // timingSafeEqual throws on a length mismatch, which is itself a rejection.
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Read a Twilio form post into a plain object, preserving every field. */
export function formToObject(form: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}
