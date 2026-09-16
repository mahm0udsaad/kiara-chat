import "server-only";

/**
 * The lifecycle of one WhatsApp call, server side.
 *
 * Two jobs. The first is the SDP handoff: the caller's browser makes an offer,
 * this module hands it to Meta, and Meta's answer arrives later on a webhook
 * that has no connection to the request that started the call. The answer is
 * both broadcast (fast) and written to the row (correct) — a broadcast that
 * lands before the client has finished subscribing is simply lost, and losing
 * it would strand a call Meta considers connected.
 *
 * The second is making retried webhooks harmless. `call_events` carries a
 * unique key on (call, event), so a duplicate `terminate` conflicts instead of
 * overwriting a completed call's duration.
 */
import { fetchWithTimeout } from "@/lib/http-timeout";
import { canonicalPhone } from "@/lib/phone";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { KIARA_RESTAURANT_ID } from "@/lib/tenant";
import {
  parseCallEvent,
  parseCallStatus,
  placeCall,
  terminateCall,
  type CallStatusEvent,
  type CallWebhookEvent,
} from "@/lib/transport/meta-calling";

/** Realtime topic for one call's signalling. */
export const callChannel = (waCallId: string) => `kiara-call:${waCallId}`;
export const CALL_EVENT = "signal";

export type CallStatus =
  | "initiated"
  | "ringing"
  | "accepted"
  | "connected"
  | "rejected"
  | "completed"
  | "failed";

/** Statuses where the call is still worth showing on screen. */
const LIVE: CallStatus[] = ["initiated", "ringing", "accepted", "connected"];

export interface CallRecord {
  id: string;
  waCallId: string;
  conversationId: string | null;
  customerPhone: string;
  direction: "business_initiated" | "user_initiated";
  status: CallStatus;
  remoteSdp: string | null;
  remoteSdpType: "offer" | "answer" | null;
  startedAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  error: string | null;
}

type DbCall = {
  id: string;
  wa_call_id: string;
  conversation_id: string | null;
  customer_phone: string;
  direction: string;
  status: string;
  remote_sdp: string | null;
  remote_sdp_type: string | null;
  started_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  error: string | null;
};

const COLUMNS =
  "id, wa_call_id, conversation_id, customer_phone, direction, status, remote_sdp, remote_sdp_type, started_at, ended_at, duration_seconds, error";

function toCall(row: DbCall): CallRecord {
  return {
    id: row.id,
    waCallId: row.wa_call_id,
    conversationId: row.conversation_id,
    customerPhone: row.customer_phone,
    direction: row.direction as CallRecord["direction"],
    status: row.status as CallStatus,
    remoteSdp: row.remote_sdp,
    remoteSdpType: row.remote_sdp_type as CallRecord["remoteSdpType"],
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationSeconds: row.duration_seconds,
    error: row.error,
  };
}

/**
 * Push a signalling event to whoever is on the call's channel.
 *
 * Fire-and-forget by design: the row is the durable copy, and a client that
 * missed the broadcast finds the same SDP by fetching the call.
 */
async function broadcast(
  waCallId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;

  await fetchWithTimeout(`${url}/realtime/v1/api/broadcast`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      messages: [
        {
          topic: callChannel(waCallId),
          event: CALL_EVENT,
          payload,
          private: true,
        },
      ],
    }),
  }).catch(() => {
    // The row already has it. A dropped broadcast costs latency, not the call.
  });
}

export async function getCall(waCallId: string): Promise<CallRecord | null> {
  const { data, error } = await getAdminSupabaseClient()
    .from("calls")
    .select(COLUMNS)
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .eq("wa_call_id", waCallId)
    .maybeSingle();

  if (error) {
    console.error(`[calls] read failed for ${waCallId}`, error);
    return null;
  }
  return data ? toCall(data as DbCall) : null;
}

