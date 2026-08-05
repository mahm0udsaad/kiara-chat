/**
 * AI read of one customer's experience — satisfaction, how the staff spoke to
 * her, and what to do better.
 *
 * The salon can't re-read a year of WhatsApp before every visit, so this feeds
 * the conversation (plus her Rekaz booking record for context) to Gemini and
 * gets back a structured verdict: a satisfaction score, an assessment of the
 * staff's communication, and concrete recommendations. Same model and
 * credentials as the auto-reply bot — no new provider, no new key.
 *
 * Grounded on purpose: the prompt forbids inventing anything not in the
 * transcript, and the whole feature no-ops (returns null) when no key is set,
 * so it never blocks the timeline.
 */
import { generateObject, jsonSchema } from "ai";
import type { JSONSchema7 } from "@ai-sdk/provider";
import { googleAI, isBotConfigured } from "@/lib/bot/knowledge";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { KIARA_RESTAURANT_ID } from "@/lib/tenant";
import { normalizePhone } from "@/lib/phone";
import { fetchCustomerReservations } from "@/lib/rekaz";

const MODEL = process.env.KIARA_BOT_MODEL || "gemini-3.6-flash";

/** Newest messages fed to the model — enough for the arc, bounded for tokens. */
const MAX_MESSAGES = 250;
/** A single pasted essay shouldn't crowd out the rest of the thread. */
const MAX_MESSAGE_CHARS = 600;

export interface CustomerAnalysis {
  satisfaction: {
    /** 0–100. */
    score: number;
    label: string; // راضية جدًا / راضية / محايدة / غير راضية / غاضبة
    summary: string;
  };
  trend: "improving" | "steady" | "declining" | "unknown";
  staff: {
    /** 0–100: quality of the salon's side of the conversation. */
    rating: number;
    strengths: string[];
    issues: string[];
  };
  recommendations: string[];
  redFlags: string[];
}

export interface CustomerAnalysisResult extends CustomerAnalysis {
  basis: {
    messages: number; // how many messages the read was based on
    bookings: number;
    conversationId: string | null;
  };
}

const ANALYSIS_SCHEMA: JSONSchema7 = {
  type: "object",
  additionalProperties: false,
  required: ["satisfaction", "trend", "staff", "recommendations", "redFlags"],
  properties: {
    satisfaction: {
      type: "object",
      additionalProperties: false,
      required: ["score", "label", "summary"],
      properties: {
        score: { type: "integer", minimum: 0, maximum: 100 },
        label: {
          type: "string",
          description: "تصنيف قصير بالعربية: راضية جدًا / راضية / محايدة / غير راضية / غاضبة",
        },
        summary: {
          type: "string",
          description: "جملة أو جملتان بالعربية تلخّص شعور الزبونة ولماذا.",
        },
      },
    },
    trend: {
      type: "string",
      enum: ["improving", "steady", "declining", "unknown"],
      description: "هل يتحسّن رضا الزبونة عبر الوقت أم يتراجع؟",
    },
    staff: {
      type: "object",
      additionalProperties: false,
      required: ["rating", "strengths", "issues"],
      properties: {
        rating: { type: "integer", minimum: 0, maximum: 100 },
        strengths: {
          type: "array",
          items: { type: "string" },
          description: "ما أحسنه فريق الصالون في التواصل (بالعربية، نقاط قصيرة).",
        },
        issues: {
          type: "array",
          items: { type: "string" },
          description: "ما يمكن تحسينه في أسلوب الموظفات (بالعربية، نقاط قصيرة).",
        },
      },
    },
    recommendations: {
      type: "array",
      items: { type: "string" },
      description: "توصيات عملية وقابلة للتنفيذ لرفع رضا هذه الزبونة تحديدًا.",
    },
    redFlags: {
      type: "array",
      items: { type: "string" },
      description:
        "أمور تحتاج انتباهًا عاجلًا: شكوى، سؤال بلا رد، وعد لم يُنفَّذ، أو خطر فقدان الزبونة. اتركيها فارغة إن لم توجد.",
    },
  },
};

const ROLE_LABEL: Record<string, string> = {
  customer: "الزبونة",
  agent: "الصالون",
};

const TS_FMT = new Intl.DateTimeFormat("en-CA", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Asia/Riyadh",
});

