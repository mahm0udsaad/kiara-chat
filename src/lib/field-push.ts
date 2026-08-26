import "server-only";

import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { KIARA_RESTAURANT_ID } from "@/lib/tenant";
import {
  nextFieldAction,
  type FieldOrderProgress,
  type FieldStaffRole,
} from "@/lib/field-staff";

type PushMessage = {
  to: string;
  title: string;
  body: string;
  data: Record<string, string>;
  sound: "default";
  priority: "high";
  channelId: "default";
};

type PushTicket = {
  status?: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
};

type PushReceipt = {
  status?: "ok" | "error";
  message?: string;
  details?: { error?: string };
};

export interface FieldPushDeliverySummary {
  attempted: number;
  accepted: number;
  delivered: number;
  pending: number;
  failed: number;
  errors: string[];
}

type TicketTarget = { id: string; token: string };

function pushErrorCode(item: PushTicket | PushReceipt): string {
  return item.details?.error || item.message || "UNKNOWN_PUSH_ERROR";
}

async function recordPushError(token: string, item: PushTicket | PushReceipt): Promise<void> {
  const code = pushErrorCode(item);
  const permanentlyInvalid = code === "DeviceNotRegistered";
  await getAdminSupabaseClient()
    .from("field_staff_push_tokens")
    .update({
      last_error_at: new Date().toISOString(),
      ...(permanentlyInvalid
        ? { disabled: true, disabled_reason: "DeviceNotRegistered" }
        : {}),
    })
    .eq("expo_token", token);
}

async function clearPushError(token: string): Promise<void> {
  await getAdminSupabaseClient()
    .from("field_staff_push_tokens")
    .update({ last_error_at: null })
    .eq("expo_token", token)
    .eq("disabled", false);
}

async function receiptsFor(
  targets: TicketTarget[],
): Promise<Map<string, PushReceipt>> {
  const remaining = new Set(targets.map((target) => target.id));
  const receipts = new Map<string, PushReceipt>();
  for (let attempt = 0; attempt < 3 && remaining.size; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const response = await fetch("https://exp.host/--/api/v2/push/getReceipts", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [...remaining] }),
    });
    if (!response.ok) throw new Error(`Expo receipt check failed with ${response.status}`);
    const payload = (await response.json().catch(() => ({}))) as {
      data?: Record<string, PushReceipt>;
    };
    for (const [id, receipt] of Object.entries(payload.data ?? {})) {
      receipts.set(id, receipt);
      remaining.delete(id);
    }
  }
  return receipts;
}

async function sendExpoMessages(
  messages: PushMessage[],
  options: { checkReceipts?: boolean } = {},
): Promise<FieldPushDeliverySummary> {
  const summary: FieldPushDeliverySummary = {
    attempted: messages.length,
    accepted: 0,
    delivered: 0,
    pending: 0,
    failed: 0,
    errors: [],
  };
  if (!messages.length) return summary;
  const targets: TicketTarget[] = [];
  for (let index = 0; index < messages.length; index += 100) {
    const chunk = messages.slice(index, index + 100);
    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip, deflate",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(chunk),
    });
    if (!response.ok) throw new Error(`Expo push failed with ${response.status}`);
    const payload = (await response.json().catch(() => ({}))) as { data?: PushTicket[] };
    const tickets = payload.data ?? [];
    await Promise.all(chunk.map(async (message, ticketIndex) => {
      const ticket = tickets[ticketIndex];
      if (!ticket) {
        summary.failed += 1;
        summary.errors.push("MISSING_EXPO_TICKET");
        return;
      }
      if (ticket.status === "error") {
        summary.failed += 1;
        const code = pushErrorCode(ticket);
        summary.errors.push(code);
        const token = chunk[ticketIndex]?.to;
        if (token) await recordPushError(token, ticket);
        console.error("[field-push] Expo rejected a push ticket", {
          code,
          message: ticket.message,
        });
        return;
      }
      if (ticket.status === "ok" && ticket.id) {
        summary.accepted += 1;
        targets.push({ id: ticket.id, token: message.to });
        return;
      }
      summary.failed += 1;
      summary.errors.push("INVALID_EXPO_TICKET");
    }));
  }

  if (!options.checkReceipts) {
    summary.pending = summary.accepted;
    return summary;
  }

  const receipts = await receiptsFor(targets);
  await Promise.all(targets.map(async (target) => {
    const receipt = receipts.get(target.id);
    if (!receipt) {
      summary.pending += 1;
      return;
    }
    if (receipt.status === "ok") {
      summary.delivered += 1;
      await clearPushError(target.token);
      return;
    }
    summary.failed += 1;
    const code = pushErrorCode(receipt);
    summary.errors.push(code);
    await recordPushError(target.token, receipt);
    console.error("[field-push] Expo push receipt failed", {
      code,
      message: receipt.message,
    });
  }));
  return summary;
}

