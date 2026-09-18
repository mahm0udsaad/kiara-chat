/**
 * Who did what, on the record.
 *
 * `operation_events` already holds the order side of this — dispatches, edits,
 * field steps, reminders — because those go through the operational-command
 * functions in Postgres. The conversation side went unrecorded: taking a
 * thread, releasing it, changing its status or booking stage, moving labels
 * around were plain row updates, so the owner could see the *current* state of
 * a conversation and never who put it there.
 *
 * These writers close that gap. They insert into the same table the order
 * events use, so one reader can build a single responsibility trail per
 * customer and per order.
 *
 * A failed audit write never fails the action it describes: the employee's
 * change has already happened, and refusing it after the fact would be a lie
 * of a different kind. Failures are logged loudly instead. The one exception
 * lives in `takeOverConversation`, where the reason for an override is the
 * whole point of the record and the caller is told when it is lost.
 */
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { KIARA_RESTAURANT_ID } from "@/lib/tenant";

/** The employee behind an action, as the session already knows them. */
export interface AuditActor {
  userId: string;
  /** Null for the owner, who has no `team_members` row. */
  teamMemberId: string | null;
  role: string;
}

/**
 * Conversation events this app records. Keep the names stable — they are the
 * keys the report labels off, and old rows are never rewritten.
 */
export const CONVERSATION_EVENTS = {
  claimed: "conversation.claimed",
  released: "conversation.released",
  transferred: "conversation.transferred",
  takenOver: "conversation.taken_over",
  statusChanged: "conversation.status_changed",
  stageChanged: "conversation.stage_changed",
  outcomeChanged: "conversation.outcome_changed",
  labelsChanged: "conversation.labels_changed",
  sectionChanged: "conversation.section_changed",
  noteAdded: "conversation.note_added",
  reminderConfirmed: "conversation.reminder_confirmed",
  botResumed: "conversation.bot_resumed",
  customerRenamed: "conversation.customer_renamed",
  // Hides only Kiara's own view of the thread — see `hideMessage` /
  // `clearConversationMessages` in `@/lib/inbox`. Recorded because it's the
  // kind of action the owner's report should be able to show happened.
  messageDeleted: "conversation.message_deleted",
  messagesCleared: "conversation.messages_cleared",
  // Calling. The request is an employee action and belongs on the
  // responsibility trail; the grant and the decline are the customer
  // answering, recorded as system events so the report can show the outcome
  // beside the ask that produced it.
  callPermissionRequested: "conversation.call_permission_requested",
  callPermissionGranted: "conversation.call_permission_granted",
  callPermissionDeclined: "conversation.call_permission_declined",
} as const;

export type ConversationEventType =
  (typeof CONVERSATION_EVENTS)[keyof typeof CONVERSATION_EVENTS];

export async function recordAuditEvent(input: {
  aggregateType: "conversation" | "driver_order";
  aggregateId: string;
  eventType: string;
  actor: AuditActor;
  payload?: Record<string, unknown>;
}): Promise<void> {
  const { error } = await getAdminSupabaseClient()
    .from("operation_events")
    .insert({
      restaurant_id: KIARA_RESTAURANT_ID,
      aggregate_type: input.aggregateType,
      aggregate_id: input.aggregateId,
      event_type: input.eventType,
      // 'owner' and 'team_member' are the two the CHECK allows for a human
      // acting from the app; the owner is the one without a membership row.
      actor_type: input.actor.teamMemberId ? "team_member" : "owner",
      actor_role: auditRole(input.actor.role),
      actor_user_id: input.actor.userId,
      actor_team_member_id: input.actor.teamMemberId,
      payload: input.payload ?? {},
    });
  if (error) {
    console.error(
      `[audit] ${input.eventType} on ${input.aggregateType} ${input.aggregateId} was not recorded`,
      error,
    );
  }
}

/** Records a conversation event, or nothing at all when nothing changed. */
export function recordConversationEvent(
  conversationId: string,
  eventType: ConversationEventType,
  actor: AuditActor,
  payload?: Record<string, unknown>,
): Promise<void> {
  return recordAuditEvent({
    aggregateType: "conversation",
    aggregateId: conversationId,
    eventType,
    actor,
    payload,
  });
}

/**
 * An event with no employee behind it — the customer answered, or a webhook
 * told us something changed.
 *
 * Kept separate from `recordConversationEvent` rather than loosening
 * `AuditActor.userId` to nullable: every existing caller genuinely has a
 * signed-in employee, and making that field optional for all of them would
 * lose a real guarantee to serve one case.
 */
export async function recordSystemConversationEvent(
  conversationId: string,
  eventType: ConversationEventType,
  payload?: Record<string, unknown>,
): Promise<void> {
  const { error } = await getAdminSupabaseClient()
    .from("operation_events")
    .insert({
      restaurant_id: KIARA_RESTAURANT_ID,
      aggregate_type: "conversation",
      aggregate_id: conversationId,
      event_type: eventType,
      actor_type: "system",
      actor_role: "system",
      payload: payload ?? {},
    });
  if (error) {
    console.error(
      `[audit] ${eventType} on conversation ${conversationId} was not recorded`,
      error,
    );
  }
}

/** The column only accepts the roles the operations model knows. */
function auditRole(role: string): string | null {
  return ["admin", "agent", "driver", "specialist", "system"].includes(role)
    ? role
    : null;
}
