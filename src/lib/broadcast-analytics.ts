/**
 * Broadcast & Campaign Analytics.
 *
 * Calculates performance metrics for any broadcast template:
 *  - Sent & Delivered count
 *  - Read / Seen count (from Meta/Twilio delivery receipts)
 *  - Replied count (inbound messages received from customer after the broadcast)
 *  - Success / Conversion rates
 *  - Detailed customer response feed with message snippet and conversation link
 */

import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { KIARA_RESTAURANT_ID } from "@/lib/tenant";
import { loadAllCustomers, type BroadcastMark, type CustomerRow } from "@/lib/broadcast";
import { templateSpec, isTemplateKey, type TemplateKey } from "@/lib/templates";

export interface CustomerCampaignEvent {
  customerId: string;
  phone: string;
  name: string | null;
  status: "replied" | "read" | "delivered" | "sent" | "failed" | "pending";
  sentAt: string | null;
  readAt: string | null;
  deliveredAt: string | null;
  repliedAt: string | null;
  lastCustomerMessage: string | null;
  conversationId: string | null;
  error?: string | null;
}

export interface BroadcastAnalyticsSummary {
  templateKey: string;
  templateLabel: string;
  templateBody: string;
  totalAudience: number;
  sent: number;
  delivered: number;
  read: number;
  replied: number;
  failed: number;
  pending: number;
  deliveryRate: number; // (delivered / sent) * 100
  readRate: number; // (read / delivered) * 100
  replyRate: number; // (replied / sent) * 100
  overallSuccessRate: number; // combined score
  healthTone: "excellent" | "good" | "moderate" | "low" | "pending";
  healthLabel: string;
}

export interface BroadcastAnalyticsResult {
  summary: BroadcastAnalyticsSummary;
  feed: CustomerCampaignEvent[];
}

const normalizeDigits = (p: string | null | undefined) => (p || "").replace(/\D/g, "");