function fieldMessage(
  to: string,
  input: Omit<PushMessage, "to" | "sound" | "priority" | "channelId">,
): PushMessage {
  return {
    to,
    ...input,
    sound: "default",
    priority: "high",
    channelId: "default",
  };
}

async function activeTokensForRoster(
  role: FieldStaffRole,
  rosterIds: string[]
): Promise<Map<string, string[]>> {
  if (!rosterIds.length) return new Map();
  const admin = getAdminSupabaseClient();
  const rosterColumn = role === "specialist" ? "specialist_id" : "driver_id";
  const { data: accounts } = await admin
    .from("field_staff_accounts")
    .select(`id, ${rosterColumn}`)
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .eq("role", role)
    .eq("is_active", true)
    .in(rosterColumn, rosterIds);
  const accountRows = accounts ?? [];
  if (!accountRows.length) return new Map();
  const accountToRoster = new Map(
    accountRows.map((row) => [
      row.id as string,
      (row as unknown as Record<string, unknown>)[rosterColumn] as string,
    ])
  );
  const { data: tokens } = await admin
    .from("field_staff_push_tokens")
    .select("field_staff_account_id, expo_token")
    .in("field_staff_account_id", [...accountToRoster.keys()])
    .eq("disabled", false);
  const out = new Map<string, string[]>();
  for (const row of tokens ?? []) {
    const rosterId = accountToRoster.get(row.field_staff_account_id as string);
    if (!rosterId) continue;
    const current = out.get(rosterId) ?? [];
    current.push(row.expo_token as string);
    out.set(rosterId, current);
  }
  return out;
}

/**
 * A reminder an employee wrote and sent by hand from the order screen.
 *
 * Deliberately separate from {@link notifyNextFieldStep}: that one is the
 * machine nudging whoever the step machine says is late, with wording it
 * chose. This carries the text the employee approved, verbatim, to the person
 * she picked — which is the whole point of her opening the composer.
 */
export async function notifyFieldStaffReminder(input: {
  orderId: string;
  role: FieldStaffRole;
  rosterId: string;
  title: string;
  body: string;
}): Promise<FieldPushDeliverySummary> {
  const tokens = await activeTokensForRoster(input.role, [input.rosterId]);
  return sendExpoMessages(
    (tokens.get(input.rosterId) ?? []).map((to) =>
      fieldMessage(to, {
        title: input.title,
        body: input.body,
        data: {
          type: "field_order",
          orderId: input.orderId,
          url: `/field/orders/${input.orderId}`,
        },
      }),
    ),
  );
}

/** Whether a roster member has at least one live device registered. */
export async function fieldStaffHasPushTokens(
  role: FieldStaffRole,
  rosterId: string,
): Promise<boolean> {
  const tokens = await activeTokensForRoster(role, [rosterId]);
  return (tokens.get(rosterId) ?? []).length > 0;
}

export async function notifyFieldOrderAssigned(input: {
  orderId: string;
  customerName: string | null;
  specialistId: string;
  driverId: string;
}): Promise<FieldPushDeliverySummary> {
  const [specialistTokens, driverTokens] = await Promise.all([
    activeTokensForRoster("specialist", [input.specialistId]),
    activeTokensForRoster("driver", [input.driverId]),
  ]);
  const name = input.customerName || "العميلة";
  const data = { type: "field_order", orderId: input.orderId, url: `/field/orders/${input.orderId}` };
  const messages: PushMessage[] = [
    ...(specialistTokens.get(input.specialistId) ?? []).map((to) => fieldMessage(to, {
      title: "طلب جديد لكِ",
      body: `افتحي تفاصيل طلب ${name} وتابعي خطوات التنفيذ.`,
      data,
    })),
    ...(driverTokens.get(input.driverId) ?? []).map((to) => fieldMessage(to, {
      title: "رحلة جديدة لك",
      body: `افتح تفاصيل طلب ${name} وأكّد الرحلة.`,
      data,
    })),
  ];
  return sendExpoMessages(messages);
}

