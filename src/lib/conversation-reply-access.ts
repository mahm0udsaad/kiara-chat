/**
 * Who may reply into a conversation.
 *
 * This lives on its own so the web route and the mobile v1 route cannot drift.
 * They did drift before: both let an admin reply into a thread assigned to
 * somebody else, with no takeover, no reason and no event — which is exactly
 * the intervention an owner report is supposed to be able to show.
 *
 * An admin is not blocked from intervening. She is required to say so first:
 * `TAKEOVER_REQUIRED` is the signal for the client to collect a reason and call
 * the takeover endpoint, after which she is the assignee and replies normally.
 *
 * Pure function — no imports beyond types, so it is directly testable.
 */

export type ReplyDenialCode =
  | "CONVERSATION_NOT_TAKEN"
  | "CONVERSATION_ASSIGNED_TO_ANOTHER_EMPLOYEE"
  | "TAKEOVER_REQUIRED";

export interface ReplyDenial {
  code: ReplyDenialCode;
  status: 403 | 409;
  message: string;
  /** Who holds it now, so the client can name them in the prompt. */
  assignedTo: string | null;
}

export function replyDenialFor(
  // `assigned_to` is optional on the domain type, and an absent column must
  // read as unclaimed rather than as "assigned to nobody in particular".
  conversation: { assigned_to?: string | null },
  viewer: { role: "admin" | "agent"; teamMemberId: string | null },
): ReplyDenial | null {
  const assignedTo = conversation.assigned_to ?? null;

  if (assignedTo && viewer.teamMemberId && assignedTo === viewer.teamMemberId) {
    return null;
  }

  if (!assignedTo) {
    // Unassigned is the same instruction for everyone, admin included: claim it
    // first, so the thread has one owner before a customer-facing message goes
    // out under it.
    return {
      code: "CONVERSATION_NOT_TAKEN",
      status: 409,
      message: "استلمي المحادثة قبل الرد",
      assignedTo: null,
    };
  }

  if (viewer.role === "admin") {
    return {
      code: "TAKEOVER_REQUIRED",
      status: 409,
      message: "المحادثة مسندة لموظفة أخرى — استلميها مع ذكر السبب قبل الرد",
      assignedTo,
    };
  }

  return {
    code: "CONVERSATION_ASSIGNED_TO_ANOTHER_EMPLOYEE",
    status: 403,
    message: "الرد متاح للموظفة المسند إليها المحادثة فقط",
    assignedTo,
  };
}
