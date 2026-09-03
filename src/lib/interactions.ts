/**
 * Server-side inbox interactions for Kiara: ownership (Take/Transfer/Release via
 * the shared atomic claim_conversation RPC), CS status, and agent replies
 * (through the transport layer). Callers must be authorized Kiara members —
 * the API routes enforce that; these helpers assume it and use the admin client.
 */
import { after } from "next/server";
import { randomUUID } from "crypto";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { KIARA_RESTAURANT_ID, type KiaraSession } from "@/lib/tenant";
import {
  isProviderConfigured,
  transportForConversation,
} from "@/lib/transport";
import type { MessageTransport, SendResult } from "@/lib/transport/types";
import { getServiceWindow, isWindowClosedError } from "@/lib/transport/window";
import {
  contentSidFor,
  greetingName,
  renderTemplate,
  templateSpec,
  templateVariable,
  type TemplateKey,
} from "@/lib/templates";
import { twilioErrorCode } from "@/lib/transport/twilio";
import {
  uploadBase64Media,
  messageTypeFromContentType,
  MAX_MEDIA_BYTES,
} from "@/lib/storage-media";
import type {
  BookingStage,
  CsStatus,
  AgentInfo,
  Conversation,
  ConversationSection,
} from "@/lib/types";

export type { CsStatus, AgentInfo };

/**
 * Deliver an already-recorded message and settle its status, after the HTTP
 * response has been sent. The provider call is the slowest thing on the send
 * path and nothing in the UI needs to wait for it — the message row already
 * exists, so the thread renders it immediately as "queued" and the UPDATE
 * streams the final status in over realtime.
 */
function deliverInBackground(
  messageId: string,
  conversationId: string,
  send: (
    transport: MessageTransport,
    options: { from: string | null },
  ) => Promise<SendResult>
): void {
  after(async () => {
    const admin = getAdminSupabaseClient();
    let sent = false;
    let providerId: string | null = null;
    // Resolving which number answers this thread costs a read, so it happens
    // here rather than on the send path — the message row already exists and
    // the UI is showing it as queued either way.
    const transport = await transportForConversation(conversationId);
    const configured = isProviderConfigured(transport.provider);
    const { data: convRow } = await admin
      .from("conversations")
      .select("metadata")
      .eq("id", conversationId)
      .maybeSingle();
    const waNumber =
      ((convRow?.metadata as Record<string, unknown> | null)?.wa_number as
        | string
        | undefined) ?? null;
    let failureMessage: string | null = null;
    let failureCode: string | null = null;
    if (configured) {
      try {
        const r = await send(transport, { from: waNumber });
        providerId = r.providerMessageId || null;
        sent = true;
      } catch (error) {
        sent = false;
        failureMessage = error instanceof Error ? error.message : String(error);
        failureCode = twilioErrorCode(error);
        console.error(
          `[send] ${transport.provider} media failed: ${failureMessage}`,
        );
      }
    }

    // Read metadata after delivery. Other actions (for example recording that
    // a reservation reminder was sent) may have updated it while the transport
    // request was in flight; writing the stale pre-send object would erase them.
    const { data: currentConversation } = await admin
      .from("conversations")
      .select("metadata")
      .eq("id", conversationId)
      .maybeSingle();
    const currentMetadata =
      (currentConversation?.metadata as Record<string, unknown> | null) ?? {};

    await Promise.all([
      admin
        .from("messages")
        .update({
          delivery_status: sent ? "sent" : configured ? "failed" : "queued",
          external_message_sid: providerId,
          error_message: failureMessage ? failureMessage.slice(0, 500) : null,
          external_error_code: failureCode,
          // Same value in both columns: dedupe and ack lookup keep using
          // external_message_sid, while the Twilio column becomes meaningful.
          ...(transport.provider === "twilio" && providerId
            ? { twilio_message_sid: providerId }
            : {}),
        })
        .eq("id", messageId),
      // Bump activity + clear "handled on WhatsApp" (now handled in-app).
      admin
        .from("conversations")
        .update({
          last_message_at: new Date().toISOString(),
          metadata: { ...currentMetadata, handled_on_whatsapp: false },
        })
        .eq("id", conversationId),
    ]);
  });
}

