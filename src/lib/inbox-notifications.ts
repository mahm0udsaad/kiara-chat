import "server-only";

import { routedToOf } from "@/lib/conversation-meta";
import { conversationDangerMinutes } from "@/lib/mobile/conversations";
import { normalizePhone } from "@/lib/phone";
import type { Conversation } from "@/lib/types";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { KIARA_RESTAURANT_ID } from "@/lib/tenant";

const APP_ID = "kiara-operations";
const DEVICE_PREFIX = `${APP_ID}:`;
const INBOX_TOPIC_PREFIX = "kiara-inbox:";
const INBOX_EVENT = "message_received";

/** Metadata keys that remember what the team has already been told. */
const UNCLAIMED_ALERT_KEY = "unclaimed_alert_at";
const DANGER_ALERT_KEY = "danger_alert_for";

/** How long a single unclaimed thread stays quiet after alerting the team. */
const UNCLAIMED_ALERT_COOLDOWN_MS = 10 * 60_000;
/** Ceiling on one sweep, so a backlog can never turn into a runaway job. */
const MAX_DANGER_SCAN = 300;

type PushTicket = {
  status?: "ok" | "error";
  details?: { error?: string };
};

/** The columns the danger rule needs, straight off the conversations table. */
type DangerRow = {
  id: string;
  customer_name: string | null;
  customer_phone: string;
  last_inbound_at: string | null;
  last_message_at: string;
  metadata: Record<string, unknown> | null;
  status: Conversation["status"];
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

async function activeInboxTokens(
  teamMemberIds: string | string[]
): Promise<string[]> {
  const ids = (Array.isArray(teamMemberIds) ? teamMemberIds : [teamMemberIds]).filter(
    Boolean
  );
  if (!ids.length) return [];

  const modern = await supportsAppScopedTokens();
  let query = getAdminSupabaseClient()
    .from("user_push_tokens")
    .select("expo_token")
    .in("team_member_id", ids)
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .eq("disabled", false)
    .like("device_id", `${DEVICE_PREFIX}%`);
  if (modern) query = query.eq("app_id", APP_ID);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  // One employee may be signed in on two devices, and de-duping here keeps a
  // shared phone from receiving the same alert twice.
  return [
    ...new Set(
      (data ?? []).map((row) => row.expo_token as string).filter(validExpoToken)
    ),
  ];
}

/** Every employee who can work the inbox — the audience for team-wide alerts. */
async function inboxTeamMemberIds(): Promise<string[]> {
  const { data, error } = await getAdminSupabaseClient()
    .from("team_members")
    .select("id, role")
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .eq("is_active", true);
  if (error) throw new Error(error.message);
  return (data ?? [])
    .filter((row) => row.role === "admin" || row.role === "agent")
    .map((row) => row.id as string);
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

/** The three things the phone is allowed to wake someone up for. */
export type InboxAlertKind = "inbox_message" | "inbox_unassigned" | "inbox_danger";

async function sendPush(input: {
  teamMemberIds: string | string[];
  conversationId: string;
  kind: InboxAlertKind;
  title: string;
  body: string;
}): Promise<void> {
  const tokens = await activeInboxTokens(input.teamMemberIds);
  if (!tokens.length) return;

  const messages = tokens.map((to) => ({
    to,
    title: input.title,
    body: input.body,
    data: {
      type: input.kind,
      conversationId: input.conversationId,
      url: `/inbox/${input.conversationId}`,
    },
    sound: "default",
    priority: "high",
    channelId: "default",
  }));

  // Expo rejects a request carrying more than 100 messages, and a team-wide
  // alert on a floor of shared phones can pass that on its own.
  for (let start = 0; start < messages.length; start += 100) {
    const chunk = messages.slice(start, start + 100);
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

    const payload = (await response.json().catch(() => ({}))) as {
      data?: PushTicket[];
    };
    await Promise.all(
      (payload.data ?? []).map(async (ticket, index) => {
        const token = chunk[index]?.to;
        if (
          ticket.status === "error" &&
          ticket.details?.error === "DeviceNotRegistered" &&
          token
        ) {
          await disableInvalidToken(token);
        }
      })
    );
  }
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

function settledOrLogged(results: PromiseSettledResult<unknown>[]): void {
  for (const result of results) {
    if (result.status === "rejected") {
      console.error("[inbox-notifications] delivery failed", result.reason);
    }
  }
}

/** Patch one conversation's metadata without clobbering the other keys. */
async function patchConversationMetadata(
  conversationId: string,
  current: Record<string, unknown> | null,
  patch: Record<string, unknown>
): Promise<void> {
  const { error } = await getAdminSupabaseClient()
    .from("conversations")
    .update({ metadata: { ...(current ?? {}), ...patch } })
    .eq("id", conversationId)
    .eq("restaurant_id", KIARA_RESTAURANT_ID);
  if (error) throw new Error(error.message);
}

/**
 * An inbound message arrived.
 *
 * Two audiences, never both:
 *  - the chat has an owner (exclusive route beats assignment, matching the
 *    inbox visibility rule) → only she is woken, on every message;
 *  - nobody has claimed it → the whole team is told, so it gets picked up.
 *
 * The team-wide case is rate-limited per conversation. A customer typing four
 * lines in a row is one thread that needs claiming, not four alerts on every
 * phone in the salon.
 */
export async function notifyInboundInboxMessage(
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

  const metadata = (conversation.metadata as Record<string, unknown> | null) ?? null;
  const customerName =
    (conversation.customer_name as string | null)?.trim() ||
    (conversation.customer_phone as string);

  const routedTo = routedToOf({ metadata: conversation.metadata });
  const owner = routedTo || (conversation.assigned_to as string | null);

  if (owner) {
    settledOrLogged(
      await Promise.allSettled([
        broadcastLiveRefresh({ teamMemberId: owner, conversationId }),
        sendPush({
          teamMemberIds: owner,
          conversationId,
          kind: "inbox_message",
          title: `رسالة جديدة من ${customerName}`,
          body: "افتحي المحادثة للمتابعة والرد.",
        }),
      ])
    );
    return;
  }

  const lastAlert = Date.parse(String(metadata?.[UNCLAIMED_ALERT_KEY] ?? ""));
  if (
    Number.isFinite(lastAlert) &&
    Date.now() - lastAlert < UNCLAIMED_ALERT_COOLDOWN_MS
  ) {
    return;
  }

  const team = await inboxTeamMemberIds();
  if (!team.length) return;

  settledOrLogged(
    await Promise.allSettled([
      ...team.map((teamMemberId) =>
        broadcastLiveRefresh({ teamMemberId, conversationId })
      ),
      sendPush({
        teamMemberIds: team,
        conversationId,
        kind: "inbox_unassigned",
        title: "محادثة جديدة غير مستلمة",
        body: `${customerName} بانتظار الرد — افتحي المحادثة لاستلامها.`,
      }),
      patchConversationMetadata(conversationId, metadata, {
        [UNCLAIMED_ALERT_KEY]: new Date().toISOString(),
      }),
    ])
  );
}

/**
 * Every unanswered chat that has crossed the six-minute danger line, alerted
 * to the whole team once per customer message.
 *
 * Time passing is not an event anything in the app observes, so unlike the
 * other two alerts this one needs a caller on a schedule — see
 * `/api/cron/inbox-danger`. The "once" is enforced by stamping the inbound
 * timestamp we alerted for onto the conversation: the customer's next message
 * changes it and re-arms the alert, while repeated sweeps over the same
 * unanswered message stay silent.
 */
export async function sweepDangerConversations(): Promise<{
  scanned: number;
  danger: number;
  alerted: number;
}> {
  const admin = getAdminSupabaseClient();
  const { data, error } = await admin
    .from("conversations")
    .select(
      "id, customer_name, customer_phone, last_inbound_at, last_message_at, metadata, status"
    )
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .not("last_inbound_at", "is", null)
    // Anything older than a day is not "late", it is abandoned; sweeping it
    // every minute would scan the whole history for nothing.
    .gte("last_inbound_at", new Date(Date.now() - 24 * 3600_000).toISOString())
    .order("last_inbound_at", { ascending: false })
    .limit(MAX_DANGER_SCAN);
  if (error) throw new Error(error.message);

  const rows = data ?? [];
  const excludedPhones = await rosterContactPhoneSet();
  const now = Date.now();
  const team = await inboxTeamMemberIds();

  let danger = 0;
  let alerted = 0;
  for (const row of rows as DangerRow[]) {
    const minutes = conversationDangerMinutes(row, now, excludedPhones);
    if (minutes === null) continue;
    danger += 1;

    const metadata = row.metadata ?? null;
    if (metadata?.[DANGER_ALERT_KEY] === row.last_inbound_at) continue;
    if (!team.length) continue;

    const customerName = row.customer_name?.trim() || row.customer_phone;
    try {
      await sendPush({
        teamMemberIds: team,
        conversationId: row.id,
        kind: "inbox_danger",
        title: `⚠️ محادثة متأخرة — ${customerName}`,
        body: `بدون رد منذ ${minutes} دقيقة. افتحي المحادثة للرد الآن.`,
      });
      await patchConversationMetadata(row.id, metadata, {
        [DANGER_ALERT_KEY]: row.last_inbound_at,
      });
      alerted += 1;
    } catch (cause) {
      // One bad conversation must not stop the sweep for the rest.
      console.error("[inbox-notifications] danger alert failed", row.id, cause);
    }
  }

  return { scanned: rows.length, danger, alerted };
}

/**
 * Staff phone numbers, which never count as a late customer.
 *
 * Read with the service-role client on purpose: the sweep runs from a cron
 * with no session, and the RLS-scoped roster helpers would come back empty.
 */
async function rosterContactPhoneSet(): Promise<ReadonlySet<string>> {
  const admin = getAdminSupabaseClient();
  const [specialists, drivers] = await Promise.all([
    admin.from("specialists").select("phone").eq("restaurant_id", KIARA_RESTAURANT_ID),
    admin.from("drivers").select("phone").eq("restaurant_id", KIARA_RESTAURANT_ID),
  ]);
  return new Set(
    [...(specialists.data ?? []), ...(drivers.data ?? [])]
      .map((row) => normalizePhone(String(row.phone ?? "")))
      .filter(Boolean)
  );
}
