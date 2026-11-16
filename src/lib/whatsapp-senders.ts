import "server-only";

import { CONVERSATION_EVENTS, recordConversationEvent } from "@/lib/audit";
import { staffKindForConversation } from "@/lib/staff-threads";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { KIARA_RESTAURANT_ID } from "@/lib/tenant";
import { inboxProvider, isProviderConfigured, transportFor } from "@/lib/transport";
import {
  createOpenWaTransport,
  type EngineConfig,
  type EngineState,
  getEngineState,
  isEngineConfigured,
} from "@/lib/transport/openwa";
import type { MessageTransport } from "@/lib/transport/types";
import {
  DEFAULT_SENDER_ID,
  pickSender,
  SenderError,
  type SenderRow,
  type SenderStatus,
} from "@/lib/whatsapp-senders-core";

export { DEFAULT_SENDER_ID, SenderError } from "@/lib/whatsapp-senders-core";
export type { SenderRow } from "@/lib/whatsapp-senders-core";

/**
 * The customer-facing numbers staff can reply from.
 *
 * The list and its rules live in `whatsapp_senders`; how to reach each
 * number lives only in server env, keyed by the sender id, so no credential
 * or engine URL ever reaches a client. Adding a third number is a table row
 * plus an `ENGINES` entry.
 */

/** Engine credentials per OpenWA sender id. The orders number is not here. */
const ENGINES: Record<string, EngineConfig> = {
  openwa_cs: { url: process.env.OPENWA_CS_URL, token: process.env.OPENWA_CS_SEND_TOKEN },
};

const ROWS_TTL_MS = 30_000;
const STATE_TTL_MS = 15_000;
let rowsCache: { at: number; rows: SenderRow[] } | null = null;
const stateCache = new Map<string, { at: number; ready: boolean; state: string }>();

export async function loadSenders(): Promise<SenderRow[]> {
  if (rowsCache && Date.now() - rowsCache.at < ROWS_TTL_MS) return rowsCache.rows;
  const { data, error } = await getAdminSupabaseClient()
    .from("whatsapp_senders")
    .select("id, provider, phone, label, enabled, allowed_roles, sort_order")
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as SenderRow[];
  rowsCache = { at: Date.now(), rows };
  return rows;
}

/** Is this number able to send right now? Engine state is cached briefly. */
async function statusOf(row: SenderRow): Promise<SenderStatus> {
  if (!row.enabled) return { available: false, reason: "disabled" };
  if (row.provider === "meta") {
    return isProviderConfigured(inboxProvider())
      ? { available: true, reason: null }
      : { available: false, reason: "not_configured" };
  }
  const engine = ENGINES[row.id];
  if (!engine || !isEngineConfigured(engine)) return { available: false, reason: "not_configured" };
  const cached = stateCache.get(row.id);
  let ready: boolean;
  let state: string;
  if (cached && Date.now() - cached.at < STATE_TTL_MS) {
    ({ ready, state } = cached);
  } else {
    state = (await getEngineState(engine)).state;
    ready = state === "ready" || state === "authenticated";
    stateCache.set(row.id, { at: Date.now(), ready, state });
  }
  if (ready) return { available: true, reason: null };
  return { available: false, reason: state === "unreachable" ? "unreachable" : "disconnected" };
}

export type SenderView = {
  id: string;
  provider: "meta" | "openwa";
  phone: string | null;
  label: string;
  available: boolean;
  unavailableReason: SenderStatus["reason"];
  isDefault: boolean;
};

/** The numbers this employee may choose from, with whether each can send now. */
export async function listSendersFor(role: string): Promise<SenderView[]> {
  const rows = (await loadSenders()).filter((row) => row.allowed_roles.includes(role));
  const statuses = await Promise.all(rows.map(statusOf));
  return rows.map((row, index) => ({
    id: row.id,
    provider: row.provider,
    phone: row.phone,
    label: row.label,
    available: statuses[index]!.available,
    unavailableReason: statuses[index]!.reason,
    isDefault: row.id === DEFAULT_SENDER_ID,
  }));
}

/**
 * The sender a customer reply uses: the one the employee had selected, or the
 * conversation's saved choice, or the default. Validated here — never trusted
 * from the client — and never swapped for another number when it cannot send.
 */
