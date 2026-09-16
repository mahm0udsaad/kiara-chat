/**
 * The Cloud API calling surface, kept apart from meta.ts.
 *
 * Messaging and calling share a phone number, a token and `metaGraphCall`, but
 * nothing else: calling has its own endpoint (`/calls`), its own webhook field,
 * and its own permission model. Keeping it in its own module means the live
 * message transport — which carries the spa's entire customer contact — is not
 * edited to add a call feature.
 *
 * Media never passes through here. Every function below moves an SDP blob or a
 * call id over HTTPS; the SRTP flows directly between whichever client authored
 * the SDP and Meta's media servers.
 */
import { metaCloudConfig, metaErrorCode, metaGraphCall } from "./meta-api";

/** Graph wants a bare number: `+966501234567` → `966501234567`. */
function recipient(e164: string): string {
  return e164.trim().replace(/\D/g, "");
}

function phoneNumberId(): string {
  const { phoneNumberId } = metaCloudConfig();
  if (!phoneNumberId) {
    throw new Error("Meta Cloud API is not configured: missing phone number ID");
  }
  return phoneNumberId;
}

/**
 * Meta's answer when a call is attempted without permission. Surfaced so the
 * caller can say why in Arabic rather than showing a generic failure.
 */
export const NO_CALL_PERMISSION_ERROR = "138006";

export type CallPermissionStatus =
  | "no_permission"
  | "temporary"
  | "permanent";

export interface CallPermissionState {
  status: CallPermissionStatus;
  /** Present for a temporary grant; seconds since epoch. */
  expiresAt: number | null;
  /**
   * Whether Graph will currently accept a permission request for this user.
   * Asking is capped at 1 per 24h and 2 per 7 days, so a UI that offers the
   * button unconditionally will produce failures the customer never sees.
   */
  canRequest: boolean;
  /**
   * Whether the response was actually understood.
   *
   * False means Graph answered with a shape this parser does not recognise, so
   * `status` is a default rather than a reading. Callers must not treat that
   * as "no permission" — downgrading a live grant on an unparsed response
   * would silently remove the call button from a customer who had said yes.
   */
  recognised: boolean;
  /** Everything Graph returned, for logging a shape that drifted. */
  raw: unknown;
}

type PermissionResponse = {
  data?: Array<{
    status?: string;
    expiration_time?: number | string;
    expiration_timestamp?: number | string;
    actions?: Array<{ name?: string; limit?: number; remaining_quota?: number }>;
  }>;
};

function asEpochSeconds(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return null;
}

/**
 * Read the live permission state for one customer.
 *
 * This is the authority, not our table. A grant can disappear without a
 * webhook — the customer revokes it in the business profile, or four
 * unanswered calls revoke it automatically — so anything that decides whether
 * a call may be placed reads this first.
 */
export async function fetchCallPermission(
  customerE164: string,
): Promise<CallPermissionState> {
  const result = await metaGraphCall<PermissionResponse>(
    `/${phoneNumberId()}/call_permissions?user_wa_id=${recipient(customerE164)}`,
    { method: "GET" },
  );

  const entry = result.data?.[0];
  const rawStatus = String(entry?.status ?? "").toLowerCase();
  const status: CallPermissionStatus =
    rawStatus === "temporary" || rawStatus === "permanent"
      ? rawStatus
      : "no_permission";

  // An empty `data` array is a real answer — this user has no permission. A
  // missing array, or an entry whose status is a word this parser has never
  // seen, is not: it means the response shape moved. Say so rather than
  // reporting a confident "no".
  const recognised =
    Array.isArray(result.data) &&
    (result.data.length === 0 ||
      rawStatus === "temporary" ||
      rawStatus === "permanent" ||
      rawStatus === "no_permission");
  if (!recognised) {
    console.error(
      "[meta-calling] unrecognised call_permissions response shape: " +
        JSON.stringify(result).slice(0, 500),
    );
  }

  // The field has been spelled both ways across API versions; read either
  // rather than silently reporting a temporary grant as never-expiring.
  const expiresAt =
    asEpochSeconds(entry?.expiration_time) ??
    asEpochSeconds(entry?.expiration_timestamp);

  const requestAction = entry?.actions?.find(
    (action) => action?.name === "send_call_permission_request",
  );
  // Absent quota information is treated as "allowed": Graph rejects an
  // over-quota request on its own, and refusing to show the button because a
  // field was missing is the worse failure.
  const canRequest = requestAction
    ? (requestAction.remaining_quota ?? 1) > 0
    : true;

  return { status, expiresAt, canRequest, recognised, raw: result };
}

export interface PermissionRequestResult {
  /** The request message's id — correlates the customer's reply back to us. */
  messageSid: string;
}

