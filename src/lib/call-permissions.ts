import "server-only";

/**
 * Who the spa may call, and what we were last told.
 *
 * The rule this module exists to respect: our table is a cache and an audit
 * record, Graph is the authority. A permission can lapse without any webhook —
 * the customer revokes it from the business profile, a temporary grant runs
 * out, or four consecutive unanswered calls revoke it automatically — so
 * anything that decides whether a call may actually be placed calls
 * `resolveCallPermission`, which reconciles against Graph. Anything that only
 * renders a list reads the cached row and says how old it is.
 */
import {
  CONVERSATION_EVENTS,
  recordSystemConversationEvent,
} from "@/lib/audit";
import { canonicalPhone } from "@/lib/phone";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { KIARA_RESTAURANT_ID } from "@/lib/tenant";
import {
  fetchCallPermission,
  type CallPermissionReply,
} from "@/lib/transport/meta-calling";

/** How long a synced answer is treated as fresh enough to act on. */
const FRESH_FOR_MS = 60_000;

export type CallPermissionStatus =
  | "none"
  | "requested"
  | "granted"
  | "declined"
  | "expired"
  | "revoked";

export interface CallPermissionRow {
  id: string;
  customerPhone: string;
  status: CallPermissionStatus;
  isPermanent: boolean;
  expiresAt: string | null;
  responseSource: string | null;
  requestedAt: string | null;
  requestMessageSid: string | null;
  respondedAt: string | null;
  lastSyncedAt: string | null;
}

type DbRow = {
  id: string;
  customer_phone: string;
  status: string;
  is_permanent: boolean;
  expires_at: string | null;
  response_source: string | null;
  requested_at: string | null;
  request_message_sid: string | null;
  responded_at: string | null;
  last_synced_at: string | null;
};

function toRow(row: DbRow): CallPermissionRow {
  return {
    id: row.id,
    customerPhone: row.customer_phone,
    status: (row.status as CallPermissionStatus) ?? "none",
    isPermanent: row.is_permanent,
    expiresAt: row.expires_at,
    responseSource: row.response_source,
    requestedAt: row.requested_at,
    requestMessageSid: row.request_message_sid,
    respondedAt: row.responded_at,
    lastSyncedAt: row.last_synced_at,
  };
}

const COLUMNS =
  "id, customer_phone, status, is_permanent, expires_at, response_source, requested_at, request_message_sid, responded_at, last_synced_at";

/**
 * The stored shape is `+E.164`, enforced by a CHECK on the column.
 *
 * `normalizePhone` returns national digits and would fail that check, so this
 * is the only conversion used on the way in — a mismatch here is the bug that
 * has already cost this codebase a round of silent `eq()` misses.
 */
function storedPhone(value: string): string | null {
  return canonicalPhone(value);
}

/** True when a granted permission has not lapsed. */
export function isCallable(row: Pick<CallPermissionRow, "status" | "expiresAt">): boolean {
  if (row.status !== "granted") return false;
  if (!row.expiresAt) return true;
  return new Date(row.expiresAt).getTime() > Date.now();
}

export async function getCallPermission(
  customerPhone: string,
): Promise<CallPermissionRow | null> {
  const phone = storedPhone(customerPhone);
  if (!phone) return null;

  const { data, error } = await getAdminSupabaseClient()
    .from("call_permissions")
    .select(COLUMNS)
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .eq("customer_phone", phone)
    .maybeSingle();

  if (error) {
    console.error(`[call-permissions] read failed for ${phone}`, error);
    return null;
  }
  return data ? toRow(data as DbRow) : null;
}

/** Cached state for many customers at once, for rendering the inbox. */
export async function listCallPermissions(
  customerPhones: string[],
): Promise<Map<string, CallPermissionRow>> {
  const phones = [...new Set(customerPhones.map(storedPhone).filter(Boolean))] as string[];
  const result = new Map<string, CallPermissionRow>();
  if (!phones.length) return result;

  const { data, error } = await getAdminSupabaseClient()
    .from("call_permissions")
    .select(COLUMNS)
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .in("customer_phone", phones);

  if (error) {
    console.error("[call-permissions] bulk read failed", error);
    return result;
  }
  for (const row of (data ?? []) as DbRow[]) {
    result.set(row.customer_phone, toRow(row));
  }
  return result;
}

