import { generateObject, jsonSchema } from "ai";
import type { JSONSchema7 } from "@ai-sdk/provider";

import { googleAI, isBotConfigured } from "@/lib/bot/knowledge";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { KIARA_RESTAURANT_ID } from "@/lib/tenant";
import {
  OPERATIONS_TIME_ZONE,
  type OperationsReportInput,
  validateOperationsReportInput,
} from "@/lib/operations-report";

const MODEL = process.env.KIARA_BOT_MODEL || "gemini-3.6-flash";
const MAX_MESSAGES = 500;
const MAX_MESSAGE_CHARS = 400;

export type CustomerServiceAgentAnalysis = {
  score: number;
  summary: string;
  strengths: string[];
  improvements: string[];
  repeatedPatterns: string[];
  risks: string[];
  recommendations: string[];
  basis: { conversations: number; messages: number; agentReplies: number };
};

const SCHEMA: JSONSchema7 = {
  type: "object",
  additionalProperties: false,
  required: ["score", "summary", "strengths", "improvements", "repeatedPatterns", "risks", "recommendations"],
  properties: {
    score: { type: "integer", minimum: 0, maximum: 100 },
    summary: { type: "string" },
    strengths: { type: "array", items: { type: "string" } },
    improvements: { type: "array", items: { type: "string" } },
    repeatedPatterns: { type: "array", items: { type: "string" } },
    risks: { type: "array", items: { type: "string" } },
    recommendations: { type: "array", items: { type: "string" } },
  },
};

type MessageRow = {
  conversation_id: string;
  role: "customer" | "agent" | "system";
  sender_team_member_id: string | null;
  content: string | null;
  message_type: string | null;
  created_at: string;
};

function boundary(day: string, time: string) {
  return `${day}T${time}:00+03:00`;
}

function minuteOfDay(iso: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: OPERATIONS_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  return Number(parts.find((part) => part.type === "hour")?.value ?? 0) * 60 +
    Number(parts.find((part) => part.type === "minute")?.value ?? 0);
}

function timeMinutes(value: string) {
  const [hour = 0, minute = 0] = value.split(":").map(Number);
  return hour * 60 + minute;
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

  const rangeStart = boundary(input.from, "00:00");
  const rangeEnd = boundary(input.to, "23:59");
  const startMinute = timeMinutes(input.startTime);
  const endMinute = timeMinutes(input.endTime);
  const { data: ownRows, error: ownError } = await admin
    .from("messages")
    .select("conversation_id, role, sender_team_member_id, content, message_type, created_at, conversations!inner(restaurant_id)")
    .eq("conversations.restaurant_id", KIARA_RESTAURANT_ID)
    .eq("sender_team_member_id", personId)
    .eq("role", "agent")
    .gte("created_at", rangeStart)
    .lte("created_at", rangeEnd)
    .order("created_at", { ascending: false })
    .limit(MAX_MESSAGES);
  if (ownError) throw new Error(ownError.message);
  const own = ((ownRows ?? []) as MessageRow[]).filter((row) => {
    const minute = minuteOfDay(row.created_at);
    return minute >= startMinute && minute < endMinute;
  });
  const conversationIds = [...new Set(own.map((row) => row.conversation_id))];
  if (!conversationIds.length) return null;

  const { data: contextRows, error: contextError } = await admin
    .from("messages")
    .select("conversation_id, role, sender_team_member_id, content, message_type, created_at")
    .in("conversation_id", conversationIds)
    .gte("created_at", rangeStart)
    .lte("created_at", rangeEnd)
    .order("created_at", { ascending: false })
    .limit(MAX_MESSAGES);
  if (contextError) throw new Error(contextError.message);
  const context = ((contextRows ?? []) as MessageRow[]).reverse();
  const transcript = context.map((row) => {
    const speaker = row.role === "customer"
      ? "العميلة"
      : row.sender_team_member_id === personId
        ? "الموظفة محل التحليل"
        : row.role === "agent"
          ? "موظفة أخرى"
          : "النظام";
    const body = row.content?.trim().slice(0, MAX_MESSAGE_CHARS) || `[${row.message_type || "رسالة"}]`;
    return `[محادثة ${row.conversation_id.slice(0, 8)} · ${speaker}] ${body}`;
  }).join("\n");

  const { object } = await generateObject({
    model: googleAI(MODEL),
    schema: jsonSchema<Omit<CustomerServiceAgentAnalysis, "basis">>(SCHEMA),
    system: [
      "أنتِ مديرة جودة لخدمة العملاء في كيارا سبا.",
      "حللي فقط سلوك الموظفة المحددة في المحادثات المعطاة: الوضوح، التعاطف، حل الطلب، المتابعة، والدقة.",
      "لا تنسبي رسائل الموظفات الأخريات إليها، ولا تختلقي وقائع أو نوايا.",
      "اكتبي بالعربية المهنية وبنقاط قصيرة قابلة للتنفيذ، واذكري أن الدليل محدود عندما تكون العينة صغيرة.",
    ].join(" "),
    prompt: `الموظفة: ${String(member.full_name || "موظفة خدمة العملاء")}\nالفترة: ${input.from} إلى ${input.to}\n\n${transcript}`,
  });

  return {
    ...object,
    basis: {
      conversations: conversationIds.length,
      messages: context.length,
      agentReplies: own.length,
    },
  };
}
