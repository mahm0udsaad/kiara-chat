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
import { templateSpec, type TemplateKey } from "@/lib/templates";
import { normalizePhone } from "@/lib/phone";

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

export async function getBroadcastAnalytics(templateKey: TemplateKey): Promise<BroadcastAnalyticsResult> {
  const admin = getAdminSupabaseClient();
  const spec = templateSpec(templateKey);

  // Load all customers
  let allCustomers: CustomerRow[] = [];
  try {
    allCustomers = await loadAllCustomers();
  } catch (err) {
    console.error("[analytics] Failed to load customers:", err);
  }

  // Identify marks for this template or aliases (e.g. open_conversation and number_notice)
  const aliasKeys =
    templateKey === "open_conversation" || templateKey === "number_notice"
      ? ["open_conversation", "number_notice"]
      : [templateKey];

  const sentCustomers: {
    customer: CustomerRow;
    mark: BroadcastMark;
    sentTime: number;
    phoneNormalized: string;
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
        phoneNormalized: normalizePhone(c.phone_number || ""),
      });
    } else if (matchedMark?.status === "failed") {
      failedCount += 1;
      pendingCount += 1;
    } else {
      pendingCount += 1;
    }
  }

  // If nobody was sent yet, return clean empty summary
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

  // Earliest sent time to filter conversation activity (with 1-minute skew tolerance)
  const earliestSentMs = Math.min(...sentCustomers.map((s) => s.sentTime)) - 60000;
  const earliestSentIso = new Date(Math.max(0, earliestSentMs)).toISOString();

  // Load conversations for our restaurant
  const { data: conversationsData } = await admin
    .from("conversations")
    .select("id, customer_phone, last_message_at, last_inbound_at, updated_at")
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .limit(10000);

  const convByPhone = new Map<string, { id: string; last_message_at: string | null; last_inbound_at: string | null }>();

  for (const conv of conversationsData ?? []) {
    const p = normalizePhone(conv.customer_phone);
    if (p) {
      convByPhone.set(p, conv);
    }
  }

  // Load all recent customer inbound messages after earliestSentIso
  const repliesByConvId = new Map<
    string,
    { content: string; created_at: string }[]
  >();

  try {
    const { data: recentInbound } = await admin
      .from("messages")
      .select("conversation_id, content, created_at")
      .eq("role", "customer")
      .gte("created_at", earliestSentIso)
      .order("created_at", { ascending: true })
      .limit(10000);

    for (const msg of recentInbound ?? []) {
      const list = repliesByConvId.get(msg.conversation_id) ?? [];
      list.push({ content: msg.content || "", created_at: msg.created_at });
      repliesByConvId.set(msg.conversation_id, list);
    }
  } catch (err) {
    console.error("[analytics] Failed to load inbound messages:", err);
  }

  // Load delivery statuses from messages for sent messages
  const sidStatusMap = new Map<string, { delivery_status: string; created_at: string }>();
  const sids = sentCustomers.map((s) => s.mark.sid).filter(Boolean) as string[];

  if (sids.length > 0) {
    // Chunk sids in safe batches of 50 to avoid PostgREST URI length limits
    const CHUNK_SIZE = 50;
    for (let i = 0; i < sids.length; i += CHUNK_SIZE) {
      const chunk = sids.slice(i, i + CHUNK_SIZE);
      try {
        const { data: msgStatuses } = await admin
          .from("messages")
          .select("external_message_sid, delivery_status, created_at")
          .in("external_message_sid", chunk);

        for (const m of msgStatuses ?? []) {
          if (m.external_message_sid) {
            sidStatusMap.set(m.external_message_sid, {
              delivery_status: m.delivery_status || "sent",
              created_at: m.created_at,
            });
          }
        }
      } catch (err) {
        console.error("[analytics] Failed to load msg statuses chunk:", err);
      }
    }
  }

  // Aggregate stats per recipient
  let deliveredCount = 0;
  let readCount = 0;
  let repliedCount = 0;

  const feed: CustomerCampaignEvent[] = [];

  for (const s of sentCustomers) {
    const phone = s.customer.phone_number || "";
    const name = s.customer.full_name || null;
    const sentAt = s.mark.at;
    const conv = convByPhone.get(s.phoneNormalized);
    const convId = conv?.id ?? null;

    const sidInfo = s.mark.sid ? sidStatusMap.get(s.mark.sid) : null;
    const rawDeliveryStatus = sidInfo?.delivery_status?.toLowerCase() || "sent";

    // Check for customer replies after the send timestamp (with 1-minute skew tolerance)
    const thresholdTime = s.sentTime - 60000;
    let repliedAt: string | null = null;
    let lastCustomerMessage: string | null = null;

    if (convId && repliesByConvId.has(convId)) {
      const convReplies = repliesByConvId.get(convId)!;
      const validReplies = convReplies.filter(
        (r) => new Date(r.created_at).getTime() >= thresholdTime
      );
      if (validReplies.length > 0) {
        repliedAt = validReplies[0].created_at;
        lastCustomerMessage = validReplies[validReplies.length - 1].content;
      }
    } else if (conv?.last_inbound_at && new Date(conv.last_inbound_at).getTime() >= thresholdTime) {
      repliedAt = conv.last_inbound_at;
    }

    const hasReplied = Boolean(repliedAt);
    const isRead = hasReplied || rawDeliveryStatus === "read";
    const isDelivered = hasReplied || isRead || rawDeliveryStatus === "delivered" || rawDeliveryStatus === "sent";

    if (hasReplied) repliedCount += 1;
    if (isRead) readCount += 1;
    if (isDelivered) deliveredCount += 1;

    let itemStatus: CustomerCampaignEvent["status"] = "sent";
    if (hasReplied) {
      itemStatus = "replied";
    } else if (rawDeliveryStatus === "read") {
      itemStatus = "read";
    } else if (rawDeliveryStatus === "delivered") {
      itemStatus = "delivered";
    }

    feed.push({
      customerId: s.customer.id,
      phone,
      name,
      status: itemStatus,
      sentAt,
      deliveredAt: isDelivered ? (sidInfo?.created_at ?? sentAt) : null,
      readAt: isRead ? (sidInfo?.created_at ?? (repliedAt ?? sentAt)) : null,
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
  const deliveryRate = totalSent > 0 ? Math.round((deliveredCount / totalSent) * 100) : 0;
  const readRate = deliveredCount > 0 ? Math.round((readCount / deliveredCount) * 100) : 0;
  const replyRate = totalSent > 0 ? Math.round((repliedCount / totalSent) * 100) : 0;

  // Health indicator
  let healthTone: BroadcastAnalyticsSummary["healthTone"] = "moderate";
  let healthLabel = "تفاعل متوسط";

  if (replyRate >= 10 || (readRate >= 50 && replyRate >= 5)) {
    healthTone = "excellent";
    healthLabel = "حملة ناجحة جدًا 🔥 (تفاعل مرتفع)";
  } else if (replyRate >= 3 || readRate >= 20) {
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
    delivered: deliveredCount,
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
