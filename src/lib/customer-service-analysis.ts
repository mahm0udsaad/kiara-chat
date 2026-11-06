/**
 * The owner's review of one customer-service employee over a period.
 *
 * Two halves. The numbers (reply speed, customers left waiting, how she
 * compares with the team) are computed from the messages and never asked of
 * the model. The model then reads her chats — grouped per chat, timestamped,
 * with the bot and templates labelled apart from her — and returns scored
 * behaviours, specific incidents with her exact words, good examples, and
 * what the owner should do next. Every incident points at a real chat so the
 * owner can open it before acting, and a quote the model did not take
 * verbatim from her messages is dropped.
 */
import { generateObject, jsonSchema } from "ai";
import type { JSONSchema7 } from "@ai-sdk/provider";

import { googleAI, isBotConfigured } from "@/lib/bot/knowledge";
import { isGroupConversation } from "@/lib/conversation-meta";
import {
  type AnalysisMessage,
  type BookingOutcomes,
  type BookingRecord,
  formatConversation,
  type HandledChat,
  measureBookingOutcomes,
  measureReplySpeed,
  type SheetOutcome,
  SLOW_REPLY_MINUTES,
  verifyQuote,
} from "@/lib/customer-service-analysis-facts";
import { canonicalPhone, normalizePhone } from "@/lib/phone";
import { normalizeStaffName } from "@/lib/rekaz-booking-credit";
import { getCustomerServiceReport, type CustomerServiceEmployee } from "@/lib/customer-service-report";
import {
  OPERATIONS_TIME_ZONE,
  type OperationsReportInput,
  validateOperationsReportInput,
} from "@/lib/operations-report";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { KIARA_RESTAURANT_ID } from "@/lib/tenant";
import type { Conversation } from "@/lib/types";

const MODEL = process.env.KIARA_BOT_MODEL || "gemini-3.6-flash";
const PAGE_SIZE = 1_000;
const MAX_PAGES = 5;
const ID_BATCH = 150;
/** Chats the model reads; the rest still count in the numbers. */
const MAX_CONVERSATIONS = 40;
const MAX_MESSAGES_PER_CONVERSATION = 60;
const MAX_MESSAGE_CHARS = 350;
/** Rough cap on what the model is sent, so a busy month stays inside the deadline. */
const MAX_TRANSCRIPT_CHARS = 140_000;
const REPORT_TIMEOUT_MS = 15_000;
const MODEL_TIMEOUT_MS = 95_000;
const EXCLUDED_CONVERSATION_NAMES = new Set(["بوت ركاز"]);

export type AgentVerdict = "excellent" | "good" | "needs_coaching" | "needs_intervention";
export type AgentDimensionKey =
  | "responsiveness"
  | "clarity"
  | "courtesy"
  | "resolution"
  | "follow_up"
  | "accuracy"
  | "sales";
export type AgentIncidentSeverity = "high" | "medium" | "low";
export type AgentIncidentCategory =
  | "slow_reply"
  | "no_reply"
  | "wrong_info"
  | "tone"
  | "unresolved"
  | "broken_promise"
  | "missed_booking"
  | "policy"
  | "other";