async function upsert(
  phone: string,
  patch: Record<string, unknown>,
): Promise<CallPermissionRow | null> {
  const { data, error } = await getAdminSupabaseClient()
    .from("call_permissions")
    .upsert(
      {
        restaurant_id: KIARA_RESTAURANT_ID,
        customer_phone: phone,
        ...patch,
      },
      { onConflict: "restaurant_id,customer_phone" },
    )
    .select(COLUMNS)
    .single();

  if (error) {
    console.error(`[call-permissions] write failed for ${phone}`, error);
    return null;
  }
  return toRow(data as DbRow);
}

/**
 * Append to the history. Never fails the action it describes — the permission
 * change has already happened, and the state row is what the app reads.
 */
async function recordEvent(input: {
  permissionId: string;
  phone: string;
  event: "requested" | "granted" | "declined" | "expired" | "revoked" | "synced";
  isPermanent?: boolean | null;
  expiresAt?: string | null;
  responseSource?: string | null;
  actorUserId?: string | null;
  payload?: unknown;
}): Promise<void> {
  const { error } = await getAdminSupabaseClient()
    .from("call_permission_events")
    .insert({
      restaurant_id: KIARA_RESTAURANT_ID,
      permission_id: input.permissionId,
      customer_phone: input.phone,
      event: input.event,
      is_permanent: input.isPermanent ?? null,
      expires_at: input.expiresAt ?? null,
      response_source: input.responseSource ?? null,
      actor_user_id: input.actorUserId ?? null,
      payload: (input.payload ?? {}) as Record<string, unknown>,
    });
  if (error) {
    console.error(
      `[call-permissions] history ${input.event} for ${input.phone} was not recorded`,
      error,
    );
  }
}

/** Remember that we asked, so the UI can show "asked, waiting". */
export async function recordPermissionRequested(input: {
  customerPhone: string;
  messageSid: string;
  actorUserId: string | null;
}): Promise<CallPermissionRow | null> {
  const phone = storedPhone(input.customerPhone);
  if (!phone) return null;

  const row = await upsert(phone, {
    status: "requested",
    requested_at: new Date().toISOString(),
    request_message_sid: input.messageSid,
    requested_by_user_id: input.actorUserId,
    // A fresh ask supersedes whatever the last answer was: Meta expires the
    // previous permission the moment the customer interacts with a new
    // request, so carrying the old grant forward would misreport reality.
    responded_at: null,
    response_source: null,
    expires_at: null,
    is_permanent: false,
  });

  if (row) {
    await recordEvent({
      permissionId: row.id,
      phone,
      event: "requested",
      actorUserId: input.actorUserId,
      payload: { message_sid: input.messageSid },
    });
  }
  return row;
}

/**
 * Apply the customer's answer, as it arrived on the messages webhook.
 *
 * Returns the stored row so the caller can decide what else to do — notify the
 * assigned employee, write the conversation audit event — without re-reading.
 */
export async function recordPermissionReply(
  customerPhone: string,
  reply: CallPermissionReply,
): Promise<CallPermissionRow | null> {
  const phone = storedPhone(customerPhone);
  if (!phone) return null;

  const granted = reply.response === "accept";
  const expiresAt =
    granted && !reply.isPermanent && reply.expiresAt
      ? new Date(reply.expiresAt * 1000).toISOString()
      : null;

  const row = await upsert(phone, {
    status: granted ? "granted" : "declined",
    is_permanent: granted && reply.isPermanent,
    expires_at: expiresAt,
    response_source: reply.responseSource,
    responded_at: new Date().toISOString(),
    last_synced_at: new Date().toISOString(),
    ...(reply.requestMessageSid
      ? { request_message_sid: reply.requestMessageSid }
      : {}),
  });

  if (row) {
    await recordEvent({
      permissionId: row.id,
      phone,
      event: granted ? "granted" : "declined",
      isPermanent: reply.isPermanent,
      expiresAt,
      responseSource: reply.responseSource,
      payload: reply as unknown as Record<string, unknown>,
    });
  }
  return row;
}

/**
 * Everything that should happen when a customer answers a permission request,
 * in one call the webhook can defer.
 *
 * Swallows its own failures for the same reason the audit writers do: the
 * customer's answer has already happened and is already stored as a message.
 * Losing the bookkeeping is bad; failing the ingestion that carries the spa's
 * live inbox would be worse.
 */