/**
 * Take = self-claim (atomic first-writer-wins via the shared RPC).
 * Uses the AUTHED client — claim_conversation validates auth.uid() is a member,
 * so it must run as the caller (the service-role client has no auth.uid()).
 */
export async function takeConversation(conversationId: string, teamMemberId: string) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("claim_conversation", {
    p_conversation_id: conversationId,
    p_mode: "human",
    p_team_member_id: teamMemberId,
  });
  if (error) throw new Error(error.message);
  return data;
}

export class TakeoverError extends Error {
  constructor(
    public readonly code:
      | "TAKEOVER_ADMIN_ONLY"
      | "TAKEOVER_REASON_REQUIRED"
      | "TAKEOVER_NOT_NEEDED"
      | "TAKEOVER_AUDIT_FAILED",
  ) {
    super(code);
    this.name = "TakeoverError";
  }
}

const TAKEOVER_REASON_MIN = 3;
const TAKEOVER_REASON_MAX = 500;

/**
 * Admin takeover of a conversation another employee holds.
 *
 * Replying into someone else's thread used to be an unrecorded admin
 * privilege: the reply routes simply skipped the assignment check for admins,
 * so an intervention left no trace beyond the message itself. The operations
 * plan requires the opposite — an explicit takeover carrying a reason, and an
 * event that survives whatever happens to the roster afterwards.
 *
 * `claim_conversation(p_force => true)` does the reassignment. It is reused
 * rather than reimplemented because it is SECURITY DEFINER, re-checks
 * `is_restaurant_admin` in the database (so this is not enforced in TypeScript
 * alone), and writes the `conversation_claim_events` row the web history
 * already reads.
 */
export async function takeOverConversation(input: {
  conversationId: string;
  session: KiaraSession;
  reason: string;
}): Promise<{ previousAssignee: string | null }> {
  const { conversationId, session } = input;
  const reason = input.reason.trim();

  if (session.role !== "admin" || !session.teamMemberId) {
    throw new TakeoverError("TAKEOVER_ADMIN_ONLY");
  }
  if (
    reason.length < TAKEOVER_REASON_MIN ||
    reason.length > TAKEOVER_REASON_MAX
  ) {
    throw new TakeoverError("TAKEOVER_REASON_REQUIRED");
  }

  const admin = getAdminSupabaseClient();
  const { data: before, error: beforeError } = await admin
    .from("conversations")
    .select("id, assigned_to")
    .eq("id", conversationId)
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .maybeSingle();
  if (beforeError) throw new Error(beforeError.message);
  if (!before) throw new Error("conversation_not_found");

  const previousAssignee = (before.assigned_to as string | null) ?? null;
  // Taking a thread nobody holds is an ordinary claim, not an override, and
  // must not be dressed up as one in the audit trail.
  if (!previousAssignee || previousAssignee === session.teamMemberId) {
    throw new TakeoverError("TAKEOVER_NOT_NEEDED");
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("claim_conversation", {
    p_conversation_id: conversationId,
    p_mode: "human",
    p_team_member_id: session.teamMemberId,
    p_force: true,
    p_assign_to_team_member_id: session.teamMemberId,
  });
  if (error) throw new Error(error.message);

  const { error: eventError } = await admin.from("operation_events").insert({
    restaurant_id: KIARA_RESTAURANT_ID,
    aggregate_type: "conversation",
    aggregate_id: conversationId,
    event_type: "conversation.taken_over",
    actor_type: "team_member",
    actor_role: session.role,
    actor_user_id: session.userId,
    actor_team_member_id: session.teamMemberId,
    payload: {
      reason,
      previousAssignee,
    },
  });
  if (eventError) {
    // The reassignment already happened and `conversation_claim_events` holds
    // a 'reassign' row for it, so the override itself is not lost — but the
    // reason is, and that is the part the owner report is built on. Surface it
    // rather than letting a silent partial look like a clean takeover.
    console.error("[takeover] reassigned but the reason was not recorded", eventError);
    throw new TakeoverError("TAKEOVER_AUDIT_FAILED");
  }

  return { previousAssignee };
}

/** Transfer = force-reassign to another agent (authed, same reason as Take). */
export async function transferConversation(
  conversationId: string,
  myTeamMemberId: string,
  targetTeamMemberId: string
) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("claim_conversation", {
    p_conversation_id: conversationId,
    p_mode: "human",
    p_team_member_id: myTeamMemberId,
    p_force: true,
    p_assign_to_team_member_id: targetTeamMemberId,
  });
  if (error) throw new Error(error.message);
  return data;
}