export type CustomerServiceAgentAnalysis = {
  score: number;
  verdict: AgentVerdict;
  summary: string;
  dimensions: {
    key: AgentDimensionKey;
    score: number;
    confidence: "low" | "medium" | "high";
    finding: string;
  }[];
  incidents: {
    conversationId: string;
    customerName: string | null;
    severity: AgentIncidentSeverity;
    category: AgentIncidentCategory;
    whatHappened: string;
    /** Her exact words, or null when the model's quote could not be found. */
    quote: string | null;
    impact: string;
    betterResponse: string;
  }[];
  goodExamples: {
    conversationId: string;
    customerName: string | null;
    whatHappened: string;
    quote: string | null;
  }[];
  ownerActions: { priority: "now" | "this_week" | "ongoing"; action: string; reason: string }[];
  /** What to say to her in a one-to-one, in order. */
  talkingPoints: string[];
  evidenceNote: string;
  /** The AI's read of why chats did or did not become bookings. */
  conversionInsight: string;
  lostBookingReasons: string[];
  /** Counted from Rekaz and the actions sheet, never by the model. */
  bookings: Omit<BookingOutcomes, "bookedByConversation">;
  facts: {
    measuredReplies: number;
    medianReplyMinutes: number | null;
    p90ReplyMinutes: number | null;
    slowReplies: number;
    slowReplyMinutes: number;
    leftWaiting: { conversationId: string; customerName: string | null; waitingSince: string }[];
    /** Her figure beside the team's average for the same period; null when unavailable. */
    comparison: {
      key: "first_response_minutes" | "booking_rate" | "resolved_share" | "replies_per_chat";
      her: number | null;
      team: number | null;
    }[];
  };
  // Kept so app builds from before this shape still render a review.
  strengths: string[];
  improvements: string[];
  repeatedPatterns: string[];
  risks: string[];
  recommendations: string[];
  basis: {
    conversations: number;
    conversationsReviewed: number;
    messages: number;
    agentReplies: number;
  };
};

type ModelOutput = {
  score: number;
  verdict: AgentVerdict;
  summary: string;
  dimensions: CustomerServiceAgentAnalysis["dimensions"];
  strengths: string[];
  improvements: string[];
  repeatedPatterns: string[];
  risks: string[];
  incidents: (Omit<CustomerServiceAgentAnalysis["incidents"][number], "conversationId" | "customerName"> & {
    ref: string;
  })[];
  goodExamples: { ref: string; whatHappened: string; quote: string }[];
  ownerActions: CustomerServiceAgentAnalysis["ownerActions"];
  talkingPoints: string[];
  evidenceNote: string;
  conversionInsight: string;
  lostBookingReasons: string[];
};

const stringList = (description: string): JSONSchema7 => ({
  type: "array",
  items: { type: "string" },
  description,
});