export async function applyCallPermissionReply(
  conversationId: string,
  customerPhone: string,
  reply: CallPermissionReply,
): Promise<void> {
  try {
    const row = await recordPermissionReply(customerPhone, reply);
    await recordSystemConversationEvent(
      conversationId,
      reply.response === "accept"
        ? CONVERSATION_EVENTS.callPermissionGranted
        : CONVERSATION_EVENTS.callPermissionDeclined,
      {
        is_permanent: reply.isPermanent,
        expires_at: row?.expiresAt ?? null,
        response_source: reply.responseSource,
      },
    );
  } catch (error) {
    console.error(
      `[call-permissions] could not apply reply for ${customerPhone}`,
      error,
    );
  }
}

export interface ResolvedPermission {
  callable: boolean;
  status: CallPermissionStatus;
  expiresAt: string | null;
  /** Whether Graph will currently accept another permission request. */
  canRequest: boolean;
  /** False when Graph could not be reached and this is the remembered answer. */
  authoritative: boolean;
}

/**
 * The answer to "may we call this customer right now".
 *
 * Reconciles against Graph unless a sync is very recent, then writes what it
 * learned back so the inbox list stays close to the truth. When Graph is
 * unreachable it degrades to the cached row and says so, rather than either
 * blocking a legitimate call or promising one that would fail with 138006.
 */
export async function resolveCallPermission(
  customerPhone: string,
  options: { force?: boolean } = {},
): Promise<ResolvedPermission> {
  const phone = storedPhone(customerPhone);
  if (!phone) {
    return {
      callable: false,
      status: "none",
      expiresAt: null,
      canRequest: false,
      authoritative: true,
    };
  }

  const cached = await getCallPermission(phone);
  const syncedAt = cached?.lastSyncedAt ? new Date(cached.lastSyncedAt).getTime() : 0;
  if (!options.force && Date.now() - syncedAt < FRESH_FOR_MS && cached) {
    return {
      callable: isCallable(cached),
      status: cached.status,
      expiresAt: cached.expiresAt,
      canRequest: cached.status !== "requested",
      authoritative: true,
    };
  }

  let live: Awaited<ReturnType<typeof fetchCallPermission>>;
  try {
    live = await fetchCallPermission(phone);
  } catch (error) {
    console.error(
      `[call-permissions] Graph lookup failed for ${phone}; falling back to cache`,
      error,
    );
    return {
      callable: cached ? isCallable(cached) : false,
      status: cached?.status ?? "none",
      expiresAt: cached?.expiresAt ?? null,
      canRequest: cached?.status !== "requested",
      authoritative: false,
    };
  }

  const granted = live.status === "temporary" || live.status === "permanent";
  const expiresAt =
    live.status === "temporary" && live.expiresAt
      ? new Date(live.expiresAt * 1000).toISOString()
      : null;

  // A response we could not parse is not evidence of anything. Treating it as
  // "no permission" would revoke a grant the customer actually gave — the call
  // button would vanish and the 1-per-24h ask quota would be spent re-asking
  // someone who already said yes.
  if (!live.recognised) {
    console.error(
      `[call-permissions] keeping stored state for ${phone}; Graph returned a shape this parser does not understand`,
    );
    return {
      callable: cached ? isCallable(cached) : false,
      status: cached?.status ?? "none",
      expiresAt: cached?.expiresAt ?? null,
      canRequest: cached?.status !== "requested",
      authoritative: false,
    };
  }

  // Graph reporting no permission does not distinguish "never asked" from
  // "revoked" or "declined". Only downgrade a grant we believed in — and call
  // that revoked, which is what it is — so a pending ask or a recorded decline
  // is not overwritten with a blank.
  let status: CallPermissionStatus;
  if (granted) status = "granted";
  else if (cached?.status === "granted") status = "revoked";
  else status = cached?.status ?? "none";

  const row = await upsert(phone, {
    status,
    is_permanent: live.status === "permanent",
    expires_at: expiresAt,
    last_synced_at: new Date().toISOString(),
  });

  if (row && status === "revoked" && cached?.status === "granted") {
    await recordEvent({
      permissionId: row.id,
      phone,
      event: "revoked",
      payload: live.raw as Record<string, unknown>,
    });
  }

  return {
    // `canCall` is Meta's own answer and outranks our reading of the status:
    // permission can be granted and still spent, since a business may connect
    // at most 100 calls to one customer per 24 hours.
    callable:
      granted &&
      live.canCall &&
      (!expiresAt || new Date(expiresAt).getTime() > Date.now()),
    status,
    expiresAt,
    canRequest: live.canRequest,
    authoritative: true,
  };
}