/** Clear the unread badge when an agent opens the thread. */
export async function markConversationRead(conversationId: string) {
  const { error } = await getAdminSupabaseClient()
    .from("conversations")
    .update({ unread_count: 0 })
    .eq("id", conversationId)
    .eq("restaurant_id", KIARA_RESTAURANT_ID);
  if (error) throw new Error(error.message);
}

/** Release = back to the shared queue (unassigned). */
export async function releaseConversation(conversationId: string) {
  const { error } = await getAdminSupabaseClient()
    .from("conversations")
    .update({ handler_mode: "unassigned", assigned_to: null, assigned_at: null })
    .eq("id", conversationId)
    .eq("restaurant_id", KIARA_RESTAURANT_ID);
  if (error) throw new Error(error.message);
}

/**
 * Name the customer by hand. WhatsApp only ever gives us whatever display name
 * the sender set — often nothing, sometimes "ا" — while staff know exactly who
 * these people are. Null clears it, and the inbox falls back to the number.
 *
 * Unlike the ingest path, this overwrites: it's a deliberate correction.
 */
export async function setCustomerName(conversationId: string, name: string | null) {
  const { error } = await getAdminSupabaseClient()
    .from("conversations")
    .update({ customer_name: name })
    .eq("id", conversationId)
    .eq("restaurant_id", KIARA_RESTAURANT_ID);
  if (error) throw new Error(error.message);
}

/** Set Kiara CS status; mirrors the DB status column to satisfy its CHECK. */
export async function setCsStatus(conversationId: string, csStatus: CsStatus) {
  const admin = getAdminSupabaseClient();
  const { data, error: readError } = await admin
    .from("conversations")
    .select("metadata")
    .eq("id", conversationId)
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  const metadata = {
    ...((data?.metadata as Record<string, unknown>) ?? {}),
    cs_status: csStatus,
  };
  const dbStatus = csStatus === "resolved" ? "resolved" : "active";
  const { error } = await admin
    .from("conversations")
    .update({ metadata, status: dbStatus })
    .eq("id", conversationId)
    .eq("restaurant_id", KIARA_RESTAURANT_ID);
  if (error) throw new Error(error.message);
}

/**
 * Set the operational booking stage without a schema migration. The final
 * stage resolves the conversation; moving to any earlier stage reopens it.
 */
export async function setBookingStage(
  conversationId: string,
  bookingStage: BookingStage
) {
  const admin = getAdminSupabaseClient();
  const { data, error: readError } = await admin
    .from("conversations")
    .select("metadata")
    .eq("id", conversationId)
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  const completed = bookingStage === "completed";
  const metadata = {
    ...((data?.metadata as Record<string, unknown>) ?? {}),
    booking_stage: bookingStage,
    cs_status: completed ? "resolved" : "open",
  };
  const { error } = await admin
    .from("conversations")
    .update({ metadata, status: completed ? "resolved" : "active" })
    .eq("id", conversationId)
    .eq("restaurant_id", KIARA_RESTAURANT_ID);
  if (error) throw new Error(error.message);
}

/** Read-modify-write one key of a conversation's metadata. Owner-only callers. */
async function patchMetadata(
  conversationId: string,
  patch: Record<string, unknown>
): Promise<Conversation | null> {
  const admin = getAdminSupabaseClient();
  const { data, error: readError } = await admin
    .from("conversations")
    .select("metadata")
    .eq("id", conversationId)
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  const metadata = { ...((data?.metadata as Record<string, unknown>) ?? {}), ...patch };
  for (const [k, v] of Object.entries(patch)) if (v === null) delete metadata[k];

  const { data: updated, error } = await admin
    .from("conversations")
    .update({ metadata })
    .eq("id", conversationId)
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .select(
      "id, restaurant_id, customer_phone, customer_name, status, started_at, last_message_at, last_inbound_at, handler_mode, assigned_to, unread_count, metadata"
    )
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (updated as Conversation) ?? null;
}