const SCHEMA: JSONSchema7 = {
  type: "object",
  additionalProperties: false,
  required: [
    "score",
    "verdict",
    "summary",
    "dimensions",
    "strengths",
    "improvements",
    "repeatedPatterns",
    "risks",
    "incidents",
    "goodExamples",
    "ownerActions",
    "talkingPoints",
    "evidenceNote",
    "conversionInsight",
    "lostBookingReasons",
  ],
  properties: {
    score: { type: "integer", minimum: 0, maximum: 100 },
    verdict: {
      type: "string",
      enum: ["excellent", "good", "needs_coaching", "needs_intervention"],
      description:
        "excellent: قدوة للفريق. good: جيدة مع ملاحظات بسيطة. needs_coaching: أخطاء متكررة تحتاج تدريبًا. needs_intervention: أخطاء تضر العميلات أو السمعة وتحتاج تدخلًا فوريًا.",
    },
    summary: {
      type: "string",
      description: "ثلاث إلى أربع جمل للمالكة: الحكم العام، أهم ما يميزها، وأخطر ما يجب معالجته.",
    },
    dimensions: {
      type: "array",
      description: "قيّمي كل بُعد من الأبعاد السبعة مرة واحدة.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "score", "confidence", "finding"],
        properties: {
          key: {
            type: "string",
            enum: ["responsiveness", "clarity", "courtesy", "resolution", "follow_up", "accuracy", "sales"],
            description:
              "responsiveness سرعة الاستجابة، clarity وضوح الرد، courtesy اللباقة والتعاطف، resolution حل طلب العميلة، follow_up المتابعة وعدم ترك العميلة، accuracy دقة المعلومات والأسعار والمواعيد، sales تحويل الاستفسار إلى حجز.",
          },
          score: { type: "integer", minimum: 0, maximum: 100 },
          confidence: {
            type: "string",
            enum: ["low", "medium", "high"],
            description: "low إذا كانت الأدلة على هذا البعد قليلة.",
          },
          finding: { type: "string", description: "جملة واحدة محددة مبنية على ما حدث فعلًا." },
        },
      },
    },
    strengths: stringList("نقاط القوة، قصيرة ومحددة."),
    improvements: stringList("ما يجب أن تحسّنه، قصير ومحدد."),
    repeatedPatterns: stringList("سلوك تكرر في أكثر من محادثة، مع ذكر عدد المرات تقريبًا."),
    risks: stringList("ما قد يكلف الصالون عميلة أو سمعة إن استمر."),
    incidents: {
      type: "array",
      description:
        "حتى ١٢ موقفًا محددًا يستحق أن تراجعه المالكة، الأخطر أولًا. لا تذكري موقفًا لا يوجد في المحادثات.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["ref", "severity", "category", "whatHappened", "quote", "impact", "betterResponse"],
        properties: {
          ref: { type: "string", description: "رمز المحادثة كما ورد في العنوان، مثل م3." },
          severity: { type: "string", enum: ["high", "medium", "low"] },
          category: {
            type: "string",
            enum: [
              "slow_reply",
              "no_reply",
              "wrong_info",
              "tone",
              "unresolved",
              "broken_promise",
              "missed_booking",
              "policy",
              "other",
            ],
          },
          whatHappened: { type: "string", description: "ماذا حدث، بإيجاز ومع الوقت إن كان مهمًا." },
          quote: {
            type: "string",
            description:
              "نص حرفي قصير من رسالة الموظفة نفسها في هذه المحادثة، منسوخ كما هو. اتركيه فارغًا إن كان الخطأ غياب الرد.",
          },
          impact: { type: "string", description: "أثره على العميلة أو الصالون." },
          betterResponse: { type: "string", description: "ما كان يجب أن تفعله أو تكتبه بدلًا من ذلك." },
        },
      },
    },
    goodExamples: {
      type: "array",
      description: "حتى ٦ مواقف أحسنت فيها، تصلح للثناء أو لتدريب بقية الفريق.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["ref", "whatHappened", "quote"],
        properties: {
          ref: { type: "string" },
          whatHappened: { type: "string" },
          quote: { type: "string", description: "نص حرفي قصير من رسالتها، أو فارغ." },
        },
      },
    },
    ownerActions: {
      type: "array",
      description: "ما تفعله المالكة مع هذه الموظفة، الأهم أولًا (٣ إلى ٦ خطوات).",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["priority", "action", "reason"],
        properties: {
          priority: {
            type: "string",
            enum: ["now", "this_week", "ongoing"],
            description: "now اليوم، this_week خلال الأسبوع، ongoing متابعة مستمرة.",
          },
          action: { type: "string", description: "إجراء محدد قابل للتنفيذ (تدريب، تنبيه، مراجعة محادثة معها، ثناء، هدف رقمي)." },
          reason: { type: "string", description: "لماذا، مع الإشارة إلى الدليل." },
        },
      },
    },
    talkingPoints: stringList(
      "نقاط تقولها المالكة للموظفة في جلسة فردية، بأسلوب محترم ومباشر، تبدأ بالإيجابي ثم الملاحظات ثم الهدف.",
    ),
    conversionInsight: {
      type: "string",
      description:
        "جملتان أو ثلاث عن تحويل المحادثات إلى حجوزات وعودة العميلات، مبنية على أرقام الحجوزات في الحقائق وعلى ما في المحادثات: ما الذي ساعد على الحجز وما الذي أضاعه.",
    },
    lostBookingReasons: stringList(
      "أسباب عدم الحجز كما تظهر في المحادثات المعلّمة «لم تتحول لحجز»، مع عدد تقريبي لكل سبب (مثل: السعر، لا يوجد موعد مناسب، لم تتابعها الموظفة، العميلة لم ترد).",
    ),
    evidenceNote: {
      type: "string",
      description: "جملة عن حدود الدليل: عدد المحادثات، وما لا يمكن الحكم عليه (رسائل صوتية، مكالمات، عينة صغيرة).",
    },
  },
};

