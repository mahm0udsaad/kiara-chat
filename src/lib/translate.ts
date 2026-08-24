/**
 * One-shot message translation for specialist WhatsApp copies. Reuses the
 * bot's Gemini credentials — no key, no translation (callers fall back to the
 * Arabic original rather than blocking the order).
 */
import { generateText } from "ai";
import { googleAI, isBotConfigured } from "@/lib/bot/knowledge";

const MODEL = process.env.KIARA_BOT_MODEL || "gemini-3.6-flash";

/**
 * How long the employee is made to wait for a nicety.
 *
 * A flash model turns a 500-character booking message around in a second or
 * two. Left unbounded it is a different story: the SDK retries twice with
 * backoff and applies no request deadline of its own, so one slow provider
 * held the dispatch preview open for as long as the serverless function
 * allowed — the employee watching a spinner with no text under it, unable to
 * tell whether anything was still happening.
 *
 * The fallback was always the Arabic original; this only decides how soon we
 * settle for it.
 */
const TRANSLATE_TIMEOUT_MS = 8_000;

export async function translateMessage(
  text: string,
  targetLanguage: string
): Promise<string | null> {
  if (!isBotConfigured() || !text.trim()) return null;
  try {
    const { text: translated } = await generateText({
      model: googleAI(MODEL),
      // One retry, not two: a second attempt is worth its ~2s, a third is not
      // when the whole call is optional and someone is waiting on it.
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(TRANSLATE_TIMEOUT_MS),
      system: [
        `You translate WhatsApp messages sent to a spa's staff. Translate the user's message into ${targetLanguage}.`,
        "Keep emojis, line breaks, URLs, phone numbers and personal names exactly as they are.",
        "Write dates and times naturally for the target language (Western digits are fine).",
        "Output ONLY the translated message — no commentary, no quotes.",
      ].join(" "),
      prompt: text,
    });
    return translated.trim() || null;
  } catch {
    return null;
  }
}