/** Tag the chat with the desk that handles it (الطلبات / الردود). Owner-only. */
export async function setConversationSection(
  conversationId: string,
  section: ConversationSection | null
) {
  return patchMetadata(conversationId, { section });
}

/**
 * Route a chat exclusively to one employee — nobody else sees it or is notified
 * about it (lib/conversation-meta.ts). Routing also assigns the chat to them so
 * it lands under "لي" with their name on it; un-routing leaves ownership alone,
 * since the assignee is usually still the right person to answer.
 *
 * Writes with the admin client on purpose: the owner may have no team_members
 * row of their own, so the claim RPC (which needs the caller's member id) is
 * not an option here.
 */
export async function setConversationRouting(
  conversationId: string,
  targetTeamMemberId: string | null
) {
  const conversation = await patchMetadata(conversationId, {
    routed_to: targetTeamMemberId,
  });
  if (!targetTeamMemberId) return conversation;

  const { data, error } = await getAdminSupabaseClient()
    .from("conversations")
    .update({
      assigned_to: targetTeamMemberId,
      handler_mode: "human",
      assigned_at: new Date().toISOString(),
    })
    .eq("id", conversationId)
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .select(
      "id, restaurant_id, customer_phone, customer_name, status, started_at, last_message_at, last_inbound_at, handler_mode, assigned_to, unread_count, metadata"
    )
    .maybeSingle();
  if (error) throw new Error(error.message);
  return ((data as Conversation) ?? conversation) ?? null;
}

/**
 * Deliver a text reply, honouring the 24-hour service window.
 *
 * Inside the window this is an ordinary send. Outside it — which on the Twilio
 * number is every conversation the customer has not just written to — Meta will
 * deliver nothing but an approved template, so the agent's own words cannot go
 * out at all. Rather than failing silently, we send the follow-up template so
 * the customer has a one-tap way to reply (which reopens the window), and mark
 * the agent's message undelivered with the reason attached. The inbox already
 * renders `undelivered` distinctly, so the agent can see their text did not
 * land instead of assuming it did.
 */
