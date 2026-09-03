/**
 * The auto-reply bot's turn: decide whether to answer, answer, send, record.
 *
 * Gates, in order — each one silently yields the conversation to a human:
 *   1. the API key is configured and the tenant switch (`ai_enabled`) is on
 *   2. the configured daily window allows it right now
 *   3. nobody has claimed the conversation (`handler_mode`)
 *   4. the owner isn't already replying from her own WhatsApp app
 *   5. the message has text, and retrieval grounded it
 *
 * Never throws into the webhook: a bot failure must not cost us the inbound
 * message, so everything is caught and the conversation is left to staff.
 */
import { generateObject, jsonSchema } from "ai";
import { getBotSettings } from "@/lib/ai-settings";
import { isWithinSchedule } from "@/lib/bot-schedule";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { isProviderConfigured, transportForConversation } from "@/lib/transport";
import { KIARA_RESTAURANT_ID } from "@/lib/tenant";
import { bumpConversationActivity, saveMessage } from "@/lib/server-conversations";
import { googleAI, isBotConfigured, retrieveKnowledge, STRONG_HIT } from "@/lib/bot/knowledge";
import {
  buildSystemPrompt,
  HANDOFF_LABEL,
  REPLY_SCHEMA,
  type BotDecision,
} from "@/lib/bot/prompt";

/** Flash is the right tier for a WhatsApp turn — quality per second matters most. */
const MODEL = process.env.KIARA_BOT_MODEL || "gemini-3.6-flash";
/** How much of the thread the model sees. Enough for a booking back-and-forth. */
const HISTORY_LIMIT = 12;
/**
 * If the owner answered from her phone within this window, she's handling the
 * chat live — the bot stays out of her way rather than talking over her.
 */
const HUMAN_ON_PHONE_MS = 30 * 60_000;

export interface BotTurnInput {
  conversationId: string;
  customerPhone: string;
  /** The inbound text that triggered this turn. */
  body: string;
}

export type BotTurnOutcome =
  | { replied: true; handoff: boolean }
  | { replied: false; reason: string };

export async function runBotTurn(input: BotTurnInput): Promise<BotTurnOutcome> {
  try {
    return await turn(input);
  } catch (e) {
    console.error("[bot] turn failed", e instanceof Error ? e.message : e);
    return { replied: false, reason: "error" };
  }
}

async function turn(input: BotTurnInput): Promise<BotTurnOutcome> {
  const text = input.body.trim();
  // Media-only messages carry no question to answer — leave them to staff.
  if (!text) return { replied: false, reason: "no_text" };
  if (!isBotConfigured()) return { replied: false, reason: "no_api_key" };
  // Which transport can answer depends on the thread, so the check moves below
  // the conversation lookup rather than gating on one provider being up.
  const transport = await transportForConversation(input.conversationId);
  if (!isProviderConfigured(transport.provider)) {
    return { replied: false, reason: "no_transport" };
  }

  const settings = await getBotSettings();
  if (!settings.enabled) return { replied: false, reason: "bot_off" };
  if (!isWithinSchedule(settings)) return { replied: false, reason: "outside_schedule" };

  const admin = getAdminSupabaseClient();
  const { data: conv } = await admin
    .from("conversations")
    .select("id, handler_mode, customer_name")
    .eq("id", input.conversationId)
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .maybeSingle();
  if (!conv) return { replied: false, reason: "no_conversation" };

  const mode = (conv.handler_mode as string | null) ?? "unassigned";
  if (mode === "human") return { replied: false, reason: "claimed_by_human" };

  const history = await loadHistory(input.conversationId);
  if (ownerIsReplyingFromPhone(history)) {
    return { replied: false, reason: "human_on_whatsapp" };
  }

  // Claim the conversation for the bot before spending a model call on it. The
  // handler_mode filter makes this race-safe against an agent claiming it now.
  if (mode === "unassigned") {
    const { data: promoted } = await admin
      .from("conversations")
      .update({ handler_mode: "bot" })
      .eq("id", input.conversationId)
      .eq("handler_mode", "unassigned")
      .select("id")
      .maybeSingle();
    if (!promoted) return { replied: false, reason: "claimed_during_turn" };
  }

  const { context, topSimilarity } = await retrieveKnowledge(text);
  const decision = await decide({
    text,
    customerName: (conv.customer_name as string | null) ?? null,
    knowledge: context,
    grounded: Boolean(context) && topSimilarity >= STRONG_HIT,
    history,
  });
  if (!decision) {
    // The model failed us — hand back rather than leaving her on read.
    await handOff(input.conversationId, "unknown", null);
    return { replied: false, reason: "model_error" };
  }

  const reply = decision.reply.trim();
  if (!reply) {
    await handOff(input.conversationId, "unknown", null);
    return { replied: false, reason: "empty_reply" };
  }

  const { providerMessageId } = await transport.sendText(input.customerPhone, reply);
  await saveMessage({
    conversationId: input.conversationId,
    role: "agent",
    content: reply,
    messageType: "text",
    // Storing the WA id is what makes the engine's fromMe echo dedupe instead
    // of coming back as a second message.
    externalMessageSid: providerMessageId,
    ...(transport.provider === "twilio"
      ? { twilioMessageSid: providerMessageId }
      : {}),
    metadata: { source: "bot", provider: transport.provider },
    deliveryStatus: "sent",
  });
  await bumpConversationActivity(input.conversationId, { inbound: false });

  if (decision.handoff && decision.handoffReason !== "none") {
    await handOff(input.conversationId, decision.handoffReason, decision);
  }

  return { replied: true, handoff: decision.handoff };
}

