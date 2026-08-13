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
};

type PushTicket = { status?: "ok" | "error"; message?: string; details?: { error?: string } };

async function sendExpoMessages(messages: PushMessage[]): Promise<void> {
  if (!messages.length) return;
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
    const admin = getAdminSupabaseClient();
    await Promise.all(
      tickets.map(async (ticket, ticketIndex) => {
        if (ticket.status !== "error") return;
        const token = chunk[ticketIndex]?.to;
        if (!token) return;
        const permanentlyInvalid = ticket.details?.error === "DeviceNotRegistered";
        await admin
          .from("field_staff_push_tokens")
          .update({
            last_error_at: new Date().toISOString(),
            ...(permanentlyInvalid
              ? { disabled: true, disabled_reason: "DeviceNotRegistered" }
              : {}),
          })
          .eq("expo_token", token);
      })
    );
  }
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

export async function notifyFieldOrderAssigned(input: {
  orderId: string;
  customerName: string | null;
  specialistId: string;
  driverId: string;
}): Promise<void> {
  const [specialistTokens, driverTokens] = await Promise.all([
    activeTokensForRoster("specialist", [input.specialistId]),
    activeTokensForRoster("driver", [input.driverId]),
  ]);
  const name = input.customerName || "العميلة";
  const data = { type: "field_order", orderId: input.orderId, url: `/field/orders/${input.orderId}` };
  const messages: PushMessage[] = [
    ...(specialistTokens.get(input.specialistId) ?? []).map((to) => ({
      to,
      title: "طلب جديد لكِ",
      body: `افتحي تفاصيل طلب ${name} وتابعي خطوات التنفيذ.`,
      data,
      sound: "default" as const,
      priority: "high" as const,
    })),
    ...(driverTokens.get(input.driverId) ?? []).map((to) => ({
      to,
      title: "رحلة جديدة لك",
      body: `افتح تفاصيل طلب ${name} وأكّد الرحلة.`,
      data,
      sound: "default" as const,
      priority: "high" as const,
    })),
  ];
  await sendExpoMessages(messages);
}

export async function notifyNextFieldStep(input: {
  orderId: string;
  specialistId: string | null;
  driverId: string | null;
  progress: FieldOrderProgress;
}): Promise<void> {
  const next = nextFieldAction(input.progress);
  const rosterId = next.role === "specialist" ? input.specialistId : input.driverId;
  if (!next.role || !next.label || !rosterId) return;
  const tokens = await activeTokensForRoster(next.role, [rosterId]);
  await sendExpoMessages(
    (tokens.get(rosterId) ?? []).map((to) => ({
      to,
      title: "الخطوة التالية جاهزة",
      body: next.label!,
      data: { type: "field_order", orderId: input.orderId, url: `/field/orders/${input.orderId}` },
      sound: "default",
      priority: "high",
    }))
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