function deliverTextReply(params: {
  messageId: string;
  conversationId: string;
  toE164: string;
  customerName: string | null;
  body: string;
}): void {
  after(async () => {
    const admin = getAdminSupabaseClient();
    const transport = await transportForConversation(params.conversationId);
    const configured = isProviderConfigured(transport.provider);

    // The number she wrote to, recorded from the inbound message itself. Sending
    // from anything else would reach her as a message from a stranger, and a
    // misconfigured env var would fail every send with no way to see why.
    const { data: convRow } = await admin
      .from("conversations")
      .select("metadata")
      .eq("id", params.conversationId)
      .maybeSingle();
    const waNumber =
      ((convRow?.metadata as Record<string, unknown> | null)?.wa_number as
        | string
        | undefined) ?? null;
    const sendOptions = { from: waNumber };

    let status = "queued";
    let providerId: string | null = null;
    // Why a send did not happen is the whole story when one does not, and it
    // used to be thrown away here — leaving a red tick in the inbox and no way
    // to tell a closed window from a bad credential without reading Twilio's
    // console. The columns for this already existed.
    let failureMessage: string | null = null;
    let failureCode: string | null = null;
    const extra: Record<string, unknown> = {};

    const sendTemplateFallback = async (): Promise<boolean> => {
      const contentSid = contentSidFor("booking_followup");
      if (!contentSid) {
        extra.window_closed = true;
        extra.reengagement_sent = false;
        extra.reason = "TEMPLATE_NOT_CONFIGURED";
        return false;
      }
      try {
        const r = await transport.sendTemplate(
          params.toE164,
          contentSid,
          { "1": greetingName(params.customerName) },
          sendOptions,
        );
        extra.window_closed = true;
        extra.reengagement_sent = true;
        extra.reengagement_sid = r.providerMessageId;
        return true;
      } catch (error) {
        extra.window_closed = true;
        extra.reengagement_sent = false;
        extra.reason = "TEMPLATE_SEND_FAILED";
        failureMessage = error instanceof Error ? error.message : String(error);
        failureCode = twilioErrorCode(error);
        return false;
      }
    };

    if (configured) {
      // Only the Business Platform enforces a window; a linked device does not.
      const windowOpen =
        transport.provider !== "twilio" ||
        (await getServiceWindow(params.conversationId)).open;

      if (!windowOpen) {
        await sendTemplateFallback();
        status = "undelivered";
      } else {
        try {
          const r = await transport.sendText(
            params.toE164,
            params.body,
            sendOptions,
          );
          providerId = r.providerMessageId || null;
          status = "sent";
        } catch (error) {
          // The window can shut between the check and the send.
          if (isWindowClosedError(error)) {
            await sendTemplateFallback();
            status = "undelivered";
          } else {
            status = "failed";
            failureMessage =
              error instanceof Error ? error.message : String(error);
            failureCode = twilioErrorCode(error);
            console.error(
              `[send] ${transport.provider} reply failed: ${failureMessage}`,
            );
          }
        }
      }
    }

    const { data: currentMessage } = await admin
      .from("messages")
      .select("metadata")
      .eq("id", params.messageId)
      .maybeSingle();
    const currentMeta =
      (currentMessage?.metadata as Record<string, unknown> | null) ?? {};

    const { data: currentConversation } = await admin
      .from("conversations")
      .select("metadata")
      .eq("id", params.conversationId)
      .maybeSingle();
    const convMeta =
      (currentConversation?.metadata as Record<string, unknown> | null) ?? {};

    await Promise.all([
      admin
        .from("messages")
        .update({
          delivery_status: status,
          external_message_sid: providerId,
          ...(transport.provider === "twilio" && providerId
            ? { twilio_message_sid: providerId }
            : {}),
          error_message: failureMessage ? failureMessage.slice(0, 500) : null,
          external_error_code: failureCode,
          metadata: { ...currentMeta, ...extra },
        })
        .eq("id", params.messageId),
      admin
        .from("conversations")
        .update({
          last_message_at: new Date().toISOString(),
          metadata: { ...convMeta, handled_on_whatsapp: false },
        })
        .eq("id", params.conversationId),
    ]);
  });
}

/** Send an agent reply through the transport layer; records it either way. */
export async function sendReply(
  conversationId: string,
  sender: { email: string | null; teamMemberId?: string | null },
  body: string,
  clientRequestId: string = randomUUID(),
): Promise<{ messageId: string | null; sent: boolean }> {
  const admin = getAdminSupabaseClient();
  const { data: conv } = await admin
    .from("conversations")
    .select("id, customer_phone, customer_name")
    .eq("id", conversationId)
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .maybeSingle();
  if (!conv) throw new Error("Conversation not found");

  const { data: msg, error } = await admin
    .from("messages")
    .insert({
      conversation_id: conversationId,
      role: "agent",
      content: body,
      message_type: "text",
      metadata: { source: "app", sent_by_email: sender.email },
      // Stable attribution for per-employee reporting; the email in metadata
      // is only a human-readable fallback.
      sender_team_member_id: sender.teamMemberId ?? null,
      channel: "whatsapp",
      delivery_status: "queued",
      client_request_id: clientRequestId,
    })
    .select("id")
    .single();
  if (error?.code === "23505") {
    const { data: existing, error: existingError } = await admin
      .from("messages")
      .select("id")
      .eq("conversation_id", conversationId)
      .eq("client_request_id", clientRequestId)
      .maybeSingle();
    if (existingError || !existing?.id) {
      throw new Error(existingError?.message ?? "Unable to resolve duplicate reply");
    }
    return { messageId: existing.id as string, sent: false };
  }
  if (error) throw new Error(`Failed to record reply: ${error.message}`);

  const messageId = msg!.id as string;
  deliverTextReply({
    messageId,
    conversationId,
    toE164: conv.customer_phone as string,
    customerName: (conv.customer_name as string | null) ?? null,
    body,
  });

  return { messageId, sent: false };
}