/**
 * Ask a customer for permission to call them.
 *
 * Inside the 24-hour service window this is a free-form interactive message and
 * costs nothing, which is why it is the default path: a template request is
 * billed at the marketing rate (~SAR 0.19), roughly what a five-minute call to
 * a Saudi number costs. The body text is ours; the buttons and the rest of the
 * card are fixed by WhatsApp and cannot be styled.
 */
export async function sendCallPermissionRequest(
  customerE164: string,
  bodyText: string,
): Promise<PermissionRequestResult> {
  const body = bodyText.trim();
  if (!body) throw new Error("CALL_PERMISSION_BODY_REQUIRED");

  const result = await metaGraphCall<{ messages?: Array<{ id?: string }> }>(
    `/${phoneNumberId()}/messages`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: recipient(customerE164),
        type: "interactive",
        interactive: {
          type: "call_permission_request",
          action: { name: "call_permission_request" },
          body: { text: body },
        },
      }),
    },
  );

  const id = result.messages?.[0]?.id;
  if (!id) throw new Error("META_EMPTY_RESPONSE: no message id returned");
  return { messageSid: id };
}

/**
 * The customer's reply, as it arrives on the `messages` webhook.
 *
 * A permission reply is an interactive *message*, not a `calls` event — so it
 * flows through the existing message ingestion path rather than the call
 * handler.
 */
export interface CallPermissionReply {
  response: "accept" | "reject";
  isPermanent: boolean;
  /** Seconds since epoch; null for a permanent grant. */
  expiresAt: number | null;
  responseSource: string | null;
  /** Id of the request message this answers, from the message `context`. */
  requestMessageSid: string | null;
}

type InteractiveReply = {
  type?: string;
  call_permission_reply?: {
    response?: string;
    is_permanent?: boolean;
    expiration_timestamp?: number | string;
    response_source?: string;
  };
};

/**
 * Pull a permission reply out of an inbound message, or return null if this
 * message is anything else. Deliberately total: it never throws, so a drifted
 * payload cannot take down message ingestion.
 */
export function parseCallPermissionReply(message: {
  interactive?: unknown;
  context?: { id?: string } | null;
}): CallPermissionReply | null {
  const interactive = message.interactive as InteractiveReply | undefined;
  if (!interactive || interactive.type !== "call_permission_reply") return null;

  const reply = interactive.call_permission_reply;
  const response = String(reply?.response ?? "").toLowerCase();
  if (response !== "accept" && response !== "reject") return null;

  return {
    response,
    isPermanent: reply?.is_permanent === true,
    expiresAt: asEpochSeconds(reply?.expiration_timestamp),
    responseSource:
      typeof reply?.response_source === "string" ? reply.response_source : null,
    requestMessageSid: message.context?.id ?? null,
  };
}

// ── Call actions ───────────────────────────────────────────────────────────
//
// All five share one endpoint, `POST /<PHONE_NUMBER_ID>/calls`, and differ
// only by `action`. They are separate functions because the required fields
// differ and getting them wrong is a failed call, not a type error.