export async function resolveReplySender(input: {
  requested: string | null | undefined;
  saved: string | null | undefined;
  role?: string;
}): Promise<SenderRow> {
  const rows = await loadSenders();
  const row = pickSender(rows, input);
  const status = await statusOf(row);
  if (!status.available) {
    throw new SenderError(status.reason === "disabled" ? "SENDER_DISABLED" : "SENDER_UNAVAILABLE", row.id, status.reason);
  }
  return row;
}

/** The transport for a sender id, for the background delivery step. */
export function transportForSender(row: Pick<SenderRow, "id" | "provider">): MessageTransport {
  if (row.provider === "meta") return transportFor(inboxProvider());
  const engine = ENGINES[row.id];
  if (!engine || !isEngineConfigured(engine)) {
    throw new Error(`SENDER_NOT_CONFIGURED: ${row.id}`);
  }
  return createOpenWaTransport(engine);
}

/** Which OpenWA sender an ingest token belongs to; null for the orders number. */
export function senderForIngestToken(token: string | null): string | null {
  if (!token) return null;
  const cs = process.env.OPENWA_CS_INGEST_TOKEN;
  return cs && token === `Bearer ${cs}` ? "openwa_cs" : null;
}

/** Saves the team's choice for this conversation. Validated like a send. */
export async function setConversationSender(
  conversationId: string,
  senderId: string,
  role: string,
): Promise<SenderRow> {
  const rows = await loadSenders();
  const row = pickSender(rows, { requested: senderId, saved: null, role });
  const { error } = await getAdminSupabaseClient()
    .from("conversations")
    .update({ reply_sender: row.id === DEFAULT_SENDER_ID ? null : row.id })
    .eq("id", conversationId)
    .eq("restaurant_id", KIARA_RESTAURANT_ID);
  if (error) throw new Error(error.message);
  return row;
}

/**
 * What the composer needs for one conversation: the saved sender, and whether
 * this is a field-team thread (those always use the orders number, so the
 * composer offers no choice).
 */
export async function getConversationSenderState(
  conversationId: string,
): Promise<{ senderAccountId: string; fieldTeam: boolean }> {
  const [{ data, error }, staff] = await Promise.all([
    getAdminSupabaseClient()
      .from("conversations")
      .select("reply_sender")
      .eq("id", conversationId)
      .eq("restaurant_id", KIARA_RESTAURANT_ID)
      .maybeSingle(),
    staffKindForConversation(conversationId),
  ]);
  if (error) throw new Error(error.message);
  return {
    senderAccountId: (data?.reply_sender as string | null) ?? DEFAULT_SENDER_ID,
    fieldTeam: Boolean(staff),
  };
}

/**
 * The team switches which number answers a customer. Field-team threads are
 * refused (they always use the orders number), the new sender is validated
 * like a send, and the change goes on the owner's audit trail.
 */
export async function changeConversationSender(input: {
  conversationId: string;
  senderAccountId: string;
  actor: { userId: string; teamMemberId: string | null; role: string };
}): Promise<{ senderAccountId: string; changed: boolean }> {
  const current = await getConversationSenderState(input.conversationId);
  if (current.fieldTeam) throw new SenderError("SENDER_FORBIDDEN", input.senderAccountId);
  const row = await setConversationSender(input.conversationId, input.senderAccountId, input.actor.role);
  const changed = row.id !== current.senderAccountId;
  if (changed) {
    await recordConversationEvent(
      input.conversationId,
      CONVERSATION_EVENTS.senderChanged,
      input.actor,
      { from: current.senderAccountId, to: row.id },
    );
  }
  return { senderAccountId: row.id, changed };
}

/** The engine behind an OpenWA sender id, or null. Server-only. */
export function engineConfigFor(senderId: string): EngineConfig | null {
  return ENGINES[senderId] ?? null;
}

export type LinkedSenderState = {
  id: string;
  label: string;
  phone: string | null;
  enabled: boolean;
  engine: EngineState;
};

/**
 * Every customer-facing OpenWA number with its engine's live state and QR,
 * for the admin /connect page. Read fresh, not from the send-path cache, so a
 * QR that just rotated is the one shown.
 */
export async function linkedSenderStates(): Promise<LinkedSenderState[]> {
  rowsCache = null;
  const rows = (await loadSenders()).filter((row) => row.provider === "openwa");
  return Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      label: row.label,
      phone: row.phone,
      enabled: row.enabled,
      engine: await getEngineState(ENGINES[row.id] ?? { url: undefined, token: undefined }),
    })),
  );
}