const SYSTEM_PROMPT = [
  "أنتِ مديرة جودة خدمة العملاء في كيارا سبا (صالون نسائي في السعودية) وتكتبين تقييمًا لمالكة الصالون عن موظفة واحدة.",
  "الهدف أن تستطيع المالكة اتخاذ قرار: ثناء، تدريب، تنبيه، أو تدخل. لذلك كوني محددة واستشهدي بمحادثات بعينها.",
  "قيّمي فقط رسائل «الموظفة». رسائل «موظفة أخرى» و«البوت» و«رسالة آلية» للسياق فقط ولا تُنسب إليها.",
  "أرقام سرعة الرد والحجوزات في قسم الحقائق محسوبة بدقة من النظام وركاز؛ اعتمدي عليها ولا تناقضيها ولا تخترعي أرقامًا غيرها.",
  "كل محادثة معلّمة في عنوانها بنتيجتها في ركاز (تحوّلت لحجز / حُجزت ثم أُلغيت / لم تتحول لحجز)؛ استعملي ذلك لتفسير أسباب الحجز وعدمه وفي بُعد تحويل الاستفسار لحجز.",
  "الرسائل بين أقواس مثل [audio] أو [image] لا تعرفين محتواها، فلا تحكمي عليها.",
  "لا تختلقي وقائع أو نوايا أو أرقامًا. إذا كانت العينة صغيرة فاخفضي درجة الثقة واذكري ذلك.",
  "الاقتباسات يجب أن تكون منسوخة حرفيًا من رسائل الموظفة؛ لا تعيدي صياغتها.",
  "اكتبي بالعربية المهنية الموجزة، وخاطبي المالكة بصيغة المؤنث.",
].join(" ");

function boundary(day: string, time: string) {
  return `${day}T${time}:00+03:00`;
}

