/**
 * One-shot message translation for specialist WhatsApp copies. Reuses the
 * bot's Gemini credentials — no key, no translation (callers fall back to the
 * Arabic original rather than blocking the order).
 */
import { generateText } from "ai";
import { googleAI, isBotConfigured } from "@/lib/bot/knowledge";

const MODEL = process.env.KIARA_BOT_MODEL || "gemini-3.6-flash";

export async function translateMessage(
  text: string,
  targetLanguage: string
): Promise<string | null> {
  if (!isBotConfigured() || !text.trim()) return null;
  try {
    const { text: translated } = await generateText({
      model: googleAI(MODEL),
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