/**
 * Send an approved template.
 *
 * The only way to reach a customer who has not written in the last 24 hours —
 * including one who has never written at all, which is the whole point of
 * being able to start a conversation from the app.
 *
 * Unlike a free-form reply this is sent inline rather than in the background:
 * a template send is deliberate, the employee has just filled its variables in
 * and is watching, and a failure she cannot see would leave her believing a
 * customer was contacted when she was not.
 */
export async function sendTemplateReply(
  conversationId: string,
  sender: { email: string | null; teamMemberId?: string | null },
  key: TemplateKey,
  variables: Record<string, string>,
): Promise<{ messageId: string | null; sent: boolean; error: string | null }> {
  const admin = getAdminSupabaseClient();
  const { data: conv } = await admin
    .from("conversations")
    .select("id, customer_phone, customer_name, metadata")
    .eq("id", conversationId)
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .maybeSingle();
  if (!conv) throw new Error("Conversation not found");

  const contentSid = contentSidFor(key);
  if (!contentSid) {
    throw new Error("هذا القالب غير مُهيّأ بعد. راجعي إعدادات النشر.");
  }

  const spec = templateSpec(key);
  // Sanitise here rather than trusting the caller: a newline inside a variable
  // is rejected by Meta at send time, far from whoever typed it.
  const clean: Record<string, string> = {};
  for (const variable of spec.variables) {
    const raw = variables[variable.key] ?? "";
    const value =
      variable.prefill === "customer_name" && !raw.trim()
        ? greetingName(conv.customer_name as string | null)
        : templateVariable(raw, variable.maxLength ?? 512);
    if (!value) throw new Error(`الحقل «${variable.label}» مطلوب.`);
    clean[variable.key] = value;
  }

  const transport = await transportForConversation(conversationId);
  if (!isProviderConfigured(transport.provider)) {
    throw new Error("خدمة الواتساب غير متصلة.");
  }
  const waNumber =
    ((conv.metadata as Record<string, unknown> | null)?.wa_number as
      | string
      | undefined) ?? null;

  let providerId: string | null = null;
  let failure: string | null = null;
  try {
    const result = await transport.sendTemplate(
      conv.customer_phone as string,
      contentSid,
      clean,
      { from: waNumber },
    );
    providerId = result.providerMessageId || null;
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
    console.error(`[template] ${key} failed: ${failure}`);
  }

  // Recorded either way, and with the text the customer actually sees — a
  // thread full of bubbles reading "template sent" tells the next employee
  // nothing about what this customer has already been told.
  const { data: msg } = await admin
    .from("messages")
    .insert({
      conversation_id: conversationId,
      role: "agent",
      content: renderTemplate(key, clean),
      message_type: "text",
      metadata: {
        source: "app",
        sent_by_email: sender.email,
        template: { key, contentSid, variables: clean, buttons: spec.buttons },
      },
      sender_team_member_id: sender.teamMemberId ?? null,
      channel: "whatsapp",
      delivery_status: failure ? "failed" : "sent",
      external_message_sid: providerId,
      ...(transport.provider === "twilio" && providerId
        ? { twilio_message_sid: providerId }
        : {}),
      error_message: failure ? failure.slice(0, 500) : null,
      external_error_code: twilioErrorCode(failure ? new Error(failure) : null),
    })
    .select("id")
    .single();

  if (!failure) {
    await admin
      .from("conversations")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", conversationId);
  }

  return {
    messageId: (msg?.id as string) ?? null,
    sent: !failure,
    error: failure,
  };
}

/**
 * Send an image / document / voice note. Stores our own copy in the bucket
 * first so the thread renders it even if the WhatsApp send fails, then hands
 * the bytes to the transport.
 */