const minuteParts = new Intl.DateTimeFormat("en-GB", {
  timeZone: OPERATIONS_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
function minuteOfDay(iso: string) {
  const parts = minuteParts.formatToParts(new Date(iso));
  return (
    Number(parts.find((part) => part.type === "hour")?.value ?? 0) * 60 +
    Number(parts.find((part) => part.type === "minute")?.value ?? 0)
  );
}

function timeMinutes(value: string) {
  const [hour = 0, minute = 0] = value.split(":").map(Number);
  return hour * 60 + minute;
}

const stampFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: OPERATIONS_TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const stamp = (iso: string) => stampFormat.format(new Date(iso));

async function pagedRows<T>(build: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>) {
  const rows: T[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { data, error } = await build(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as T[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return rows;
}

function chunks<T>(items: T[], size: number) {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
  return out;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise.catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

function teamComparison(
  report: Awaited<ReturnType<typeof getCustomerServiceReport>> | null,
  personId: string,
): CustomerServiceAgentAnalysis["facts"]["comparison"] {
  if (!report) return [];
  const her = report.employees.find((employee) => employee.teamMemberId === personId);
  if (!her) return [];
  const peers = report.employees.filter((employee) => employee.handledConversations > 0);
  const pick: Record<
    CustomerServiceAgentAnalysis["facts"]["comparison"][number]["key"],
    (employee: CustomerServiceEmployee) => number | null
  > = {
    first_response_minutes: (employee) => employee.averageFirstResponseMinutes,
    booking_rate: (employee) =>
      employee.chatToBookingRate === null ? null : Math.round(employee.chatToBookingRate * 100),
    resolved_share: (employee) =>
      employee.handledConversations
        ? Math.round((employee.resolvedConversations / employee.handledConversations) * 100)
        : null,
    replies_per_chat: (employee) =>
      employee.handledConversations
        ? Math.round((employee.messagesSent / employee.handledConversations) * 10) / 10
        : null,
  };
  return (Object.keys(pick) as (keyof typeof pick)[]).map((key) => {
    const values = peers.map(pick[key]).filter((value): value is number => value !== null);
    const team = values.length
      ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10
      : null;
    return { key, her: pick[key](her), team };
  });
}

type ConversationRow = Pick<Conversation, "id" | "customer_name" | "customer_phone" | "metadata">;

const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: OPERATIONS_TIME_ZONE });

function sheetOutcomeOf(conversation: ConversationRow): SheetOutcome {
  const value = (conversation.metadata as { contact_outcome?: unknown } | null)?.contact_outcome;
  return value === "booked" || value === "not_booked" || value === "no_reply" ? value : null;
}

type ReservationRow = {
  payload: {
    createdBy?: string | null;
    customerPhone?: string | null;
    bookedAt?: string | null;
    status?: string | null;
    order?: { id?: string | null } | null;
  } | null;
  customer_phone: string | null;
  first_seen_at: string | null;
  removed_at: string | null;
};

/**
 * Every Rekaz booking for these customers, whenever made — repeat bookings
 * need the history, not just the period. Rekaz stores the number as +E.164,
 * so each phone is asked for in both forms.
 */
async function bookingsFor(
  admin: ReturnType<typeof getAdminSupabaseClient>,
  phones: string[],
  herName: string,
): Promise<BookingRecord[]> {
  const variants = [
    ...new Set(
      phones.flatMap((phone) => {
        const canonical = canonicalPhone(phone);
        return canonical && canonical !== phone ? [phone, canonical] : [phone];
      }).filter(Boolean),
    ),
  ];
  const her = normalizeStaffName(herName);
  const out: BookingRecord[] = [];
  for (const batch of chunks(variants, ID_BATCH)) {
    const rows = await pagedRows<ReservationRow>((from, to) =>
      admin
        .from("rekaz_reservations")
        .select("payload, customer_phone, first_seen_at, removed_at")
        .eq("restaurant_id", KIARA_RESTAURANT_ID)
        .in("customer_phone", batch)
        .order("first_seen_at", { ascending: true })
        .range(from, to),
    );
    for (const row of rows) {
      const phone = normalizePhone(String(row.payload?.customerPhone ?? row.customer_phone ?? ""));
      const bookedAtMs = Date.parse(row.payload?.bookedAt ?? row.first_seen_at ?? "");
      const createdBy = normalizeStaffName(row.payload?.createdBy);
      out.push({
        phone,
        bookedAtMs,
        orderKey: row.payload?.order?.id ?? `${phone}:${bookedAtMs}`,
        live: !row.removed_at && row.payload?.status !== "Cancelled",
        // An empty createdBy is Rekaz's marker for a booking made online.
        bookedBy: !createdBy ? "online" : her && createdBy === her ? "her" : "colleague",
      });
    }
  }
  return out;
}

export async function analyzeCustomerServiceAgent(
  personId: string,
  raw: OperationsReportInput,
): Promise<CustomerServiceAgentAnalysis | null> {
  if (!isBotConfigured()) return null;
  const input = validateOperationsReportInput(raw);
  const admin = getAdminSupabaseClient();
  const { data: member } = await admin
    .from("team_members")
    .select("id, full_name")
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .eq("id", personId)
    .maybeSingle();
  if (!member) return null;

  // Started now, awaited after the model's inputs are ready. A slow report
  // only costs the team comparison, never the review.
  const reportPromise = withTimeout(getCustomerServiceReport(raw), REPORT_TIMEOUT_MS);

  const rangeStart = boundary(input.from, "00:00");
  const rangeEnd = boundary(input.to, "23:59");
  const startMinute = timeMinutes(input.startTime);
  const endMinute = timeMinutes(input.endTime);
  const inShift = (iso: string) => {
    const minute = minuteOfDay(iso);
    return minute >= startMinute && minute <= endMinute;
  };

  const ownRows = await pagedRows<{ conversation_id: string; created_at: string }>((from, to) =>
    admin
      .from("messages")
      .select("conversation_id, created_at, conversations!inner(restaurant_id)")
      .eq("conversations.restaurant_id", KIARA_RESTAURANT_ID)
      .eq("sender_team_member_id", personId)
      .eq("role", "agent")
      .gte("created_at", rangeStart)
      .lte("created_at", rangeEnd)
      .order("created_at", { ascending: true })
      .range(from, to),
  );
  const own = ownRows.filter((row) => inShift(row.created_at));
  const candidateIds = [...new Set(own.map((row) => row.conversation_id))];
  if (!candidateIds.length) return null;

  const conversations = new Map<string, ConversationRow>();
  for (const batch of chunks(candidateIds, ID_BATCH)) {
    const { data, error } = await admin
      .from("conversations")
      .select("id, customer_name, customer_phone, metadata")
      .in("id", batch);
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as ConversationRow[]) {
      if (isGroupConversation(row)) continue;
      if (row.customer_name && EXCLUDED_CONVERSATION_NAMES.has(row.customer_name)) continue;
      conversations.set(row.id, row);
    }
  }
  const conversationIds = candidateIds.filter((id) => conversations.has(id));
  if (!conversationIds.length) return null;

  const messages: AnalysisMessage[] = [];
  for (const batch of chunks(conversationIds, ID_BATCH)) {
    messages.push(
      ...(await pagedRows<AnalysisMessage>((from, to) =>
        admin
          .from("messages")
          .select("id, conversation_id, role, sender_team_member_id, content, message_type, metadata, created_at")
          .in("conversation_id", batch)
          .gte("created_at", rangeStart)
          .lte("created_at", rangeEnd)
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to),
      )),
    );
  }

  const periodEndMs = Math.min(Date.now(), Date.parse(rangeEnd));
  const speed = measureReplySpeed(messages, personId, inShift, periodEndMs);

  // Her whole history in these chats, to tell a one-off from a customer she
  // has looked after on several separate days.
  const historyRows: { conversation_id: string; created_at: string }[] = [];
  for (const batch of chunks(conversationIds, ID_BATCH)) {
    historyRows.push(
      ...(await pagedRows<{ conversation_id: string; created_at: string }>((from, to) =>
        admin
          .from("messages")
          .select("conversation_id, created_at")
          .in("conversation_id", batch)
          .eq("sender_team_member_id", personId)
          .eq("role", "agent")
          .order("created_at", { ascending: true })
          .range(from, to),
      )),
    );
  }
  const history = new Map<string, { firstMs: number; days: Set<string> }>();
  for (const row of historyRows) {
    const entry = history.get(row.conversation_id) ?? { firstMs: Infinity, days: new Set<string>() };
    entry.firstMs = Math.min(entry.firstMs, Date.parse(row.created_at));
    entry.days.add(dayKey.format(new Date(row.created_at)));
    history.set(row.conversation_id, entry);
  }
  const firstInPeriod = new Map<string, number>();
  for (const row of own) {
    const ms = Date.parse(row.created_at);
    if (!(firstInPeriod.get(row.conversation_id)! <= ms)) firstInPeriod.set(row.conversation_id, ms);
  }
  const handledChats: HandledChat[] = conversationIds.map((id) => {
    const conversation = conversations.get(id)!;
    const firstMs = firstInPeriod.get(id) ?? Date.parse(rangeStart);
    return {
      conversationId: id,
      customerName: conversation.customer_name ?? null,
      phone: normalizePhone(conversation.customer_phone ?? ""),
      firstReplyInPeriodMs: firstMs,
      firstReplyEverMs: Math.min(history.get(id)?.firstMs ?? firstMs, firstMs),
      handledDays: history.get(id)?.days.size ?? 1,
      sheetOutcome: sheetOutcomeOf(conversation),
    };
  });
  const bookingRecords = await bookingsFor(
    admin,
    [...new Set(conversationIds.map((id) => conversations.get(id)!.customer_phone).filter(Boolean) as string[])],
    String(member.full_name ?? ""),
  );
  const { bookedByConversation, ...bookingOutcomes } = measureBookingOutcomes(
    handledChats,
    bookingRecords,
    Date.parse(rangeEnd),
    Date.now(),
  );
  const outcomeTag = {
    booked: "(تحوّلت لحجز)",
    cancelled: "(حُجزت ثم أُلغيت)",
    not_booked: "(لم تتحول لحجز)",
  } as const;

  const byConversation = new Map<string, AnalysisMessage[]>();
  for (const row of messages) {
    const bucket = byConversation.get(row.conversation_id) ?? [];
    bucket.push(row);
    byConversation.set(row.conversation_id, bucket);
  }
  const herRepliesIn = (id: string) =>
    (byConversation.get(id) ?? []).filter((row) => row.sender_team_member_id === personId && row.role === "agent").length;
  const waitingIds = new Set(speed.leftWaiting.map((item) => item.conversationId));

  // Read first what most needs reading: chats left waiting, then the longest
  // waits, then where she did the most work.
  const ranked = [...conversationIds].sort((a, b) => {
    const waiting = Number(waitingIds.has(b)) - Number(waitingIds.has(a));
    if (waiting) return waiting;
    const slowA = (speed.longestByConversation.get(a)?.minutes ?? 0) > SLOW_REPLY_MINUTES;
    const slowB = (speed.longestByConversation.get(b)?.minutes ?? 0) > SLOW_REPLY_MINUTES;
    if (slowA !== slowB) return Number(slowB) - Number(slowA);
    return herRepliesIn(b) - herRepliesIn(a);
  });

  const refs = new Map<string, string>();
  const blocks: string[] = [];
  let budget = MAX_TRANSCRIPT_CHARS;
  for (const id of ranked) {
    if (refs.size >= MAX_CONVERSATIONS) break;
    const conversation = conversations.get(id)!;
    const ref = `م${refs.size + 1}`;
    const title = [
      conversation.customer_name || "عميلة",
      outcomeTag[bookedByConversation.get(id) ?? "not_booked"],
      (history.get(id)?.days.size ?? 0) >= 2 ? `(تعاملت معها في ${history.get(id)!.days.size} أيام مختلفة)` : "",
      waitingIds.has(id) ? "(تُركت العميلة بلا رد في نهاية الفترة)" : "",
    ]
      .filter(Boolean)
      .join(" ");
    const block = formatConversation(
      ref,
      title,
      (byConversation.get(id) ?? []).slice(-MAX_MESSAGES_PER_CONVERSATION),
      personId,
      stamp,
      MAX_MESSAGE_CHARS,
    );
    if (block.length > budget && refs.size > 0) break;
    budget -= block.length;
    refs.set(ref, id);
    blocks.push(block);
  }

  const report = await reportPromise;
  const comparison = teamComparison(report, personId);
  const leftWaiting = speed.leftWaiting.map((item) => ({
    ...item,
    customerName: conversations.get(item.conversationId)?.customer_name ?? null,
  }));

  const factLines = [
    `الموظفة: ${String(member.full_name || "موظفة خدمة العملاء")}`,
    `الفترة: ${input.from} إلى ${input.to}، ساعات العمل ${input.startTime}–${input.endTime}`,
    `محادثات ردّت فيها: ${conversationIds.length} (المعروض أدناه ${refs.size})`,
    `ردودها في ساعات العمل: ${own.length}`,
    `ردود قيس زمنها: ${speed.waits.length}، الوسيط ${speed.medianMinutes ?? "—"} دقيقة، ٩٠٪ خلال ${speed.p90Minutes ?? "—"} دقيقة`,
    `ردود تأخرت أكثر من ${SLOW_REPLY_MINUTES} دقيقة: ${speed.slowReplies}`,
    `محادثات تركت فيها العميلة بلا رد: ${leftWaiting.length}`,
    `تحوّلت لحجز في ركاز: ${bookingOutcomes.conversion.booked} من ${bookingOutcomes.conversion.handled} (${bookingOutcomes.conversion.rate ?? "—"}٪) — أدخلتها هي ${bookingOutcomes.conversion.bookedByHer}، موظفة أخرى ${bookingOutcomes.conversion.bookedByColleague}، العميلة أونلاين ${bookingOutcomes.conversion.bookedOnline}`,
    `لم تتحول لحجز: ${bookingOutcomes.conversion.notBooked} (منها حُجزت ثم أُلغيت ${bookingOutcomes.conversion.cancelled}؛ مسجلة «لم يتم الحجز» ${bookingOutcomes.conversion.notBookedMarked.notBooked}، «لم ترد» ${bookingOutcomes.conversion.notBookedMarked.noReply}، بلا نتيجة مسجلة ${bookingOutcomes.conversion.notBookedMarked.unmarked})`,
    `عميلات تعاملت معهن في يومين مختلفين أو أكثر: ${bookingOutcomes.retention.repeatHandled}، منهن حجزن مرتين أو أكثر منذ أول رد لها: ${bookingOutcomes.retention.repeatBookers} (${bookingOutcomes.retention.rate ?? "—"}٪)`,
    ...comparison
      .filter((item) => item.her !== null || item.team !== null)
      .map((item) => {
        const label = {
          first_response_minutes: "متوسط أول رد (دقيقة)",
          booking_rate: "نسبة تحويل المحادثات لحجز (%)",
          resolved_share: "نسبة المحادثات التي أغلقتها (%)",
          replies_per_chat: "ردود لكل محادثة",
        }[item.key];
        return `${label}: هي ${item.her ?? "—"} · متوسط الفريق ${item.team ?? "—"}`;
      }),
  ];

  const { object } = await generateObject({
    model: googleAI(MODEL),
    schema: jsonSchema<ModelOutput>(SCHEMA),
    system: SYSTEM_PROMPT,
    abortSignal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
    prompt: [
      "## الحقائق المحسوبة من النظام",
      ...factLines,
      "",
      "## المحادثات (كل سطر: [اليوم/الشهر الساعة · المتحدث] النص)",
      blocks.join("\n\n"),
    ].join("\n"),
  });

  const resolveRef = (ref: string) => {
    const id = refs.get(ref.trim().replace(/^M/i, "م"));
    return id ? { conversationId: id, customerName: conversations.get(id)?.customer_name ?? null } : null;
  };
  const severityRank: Record<AgentIncidentSeverity, number> = { high: 0, medium: 1, low: 2 };

  const incidents = object.incidents
    .flatMap(({ ref, quote, ...incident }) => {
      const target = resolveRef(ref);
      if (!target) return [];
      return [
        {
          ...target,
          ...incident,
          quote: verifyQuote(quote, byConversation.get(target.conversationId) ?? [], personId),
        },
      ];
    })
    .sort((a, b) => severityRank[a.severity] - severityRank[b.severity])
    .slice(0, 12);

  const goodExamples = object.goodExamples
    .flatMap(({ ref, quote, whatHappened }) => {
      const target = resolveRef(ref);
      if (!target) return [];
      return [
        {
          ...target,
          whatHappened,
          quote: verifyQuote(quote, byConversation.get(target.conversationId) ?? [], personId),
        },
      ];
    })
    .slice(0, 6);

  const seen = new Set<AgentDimensionKey>();
  const dimensions = object.dimensions.filter((dimension) => {
    if (seen.has(dimension.key)) return false;
    seen.add(dimension.key);
    return true;
  });

  return {
    score: object.score,
    verdict: object.verdict,
    summary: object.summary,
    dimensions,
    incidents,
    goodExamples,
    ownerActions: object.ownerActions,
    talkingPoints: object.talkingPoints,
    evidenceNote: object.evidenceNote,
    conversionInsight: object.conversionInsight,
    lostBookingReasons: object.lostBookingReasons,
    bookings: bookingOutcomes,
    facts: {
      measuredReplies: speed.waits.length,
      medianReplyMinutes: speed.medianMinutes,
      p90ReplyMinutes: speed.p90Minutes,
      slowReplies: speed.slowReplies,
      slowReplyMinutes: SLOW_REPLY_MINUTES,
      leftWaiting,
      comparison,
    },
    strengths: object.strengths,
    improvements: object.improvements,
    repeatedPatterns: object.repeatedPatterns,
    risks: object.risks,
    recommendations: object.ownerActions.map((item) => item.action),
    basis: {
      conversations: conversationIds.length,
      conversationsReviewed: refs.size,
      messages: messages.length,
      agentReplies: own.length,
    },
  };
}