export interface BotPreview {
  reply: string;
  handoff: boolean;
  handoffReason: BotDecision["handoffReason"];
  /** Whether retrieval was confident enough for the bot to answer from it. */
  grounded: boolean;
  /** Best chunk similarity, so a weak knowledge base is visible, not guessed at. */
  similarity: number;
}

/**
 * Run a question through retrieval + the model and return what the bot *would*
 * say — nothing is sent and no conversation is touched. This is how the owner
 * checks the bot's tone and grounding before it ever talks to a customer.
 */
export async function previewBotAnswer(question: string): Promise<BotPreview> {
  if (!isBotConfigured()) throw new Error("مفتاح Gemini غير مضبوط");
  const { context, topSimilarity } = await retrieveKnowledge(question);
  const grounded = Boolean(context) && topSimilarity >= STRONG_HIT;
  const decision = await decide({
    text: question,
    customerName: null,
    knowledge: context,
    grounded,
    history: [],
  });
  if (!decision) throw new Error("تعذّر توليد رد");
  return {
    reply: decision.reply,
    handoff: decision.handoff,
    handoffReason: decision.handoffReason,
    grounded,
    similarity: topSimilarity,
  };
}

interface HistoryRow {
  role: string;
  content: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

async function loadHistory(conversationId: string): Promise<HistoryRow[]> {
  const { data } = await getAdminSupabaseClient()
    .from("messages")
    .select("role, content, metadata, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);
  return ((data ?? []) as HistoryRow[]).reverse();
}

/** A fromMe message our app didn't send means she's typing on the phone. */
function ownerIsReplyingFromPhone(history: HistoryRow[]): boolean {
  const cutoff = Date.now() - HUMAN_ON_PHONE_MS;
  return history.some(
    (m) =>
      m.role === "agent" &&
      (m.metadata as { source?: string } | null)?.source === "whatsapp_app" &&
      new Date(m.created_at).getTime() >= cutoff
  );
}

async function decide(args: {
  text: string;
  customerName: string | null;
  knowledge: string;
  grounded: boolean;
  history: HistoryRow[];
}): Promise<BotDecision | null> {
  const messages = args.history
    .filter((m) => m.content?.trim() && m.role !== "system")
    .map((m) => ({
      role: m.role === "customer" ? ("user" as const) : ("assistant" as const),
      content: m.content,
    }));
  // The triggering message is already the last history row; keep it as the tail
  // only if the read raced ahead of the insert.
  if (messages.at(-1)?.content !== args.text) {
    messages.push({ role: "user", content: args.text });
  }

  try {
    const { object } = await generateObject({
      model: googleAI(MODEL),
      schema: jsonSchema<BotDecision>(REPLY_SCHEMA),
      system: buildSystemPrompt({
        customerName: args.customerName,
        knowledge: args.knowledge,
        grounded: args.grounded,
      }),
      messages,
    });
    return object;
  } catch (e) {
    console.error("[bot] generate failed", e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * Give the conversation back to the team: unassign it so it surfaces in the
 * inbox as unclaimed, and leave an internal note saying why the bot stepped
 * out. A booking handoff additionally pins a structured booking_request on the
 * conversation's metadata — that's what drives the «طلب حجز» badge and the
 * prefilled order form; specialist/driver choice stays with the humans.
 */
async function handOff(
  conversationId: string,
  reason: Exclude<BotDecision["handoffReason"], "none">,
  decision: BotDecision | null
): Promise<void> {
  const admin = getAdminSupabaseClient();

  const patch: Record<string, unknown> = { handler_mode: "unassigned" };
  if (reason === "booking" && decision) {
    const { data: conv } = await admin
      .from("conversations")
      .select("metadata")
      .eq("id", conversationId)
      .eq("restaurant_id", KIARA_RESTAURANT_ID)
      .maybeSingle();
    patch.metadata = {
      ...((conv?.metadata as Record<string, unknown>) ?? {}),
      booking_request: {
        status: "pending",
        summary: decision.bookingSummary.trim(),
        service: decision.bookingService.trim(),
        time: decision.bookingTime.trim(),
        location: decision.bookingLocation.trim(),
        at: new Date().toISOString(),
      },
    };
  }
  await admin
    .from("conversations")
    .update(patch)
    .eq("id", conversationId)
    .eq("restaurant_id", KIARA_RESTAURANT_ID);

  const summary = decision?.bookingSummary.trim() ?? "";
  const body = summary
    ? `🤖 حوّل البوت المحادثة — ${HANDOFF_LABEL[reason]}:\n${summary}`
    : `🤖 حوّل البوت المحادثة — ${HANDOFF_LABEL[reason]}.`;
  await admin.from("conversation_internal_notes").insert({
    conversation_id: conversationId,
    restaurant_id: KIARA_RESTAURANT_ID,
    author_user_id: null,
    body,
  });
}