/** Calls still in flight, so a reloaded tab can rejoin rather than orphan one. */
export async function listLiveCalls(): Promise<CallRecord[]> {
  const { data, error } = await getAdminSupabaseClient()
    .from("calls")
    .select(COLUMNS)
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .in("status", LIVE)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    console.error("[calls] live read failed", error);
    return [];
  }
  return ((data ?? []) as DbCall[]).map(toCall);
}

/**
 * Record a lifecycle event, and say whether it is the first time we have seen
 * it. A false return means this webhook is a retry and the caller should not
 * re-apply the transition.
 */
async function claimEvent(
  callId: string,
  waCallId: string,
  event: string,
  payload: unknown,
): Promise<boolean> {
  const { error } = await getAdminSupabaseClient()
    .from("call_events")
    .insert({
      restaurant_id: KIARA_RESTAURANT_ID,
      call_id: callId,
      wa_call_id: waCallId,
      event,
      payload: (payload ?? {}) as Record<string, unknown>,
    });

  if (!error) return true;
  // 23505 is the unique violation on (restaurant, call, event) — the whole
  // point of the key. Anything else is a real failure and must not be
  // mistaken for a duplicate, or the transition would be silently dropped.
  if (error.code === "23505") return false;
  throw new Error(`call event ${event} for ${waCallId} failed: ${error.message}`);
}

export interface StartCallResult {
  call: CallRecord;
}

/**
 * Place an outbound call and record it.
 *
 * The SDP offer arrives already complete: this API does not trickle ICE, so
 * the client gathers candidates before it ever reaches this function.
 */
export async function startOutboundCall(input: {
  conversationId: string;
  customerPhone: string;
  sdpOffer: string;
  initiatedByUserId: string;
}): Promise<StartCallResult> {
  const phone = canonicalPhone(input.customerPhone);
  if (!phone) throw new Error("CALL_INVALID_PHONE");

  const { callId } = await placeCall({
    toE164: phone,
    sdp: input.sdpOffer,
    callbackData: input.conversationId,
  });

  const { data, error } = await getAdminSupabaseClient()
    .from("calls")
    .insert({
      restaurant_id: KIARA_RESTAURANT_ID,
      conversation_id: input.conversationId,
      customer_phone: phone,
      wa_call_id: callId,
      direction: "business_initiated",
      status: "initiated",
      initiated_by_user_id: input.initiatedByUserId,
      biz_opaque_callback_data: input.conversationId,
    })
    .select(COLUMNS)
    .single();

  if (error) {
    // The call is already ringing on the customer's phone at this point, so
    // failing to record it must not leave it ringing forever.
    console.error(`[calls] could not record ${callId}; terminating`, error);
    await terminateCall(callId).catch(() => {});
    throw new Error(`CALL_NOT_RECORDED: ${error.message}`);
  }

  return { call: toCall(data as DbCall) };
}

/** Hang up, and mark the row so the UI stops showing a live call. */
export async function endCall(waCallId: string): Promise<void> {
  await terminateCall(waCallId);
  const call = await getCall(waCallId);
  if (!call || !LIVE.includes(call.status)) return;

  await getAdminSupabaseClient()
    .from("calls")
    .update({
      status: "completed",
      ended_at: new Date().toISOString(),
      remote_sdp: null,
    })
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .eq("wa_call_id", waCallId);

  await broadcast(waCallId, { kind: "ended", status: "completed" });
}

/**
 * Apply one `calls` webhook entry.
 *
 * `connect` on a business-initiated call is the SDP answer the caller's browser
 * is waiting for — the single most latency-sensitive step in the whole feature,
 * which is why it is written and broadcast before anything else happens.
 */
