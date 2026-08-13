import "server-only";

import { routedToOf } from "@/lib/conversation-meta";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { KIARA_RESTAURANT_ID } from "@/lib/tenant";

const APP_ID = "kiara-operations";
const DEVICE_PREFIX = `${APP_ID}:`;
const INBOX_TOPIC_PREFIX = "kiara-inbox:";
const INBOX_EVENT = "message_received";

type PushTicket = {
  status?: "ok" | "error";
  details?: { error?: string };
};

let appScopedTokenSchema: Promise<boolean> | null = null;

async function supportsAppScopedTokens(): Promise<boolean> {
  if (!appScopedTokenSchema) {
    appScopedTokenSchema = (async () => {
      const { error } = await getAdminSupabaseClient()
        .from("user_push_tokens")
        .select("app_id, disabled_reason, last_error_at")
        .limit(0);
      return !error;
    })();
  }
  return appScopedTokenSchema;
}

function storedDeviceId(deviceId: string): string {
  return `${DEVICE_PREFIX}${deviceId.trim()}`;
}

function validExpoToken(token: string): boolean {
  return /^(Exponent|Expo)PushToken\[[^\]]+\]$/.test(token);
}

export async function registerInboxPushToken(input: {
  teamMemberId: string;
  expoToken: string;
  deviceId: string;
  platform: "ios" | "android";
}): Promise<void> {
  if (!validExpoToken(input.expoToken)) throw new Error("رمز الإشعارات غير صحيح");
  if (input.deviceId.trim().length < 8 || input.deviceId.length > 160) {
    throw new Error("معرّف الجهاز غير صحيح");
  }

  const admin = getAdminSupabaseClient();
  const modern = await supportsAppScopedTokens();
  const deviceId = storedDeviceId(input.deviceId);

  // One Expo token belongs to one signed-in employee at a time.
  await admin
    .from("user_push_tokens")
    .delete()
    .eq("expo_token", input.expoToken)
    .neq("team_member_id", input.teamMemberId);

  const payload = {
    team_member_id: input.teamMemberId,
    restaurant_id: KIARA_RESTAURANT_ID,
    expo_token: input.expoToken,
    device_id: deviceId,
    platform: input.platform,
    last_seen_at: new Date().toISOString(),
    disabled: false,
    ...(modern
      ? {
          app_id: APP_ID,
          disabled_reason: null,
          last_error_at: null,
        }
      : {}),
  };
  let existingQuery = admin
    .from("user_push_tokens")
    .select("id")
    .eq("team_member_id", input.teamMemberId)
    .eq("device_id", deviceId);
  if (modern) existingQuery = existingQuery.eq("app_id", APP_ID);
  const { data: existing, error: lookupError } = await existingQuery.maybeSingle();
  if (lookupError) throw new Error(lookupError.message);

  const write = existing?.id
    ? admin.from("user_push_tokens").update(payload).eq("id", existing.id)
    : admin.from("user_push_tokens").insert(payload);
  const { error } = await write;
  if (error) throw new Error(error.message);
}

export async function unregisterInboxPushToken(input: {
  teamMemberId: string;
  deviceId: string;
}): Promise<void> {
  const admin = getAdminSupabaseClient();
  const modern = await supportsAppScopedTokens();
  const { error } = await admin
    .from("user_push_tokens")
    .update({
      disabled: true,
      ...(modern ? { disabled_reason: "logout" } : {}),
    })
    .eq("team_member_id", input.teamMemberId)
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .eq("device_id", storedDeviceId(input.deviceId));
  if (error) throw new Error(error.message);
}

async function activeInboxTokens(teamMemberId: string): Promise<string[]> {
  const modern = await supportsAppScopedTokens();
  let query = getAdminSupabaseClient()
    .from("user_push_tokens")
    .select("expo_token")
    .eq("team_member_id", teamMemberId)
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .eq("disabled", false)
    .like("device_id", `${DEVICE_PREFIX}%`);
  if (modern) query = query.eq("app_id", APP_ID);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? [])
    .map((row) => row.expo_token as string)
    .filter(validExpoToken);
}

async function disableInvalidToken(token: string): Promise<void> {
  const modern = await supportsAppScopedTokens();
  await getAdminSupabaseClient()
    .from("user_push_tokens")
    .update({
      disabled: true,
      ...(modern
        ? {
            disabled_reason: "DeviceNotRegistered",
            last_error_at: new Date().toISOString(),
          }
        : {}),
    })
    .eq("expo_token", token);
}

async function sendPush(input: {
  teamMemberId: string;
  conversationId: string;
  customerName: string;
}): Promise<void> {
  const tokens = await activeInboxTokens(input.teamMemberId);
  if (!tokens.length) return;

  const messages = tokens.map((to) => ({
    to,
    title: `رسالة جديدة من ${input.customerName}`,
    body: "افتحي المحادثة للمتابعة والرد.",
    data: {
      type: "inbox_message",
      conversationId: input.conversationId,
      url: `/inbox/${input.conversationId}`,
    },
    sound: "default",
    priority: "high",
    channelId: "default",
  }));

  const response = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip, deflate",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(messages),
  });
  if (!response.ok) throw new Error(`Expo push failed with ${response.status}`);

  const payload = (await response.json().catch(() => ({}))) as {
    data?: PushTicket[];
  };
  await Promise.all(
    (payload.data ?? []).map(async (ticket, index) => {
      if (
        ticket.status === "error" &&
        ticket.details?.error === "DeviceNotRegistered" &&
        tokens[index]
      ) {
        await disableInvalidToken(tokens[index]);
      }
    })
  );
}

async function broadcastLiveRefresh(input: {
  teamMemberId: string;
  conversationId: string;
}): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;
  const topic = `${INBOX_TOPIC_PREFIX}${input.teamMemberId}`;
  const endpoint = `${url}/realtime/v1/api/broadcast/${encodeURIComponent(topic)}/events/${INBOX_EVENT}?private=true`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      conversationId: input.conversationId,
      receivedAt: new Date().toISOString(),
    }),
  });
  if (!response.ok) {
    throw new Error(`Realtime broadcast failed with ${response.status}`);
  }
}

/**
 * Deliver an inbound event only to the employee who owns the chat. Exclusive
 * routing wins over assignment, matching the inbox visibility rule.
 */
export async function notifyAssignedInboxMessage(
  conversationId: string
): Promise<void> {
  const { data: conversation, error } = await getAdminSupabaseClient()
    .from("conversations")
    .select("assigned_to, customer_name, customer_phone, metadata")
    .eq("id", conversationId)
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!conversation) return;

  const routedTo = routedToOf({ metadata: conversation.metadata });
  const teamMemberId = routedTo || (conversation.assigned_to as string | null);
  if (!teamMemberId) return;

  const customerName =
    (conversation.customer_name as string | null)?.trim() ||
    (conversation.customer_phone as string);
  const results = await Promise.allSettled([
    broadcastLiveRefresh({ teamMemberId, conversationId }),
    sendPush({ teamMemberId, conversationId, customerName }),
  ]);
  for (const result of results) {
    if (result.status === "rejected") {
      console.error("[inbox-notifications] delivery failed", result.reason);
    }
  }
}