async function callAction<T>(payload: Record<string, unknown>): Promise<T> {
  return metaGraphCall<T>(`/${phoneNumberId()}/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
  });
}

export interface PlacedCall {
  /** Meta's call id, `wacid.…`. */
  callId: string;
}

/**
 * Place a call, offering the SDP the caller's client produced.
 *
 * The offer must already carry its ICE candidates: this API takes one complete
 * SDP rather than trickling candidates afterwards, so the client has to let
 * gathering finish (or time out) before calling this.
 *
 * Throws `META_138006…` when the customer has not granted permission — check
 * `isMissingCallPermission` on the error rather than matching the string.
 */
export async function placeCall(input: {
  toE164: string;
  sdp: string;
  /** Echoed back on status webhooks; max 512 characters. */
  callbackData?: string;
}): Promise<PlacedCall> {
  const result = await callAction<{ calls?: Array<{ id?: string }> }>({
    to: recipient(input.toE164),
    action: "connect",
    session: { sdp_type: "offer", sdp: input.sdp },
    ...(input.callbackData
      ? { biz_opaque_callback_data: input.callbackData.slice(0, 512) }
      : {}),
  });

  const callId = result.calls?.[0]?.id;
  if (!callId) throw new Error("META_EMPTY_RESPONSE: no call id returned");
  return { callId };
}

/**
 * Signal that we are about to answer an incoming call, so media can start
 * negotiating before the employee actually picks up.
 *
 * Sent before `accept` on purpose: accepting first means the customer hears
 * silence while ICE and DTLS complete.
 */
export async function preAcceptCall(callId: string, sdpAnswer: string): Promise<void> {
  await callAction({
    call_id: callId,
    action: "pre_accept",
    session: { sdp_type: "answer", sdp: sdpAnswer },
  });
}

/** Answer an incoming call. */
export async function acceptCall(input: {
  callId: string;
  sdp: string;
  callbackData?: string;
}): Promise<void> {
  await callAction({
    call_id: input.callId,
    action: "accept",
    session: { sdp_type: "answer", sdp: input.sdp },
    ...(input.callbackData
      ? { biz_opaque_callback_data: input.callbackData.slice(0, 512) }
      : {}),
  });
}

/** Decline an incoming call without answering it. */
export async function rejectCall(callId: string): Promise<void> {
  await callAction({ call_id: callId, action: "reject" });
}

/**
 * Hang up a call in any state.
 *
 * Safe to send for a call that has already ended — Meta answers with an error
 * that this deliberately swallows, because "hang up" is what the employee
 * asked for and the call is in fact down.
 */
export async function terminateCall(callId: string): Promise<void> {
  try {
    await callAction({ call_id: callId, action: "terminate" });
  } catch (error) {
    const code = metaErrorCode(error);
    // 138007 and its neighbours mean "no such live call". Anything else is a
    // real failure the caller should see.
    if (code && /^13800[0-9]/.test(code)) return;
    throw error;
  }
}

/** True when a call failed purely because the customer never granted permission. */
export function isMissingCallPermission(error: unknown): boolean {
  return metaErrorCode(error)?.startsWith(NO_CALL_PERMISSION_ERROR) === true;
}

// ── Inbound `calls` webhook ────────────────────────────────────────────────

export type CallEventName = "connect" | "terminate";

export interface CallWebhookEvent {
  callId: string;
  event: CallEventName;
  direction: "business_initiated" | "user_initiated";
  from: string | null;
  to: string | null;
  /** Present on `connect`: the peer's SDP. */
  sdp: string | null;
  sdpType: "offer" | "answer" | null;
  /** Present on `terminate`. */
  status: string | null;
  startedAt: number | null;
  endedAt: number | null;
  durationSeconds: number | null;
}

type RawCall = {
  id?: string;
  from?: string;
  to?: string;
  event?: string;
  direction?: string;
  status?: string;
  start_time?: number | string;
  end_time?: number | string;
  duration?: number | string;
  session?: { sdp_type?: string; sdp?: string };
};

function e164OrNull(value: unknown): string | null {
  const digits = typeof value === "string" ? value.replace(/\D/g, "") : "";
  return digits ? `+${digits}` : null;
}

/**
 * Normalise one entry of the `calls` webhook array.
 *
 * Total, like the permission parser and for the same reason: an unrecognised
 * payload returns null rather than throwing inside the webhook that carries the
 * spa's live inbox.
 */
export function parseCallEvent(raw: unknown): CallWebhookEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const call = raw as RawCall;

  const callId = typeof call.id === "string" ? call.id.trim() : "";
  if (!callId) return null;

  const event = String(call.event ?? "").toLowerCase();
  if (event !== "connect" && event !== "terminate") return null;

  const direction =
    String(call.direction ?? "").toUpperCase() === "USER_INITIATED"
      ? "user_initiated"
      : "business_initiated";

  const sdpType = String(call.session?.sdp_type ?? "").toLowerCase();

  return {
    callId,
    event,
    direction,
    from: e164OrNull(call.from),
    to: e164OrNull(call.to),
    sdp: typeof call.session?.sdp === "string" ? call.session.sdp : null,
    sdpType: sdpType === "offer" || sdpType === "answer" ? sdpType : null,
    status: typeof call.status === "string" ? call.status.toUpperCase() : null,
    startedAt: asEpochSeconds(call.start_time),
    endedAt: asEpochSeconds(call.end_time),
    durationSeconds: asEpochSeconds(call.duration),
  };
}

/** A `RINGING` / `ACCEPTED` / `REJECTED` entry from the webhook's statuses. */
export interface CallStatusEvent {
  callId: string;
  status: "ringing" | "accepted" | "rejected";
  callbackData: string | null;
}

export function parseCallStatus(raw: unknown): CallStatusEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const entry = raw as {
    id?: string;
    status?: string;
    biz_opaque_callback_data?: string;
  };

  const callId = typeof entry.id === "string" ? entry.id.trim() : "";
  if (!callId) return null;

  const status = String(entry.status ?? "").toLowerCase();
  if (status !== "ringing" && status !== "accepted" && status !== "rejected") {
    return null;
  }

  return {
    callId,
    status,
    callbackData:
      typeof entry.biz_opaque_callback_data === "string"
        ? entry.biz_opaque_callback_data
        : null,
  };
}