export async function sendMediaReply(
  conversationId: string,
  sender: { email: string | null; teamMemberId?: string | null },
  file: { buffer: Buffer; contentType: string; filename: string | null },
  caption: string,
  options: { ptt?: boolean; clientRequestId?: string } = {},
): Promise<{ messageId: string | null; sent: boolean }> {
  const admin = getAdminSupabaseClient();
  const { data: conv } = await admin
    .from("conversations")
    .select("id, customer_phone")
    .eq("id", conversationId)
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .maybeSingle();
  if (!conv) throw new Error("Conversation not found");

  const clientRequestId = options.clientRequestId ?? randomUUID();
  const { data: alreadyRecorded, error: lookupError } = await admin
    .from("messages")
    .select("id")
    .eq("conversation_id", conversationId)
    .eq("client_request_id", clientRequestId)
    .maybeSingle();
  if (lookupError) throw new Error(lookupError.message);
  if (alreadyRecorded?.id) {
    return { messageId: alreadyRecorded.id as string, sent: false };
  }

  if (file.buffer.byteLength > MAX_MEDIA_BYTES) {
    throw new Error("الملف أكبر من الحد المسموح (16 ميجابايت)");
  }

  const base64 = file.buffer.toString("base64");
  const messageType = options.ptt
    ? "voice"
    : messageTypeFromContentType(file.contentType);
  const slot = await uploadBase64Media({
    restaurantId: KIARA_RESTAURANT_ID,
    conversationId,
    contentType: file.contentType,
    base64,
    originalFilename: file.filename,
  });

  const { data: msg, error } = await admin
    .from("messages")
    .insert({
      conversation_id: conversationId,
      role: "agent",
      content: caption || "",
      message_type: messageType,
      metadata: {
        source: "app",
        sent_by_email: sender.email,
        media: [slot],
        ...(options.ptt ? { voice_note: true } : {}),
      },
      sender_team_member_id: sender.teamMemberId ?? null,
      channel: "whatsapp",
      delivery_status: "queued",
      client_request_id: clientRequestId,
    })
    .select("id")
    .single();
  if (error?.code === "23505") {
    const { data: existing, error: existingError } = await admin
      .from("messages")
      .select("id")
      .eq("conversation_id", conversationId)
      .eq("client_request_id", clientRequestId)
      .maybeSingle();
    if (existingError || !existing?.id) {
      throw new Error(existingError?.message ?? "Unable to resolve duplicate media send");
    }
    return { messageId: existing.id as string, sent: false };
  }
  if (error) throw new Error(`Failed to record media message: ${error.message}`);

  const messageId = msg!.id as string;
  deliverInBackground(messageId, conversationId, (transport, sendOptions) =>
    transport.sendMedia(conv.customer_phone as string, {
      base64,
      contentType: file.contentType,
      filename: file.filename ?? undefined,
      caption: caption || undefined,
      ptt: options.ptt,
      // Twilio fetches media rather than accepting bytes; the copy stored
      // above is what it fetches. OpenWA ignores this and uses base64.
      storagePath: slot.storage_path,
    }, sendOptions)
  );

  return { messageId, sent: false };
}

/**
 * Active Kiara agents for routing/ownership pickers.
 *
 * Names live on `team_members`, so the Inbox does not need one Auth Admin
 * request per employee. API consumers that still need email fallbacks can opt
 * in explicitly.
 */
export async function listAgents(
  options: { includeEmails?: boolean } = {}
): Promise<AgentInfo[]> {
  const admin = getAdminSupabaseClient();
  const { data } = await admin
    .from("team_members")
    .select("id, user_id, role, full_name, is_active")
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .eq("is_active", true)
    .order("created_at");
  const rows = data ?? [];
  return Promise.all(
    rows.map(async (a) => {
      let email: string | null = null;
      if (options.includeEmails) {
        try {
          const u = await admin.auth.admin.getUserById(a.user_id as string);
          email = u.data.user?.email ?? null;
        } catch {
          /* ignore */
        }
      }
      const fullName = ((a.full_name as string) || "").trim();
      return {
        id: a.id as string,
        role: a.role as string,
        email,
        fullName: fullName || null,
        isActive: Boolean(a.is_active),
      };
    })
  );
}