/**
 * The driver's non-blocking "I've arrived at the specialist" ping. Notifies
 * only the specialist so she knows her ride is waiting; it does not advance the
 * step machine, so it is sent instead of — not alongside — the next-step nudge.
 */
export async function notifyFieldDriverArrived(input: {
  orderId: string;
  specialistId: string | null;
  customerName: string | null;
}): Promise<FieldPushDeliverySummary> {
  if (!input.specialistId) return sendExpoMessages([]);
  const tokens = await activeTokensForRoster("specialist", [input.specialistId]);
  const name = input.customerName || "العميلة";
  return sendExpoMessages(
    (tokens.get(input.specialistId) ?? []).map((to) => fieldMessage(to, {
      title: "وصل السائق",
      body: `السائق في انتظاركِ للتوجه إلى ${name}.`,
      data: { type: "field_order", orderId: input.orderId, url: `/field/orders/${input.orderId}` },
    }))
  );
}

export async function notifyNextFieldStep(input: {
  orderId: string;
  specialistId: string | null;
  driverId: string | null;
  progress: FieldOrderProgress;
}): Promise<FieldPushDeliverySummary> {
  const next = nextFieldAction(input.progress);
  const rosterId = next.role === "specialist" ? input.specialistId : input.driverId;
  if (!next.role || !next.label || !rosterId) return sendExpoMessages([]);
  const tokens = await activeTokensForRoster(next.role, [rosterId]);
  return sendExpoMessages(
    (tokens.get(rosterId) ?? []).map((to) => fieldMessage(to, {
      title: "الخطوة التالية جاهزة",
      body: next.label!,
      data: { type: "field_order", orderId: input.orderId, url: `/field/orders/${input.orderId}` },
    }))
  );
}

/** Sends a self-test and waits briefly for the APNs/FCM delivery receipt. */
export async function testFieldPushDelivery(
  accountId: string,
  deviceId: string,
): Promise<FieldPushDeliverySummary> {
  const { data: tokens, error } = await getAdminSupabaseClient()
    .from("field_staff_push_tokens")
    .select("expo_token")
    .eq("field_staff_account_id", accountId)
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .eq("device_id", deviceId)
    .eq("disabled", false);
  if (error) throw new Error(error.message);
  return sendExpoMessages(
    (tokens ?? []).map((row) => fieldMessage(row.expo_token as string, {
      title: "اختبار إشعارات كيارا",
      body: "الإشعارات تعمل على هذا الجهاز.",
      data: { type: "field_push_test", url: "/field/account" },
    })),
    { checkReceipts: true },
  );
}

export async function registerFieldPushToken(input: {
  accountId: string;
  expoToken: string;
  deviceId: string;
}): Promise<void> {
  if (!/^(Exponent|Expo)PushToken\[[^\]]+\]$/.test(input.expoToken)) {
    throw new Error("رمز الإشعارات غير صحيح");
  }
  if (input.deviceId.trim().length < 8 || input.deviceId.length > 200) {
    throw new Error("معرّف الجهاز غير صحيح");
  }
  const admin = getAdminSupabaseClient();
  await admin
    .from("field_staff_push_tokens")
    .delete()
    .eq("expo_token", input.expoToken)
    .neq("field_staff_account_id", input.accountId);
  const { error } = await admin.from("field_staff_push_tokens").upsert(
    {
      field_staff_account_id: input.accountId,
      restaurant_id: KIARA_RESTAURANT_ID,
      expo_token: input.expoToken,
      device_id: input.deviceId.trim(),
      disabled: false,
      disabled_reason: null,
      last_error_at: null,
    },
    { onConflict: "field_staff_account_id,device_id" }
  );
  if (error) throw new Error(error.message);
}

export async function unregisterFieldPushToken(input: {
  accountId: string;
  deviceId: string;
}): Promise<void> {
  await getAdminSupabaseClient()
    .from("field_staff_push_tokens")
    .update({ disabled: true, disabled_reason: "logout" })
    .eq("field_staff_account_id", input.accountId)
    .eq("device_id", input.deviceId);
}