export async function getBroadcastAnalytics(templateKey: TemplateKey): Promise<BroadcastAnalyticsResult> {
  const admin = getAdminSupabaseClient();
  const allCustomers = await loadAllCustomers();
  const spec = templateSpec(templateKey);

  // Identify marks for this template or aliases (e.g. open_conversation and number_notice)
  const aliasKeys =
    templateKey === "open_conversation" || templateKey === "number_notice"
      ? ["open_conversation", "number_notice"]
      : [templateKey];

  const sentCustomers: {
    customer: CustomerRow;
    mark: BroadcastMark;
    sentTime: number;
    phoneDigits: string;
  }[] = [];

  let failedCount = 0;
  let pendingCount = 0;

  for (const c of allCustomers) {
    const broadcasts = (c.metadata?.broadcasts as Record<string, BroadcastMark>) ?? {};
    let matchedMark: BroadcastMark | null = null;
    for (const k of aliasKeys) {
      if (broadcasts[k]) {
        matchedMark = broadcasts[k];
        break;
      }
    }

    if (matchedMark?.status === "sent") {
      sentCustomers.push({
        customer: c,
        mark: matchedMark,
        sentTime: new Date(matchedMark.at).getTime(),
        phoneDigits: normalizeDigits(c.phone_number),
      });
    } else if (matchedMark?.status === "failed") {
      failedCount += 1;
      pendingCount += 1;
    } else {
      pendingCount += 1;
    }
  }

  // If nobody was sent yet, return clean summary
  if (sentCustomers.length === 0) {
    const summary: BroadcastAnalyticsSummary = {
      templateKey,
      templateLabel: spec.label,
      templateBody: spec.body,
      totalAudience: allCustomers.length,
      sent: 0,
      delivered: 0,
      read: 0,
      replied: 0,
      failed: failedCount,
      pending: pendingCount,
      deliveryRate: 0,
      readRate: 0,
      replyRate: 0,
      overallSuccessRate: 0,
      healthTone: "pending",
      healthLabel: "لم يبدأ الإرسال بعد",
    };
    return { summary, feed: [] };
  }

  // Earliest sent time to filter conversation activity
  const earliestSentIso = new Date(
    Math.min(...sentCustomers.map((s) => s.sentTime))
  ).toISOString();

  // Find conversations for our restaurant
  const customerPhones = sentCustomers.map((s) => s.customer.phone_number).filter(Boolean) as string[];
  
  // Load matching conversations
  const { data: conversationsData } = await admin
    .from("conversations")
    .select("id, customer_phone, last_message_at, updated_at")
    .eq("restaurant_id", KIARA_RESTAURANT_ID);

  const convByDigits = new Map<string, { id: string; last_message_at: string | null }>();
  for (const conv of conversationsData ?? []) {
    const d = normalizeDigits(conv.customer_phone);
    if (d) convByDigits.set(d, conv);
  }

  // Load message delivery statuses and customer replies
  // 1. Check messages with external_message_sid for sent marks
  const sids = sentCustomers.map((s) => s.mark.sid).filter(Boolean) as string[];
  const sidStatusMap = new Map<string, { delivery_status: string; created_at: string }>();

  if (sids.length > 0) {
    const pageSize = 1000;
    for (let i = 0; i < sids.length; i += pageSize) {
      const batch = sids.slice(i, i + pageSize);
      const { data: msgStatuses } = await admin
        .from("messages")
        .select("external_message_sid, delivery_status, created_at")
        .in("external_message_sid", batch);

      for (const m of msgStatuses ?? []) {
        if (m.external_message_sid) {
          sidStatusMap.set(m.external_message_sid, {
            delivery_status: m.delivery_status || "sent",
            created_at: m.created_at,
          });
        }
      }
    }
  }

  // 2. Load inbound customer messages that happened after earliest sent time
  const matchingConvIds = sentCustomers
    .map((s) => convByDigits.get(s.phoneDigits)?.id)
    .filter(Boolean) as string[];

  const repliesByConvId = new Map<
    string,
    { content: string; created_at: string }[]
  >();

  if (matchingConvIds.length > 0) {
    const pageSize = 1000;
    for (let i = 0; i < matchingConvIds.length; i += pageSize) {
      const batch = matchingConvIds.slice(i, i + pageSize);
      const { data: inboundMessages } = await admin
        .from("messages")
        .select("conversation_id, content, created_at")
        .in("conversation_id", batch)
        .eq("role", "customer")
        .gte("created_at", earliestSentIso)
        .order("created_at", { ascending: true });

      for (const msg of inboundMessages ?? []) {
        const list = repliesByConvId.get(msg.conversation_id) ?? [];
        list.push({ content: msg.content || "", created_at: msg.created_at });
        repliesByConvId.set(msg.conversation_id, list);
      }
    }
  }

  // Now aggregate each customer's metrics
  let deliveredCount = 0;
  let readCount = 0;
  let repliedCount = 0;

  const feed: CustomerCampaignEvent[] = [];

  for (const s of sentCustomers) {
    const phone = s.customer.phone_number || "";
    const name = s.customer.full_name || null;
    const sentAt = s.mark.at;
    const conv = convByDigits.get(s.phoneDigits);
    const convId = conv?.id ?? null;

    const sidInfo = s.mark.sid ? sidStatusMap.get(s.mark.sid) : null;
    const rawDeliveryStatus = sidInfo?.delivery_status?.toLowerCase() || "sent";

    const isRead = rawDeliveryStatus === "read";
    const isDelivered = isRead || rawDeliveryStatus === "delivered";

    if (isRead) readCount += 1;
    if (isDelivered) deliveredCount += 1;

    // Check for customer replies after the send timestamp
    let repliedAt: string | null = null;
    let lastCustomerMessage: string | null = null;

    if (convId && repliesByConvId.has(convId)) {
      const convReplies = repliesByConvId.get(convId)!;
      const validReplies = convReplies.filter(
        (r) => new Date(r.created_at).getTime() >= s.sentTime
      );
      if (validReplies.length > 0) {
        repliedCount += 1;
        repliedAt = validReplies[0].created_at;
        lastCustomerMessage = validReplies[validReplies.length - 1].content;
      }
    }

    let itemStatus: CustomerCampaignEvent["status"] = "sent";
    if (repliedAt) {
      itemStatus = "replied";
    } else if (isRead) {
      itemStatus = "read";
    } else if (isDelivered) {
      itemStatus = "delivered";
    }

    feed.push({
      customerId: s.customer.id,
      phone,
      name,
      status: itemStatus,
      sentAt,
      deliveredAt: isDelivered ? (sidInfo?.created_at ?? sentAt) : null,
      readAt: isRead ? (sidInfo?.created_at ?? sentAt) : null,
      repliedAt,
      lastCustomerMessage,
      conversationId: convId,
    });
  }

  // Sort feed: replied first (newest), then read, then delivered, then sent
  feed.sort((a, b) => {
    if (a.repliedAt && !b.repliedAt) return -1;
    if (!a.repliedAt && b.repliedAt) return 1;
    if (a.repliedAt && b.repliedAt) return b.repliedAt.localeCompare(a.repliedAt);
    return (b.sentAt || "").localeCompare(a.sentAt || "");
  });

  const totalSent = sentCustomers.length;
  // If delivery receipts are disabled/pending, treat sent as baseline delivered
  const effectiveDelivered = Math.max(deliveredCount, readCount);
  const deliveryRate = totalSent > 0 ? Math.round((effectiveDelivered / totalSent) * 100) : 0;
  const readRate = effectiveDelivered > 0 ? Math.round((readCount / effectiveDelivered) * 100) : 0;
  const replyRate = totalSent > 0 ? Math.round((repliedCount / totalSent) * 100) : 0;

  // Determine campaign health indicator
  let healthTone: BroadcastAnalyticsSummary["healthTone"] = "moderate";
  let healthLabel = "تفاعل متوسط";

  if (replyRate >= 15 || (readRate >= 60 && replyRate >= 8)) {
    healthTone = "excellent";
    healthLabel = "حملة ناجحة جدًا 🔥 (تفاعل مرتفع)";
  } else if (replyRate >= 7 || readRate >= 40) {
    healthTone = "good";
    healthLabel = "تفاعل جيد جدًا 👍";
  } else if (totalSent > 0 && repliedCount === 0 && readCount === 0) {
    healthTone = "low";
    healthLabel = "بانتظار قراءة وتفاعل العملاء";
  }

  const summary: BroadcastAnalyticsSummary = {
    templateKey,
    templateLabel: spec.label,
    templateBody: spec.body,
    totalAudience: allCustomers.length,
    sent: totalSent,
    delivered: effectiveDelivered,
    read: readCount,
    replied: repliedCount,
    failed: failedCount,
    pending: pendingCount,
    deliveryRate,
    readRate,
    replyRate,
    overallSuccessRate: replyRate,
    healthTone,
    healthLabel,
  };

  return { summary, feed };
}