async function applyCallEvent(event: CallWebhookEvent): Promise<void> {
  let call = await getCall(event.callId);

  // A user-initiated call has no row yet: the customer rang us, and this
  // webhook is the first we hear of it.
  if (!call && event.event === "connect" && event.direction === "user_initiated") {
    const phone = canonicalPhone(event.from ?? "");
    if (!phone) {
      console.warn(`[calls] inbound ${event.callId} had no usable caller number`);
      return;
    }
    const { data, error } = await getAdminSupabaseClient()
      .from("calls")
      .insert({
        restaurant_id: KIARA_RESTAURANT_ID,
        customer_phone: phone,
        wa_call_id: event.callId,
        direction: "user_initiated",
        status: "ringing",
      })
      .select(COLUMNS)
      .single();
    if (error) {
      console.error(`[calls] could not record inbound ${event.callId}`, error);
      return;
    }
    call = toCall(data as DbCall);
  }

  if (!call) {
    console.warn(`[calls] ${event.event} for unknown call ${event.callId}`);
    return;
  }

  if (!(await claimEvent(call.id, event.callId, event.event, event))) return;

  const admin = getAdminSupabaseClient();

  if (event.event === "connect") {
    await admin
      .from("calls")
      .update({
        status: event.direction === "business_initiated" ? "accepted" : "ringing",
        remote_sdp: event.sdp,
        remote_sdp_type: event.sdpType,
        started_at: event.startedAt
          ? new Date(event.startedAt * 1000).toISOString()
          : new Date().toISOString(),
      })
      .eq("restaurant_id", KIARA_RESTAURANT_ID)
      .eq("wa_call_id", event.callId);

    await broadcast(event.callId, {
      kind: "sdp",
      sdp: event.sdp,
      sdpType: event.sdpType,
      direction: event.direction,
    });
    return;
  }

  // terminate
  const failed = event.status === "FAILED";
  await admin
    .from("calls")
    .update({
      status: failed ? "failed" : "completed",
      ended_at: event.endedAt
        ? new Date(event.endedAt * 1000).toISOString()
        : new Date().toISOString(),
      duration_seconds: event.durationSeconds,
      // A finished call's SDP is a spent handshake artefact, not history.
      remote_sdp: null,
    })
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .eq("wa_call_id", event.callId);

  await broadcast(event.callId, {
    kind: "ended",
    status: failed ? "failed" : "completed",
    durationSeconds: event.durationSeconds,
  });
}

/** Apply a RINGING / ACCEPTED / REJECTED status entry. */
async function applyCallStatus(status: CallStatusEvent): Promise<void> {
  const call = await getCall(status.callId);
  if (!call) return;
  if (!(await claimEvent(call.id, status.callId, status.status, status))) return;

  // `connect` already moved a business-initiated call to `accepted`, and the
  // two webhooks race. Never walk a call backwards out of a later state.
  const rank: Record<string, number> = {
    initiated: 0,
    ringing: 1,
    accepted: 2,
    connected: 3,
  };
  const next = status.status === "rejected" ? "rejected" : status.status;
  if (status.status !== "rejected" && (rank[next] ?? 0) <= (rank[call.status] ?? 0)) {
    return;
  }

  await getAdminSupabaseClient()
    .from("calls")
    .update({
      status: next,
      ...(status.status === "rejected"
        ? { ended_at: new Date().toISOString(), remote_sdp: null }
        : {}),
    })
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .eq("wa_call_id", status.callId);

  await broadcast(status.callId, { kind: "status", status: next });
}

/**
 * Entry point for the `calls` webhook field.
 *
 * Swallows per-entry failures so one malformed call cannot abort the rest of
 * the batch — and, more importantly, cannot bubble into the route that also
 * carries message ingestion.
 */
export async function ingestCalls(value: {
  calls?: unknown[];
  statuses?: unknown[];
}): Promise<void> {
  for (const raw of value.calls ?? []) {
    const event = parseCallEvent(raw);
    if (!event) {
      console.warn("[calls] unrecognised call entry", JSON.stringify(raw)?.slice(0, 300));
      continue;
    }
    try {
      await applyCallEvent(event);
    } catch (error) {
      console.error(`[calls] ${event.event} for ${event.callId} failed`, error);
    }
  }

  for (const raw of value.statuses ?? []) {
    const status = parseCallStatus(raw);
    if (!status) continue;
    try {
      await applyCallStatus(status);
    } catch (error) {
      console.error(`[calls] status for ${status.callId} failed`, error);
    }
  }
}