interface MsgRow {
  role: string;
  content: string | null;
  message_type: string | null;
  created_at: string;
}

/**
 * Returns null when the model isn't configured or there's nothing to read —
 * the caller turns that into a clear "not available" rather than an error.
 */
export async function analyzeCustomer(
  phone: string
): Promise<CustomerAnalysisResult | null> {
  if (!isBotConfigured()) return null;

  const admin = getAdminSupabaseClient();
  const national = normalizePhone(phone);

  const { data: conversation } = await admin
    .from("conversations")
    .select("id")
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .ilike("customer_phone", `%${national}%`)
    .order("last_message_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const conversationId = (conversation?.id as string) ?? null;

  const [messages, rekaz] = await Promise.all([
    conversationId ? fetchMessages(conversationId) : Promise.resolve([]),
    fetchCustomerReservations(phone).catch(() => null),
  ]);

  // Nothing to analyse — no thread and no bookings.
  if (messages.length === 0 && !(rekaz && rekaz.reservations.length)) {
    return null;
  }

  const transcript = messages
    .filter((m) => m.role !== "system")
    .map((m) => {
      const who = ROLE_LABEL[m.role] ?? m.role;
      const when = TS_FMT.format(new Date(m.created_at));
      const body =
        m.content?.trim()?.slice(0, MAX_MESSAGE_CHARS) ||
        (m.message_type && m.message_type !== "text" ? `[${m.message_type}]` : "[فارغة]");
      return `[${who} · ${when}] ${body}`;
    })
    .join("\n");

  const bookingContext = rekaz
    ? [
        `عدد الحجوزات: ${rekaz.reservations.length}`,
        `إجمالي الإنفاق: ${rekaz.revenue.net} ر.س`,
        `حجوزات ملغاة: ${rekaz.reservations.filter((r) => r.status === "Cancelled").length}`,
        rekaz.reservations.length
          ? `الخدمات: ${[...new Set(rekaz.reservations.map((r) => r.service).filter(Boolean))]
              .slice(0, 12)
              .join("، ")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n")
    : "لا توجد بيانات حجوزات.";

  try {
    const { object } = await generateObject({
      model: googleAI(MODEL),
      schema: jsonSchema<CustomerAnalysis>(ANALYSIS_SCHEMA),
      system: SYSTEM_PROMPT,
      prompt: [
        "بيانات حجوزات الزبونة من نظام ركاز:",
        bookingContext,
        "",
        "محادثة واتساب بين الزبونة وفريق الصالون (من الأقدم إلى الأحدث):",
        transcript || "(لا توجد رسائل)",
      ].join("\n"),
    });
    return {
      ...object,
      basis: {
        messages: messages.filter((m) => m.role !== "system").length,
        bookings: rekaz?.reservations.length ?? 0,
        conversationId,
      },
    };
  } catch (e) {
    console.error("[customer-analysis] generate failed", e instanceof Error ? e.message : e);
    throw new Error("تعذّر تحليل المحادثة");
  }
}

const SYSTEM_PROMPT = [
  "أنتِ محلّلة تجربة عملاء لمركز كيارا سبا (صالون نسائي في السعودية).",
  "مهمتك: تحليل محادثة واتساب بين الزبونة وفريق الصالون لتقييم:",
  "١) مدى رضا الزبونة، ٢) جودة تواصل الموظفات معها، ٣) كيف يمكن رفع رضاها.",
  "اعتمدي فقط على المحادثة وبيانات الحجوزات المعطاة — لا تختلقي أي معلومة غير موجودة.",
  "كوني محدّدة وأشيري إلى ما حدث فعلًا (ردود متأخرة، أسئلة بلا إجابة، شكاوى، ثناء، وعود).",
  "اكتبي كل الحقول النصية بالعربية بأسلوب مهني وموجز.",
  "إذا كانت المحادثة قصيرة أو غير كافية للحكم، اخفضي الدرجات واذكري ذلك في الملخص.",
].join(" ");

async function fetchMessages(conversationId: string): Promise<MsgRow[]> {
  const { data } = await getAdminSupabaseClient()
    .from("messages")
    .select("role, content, message_type, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(MAX_MESSAGES);
  // Fetched newest-first for the cap; the model reads oldest-first.
  return ((data ?? []) as MsgRow[]).reverse();
}
