import { isBookingStage, bookingStageOf } from "@/lib/booking-stage";
import { getConversationById } from "@/lib/inbox";
import { setBookingStage, setCsStatus, type CsStatus } from "@/lib/interactions";
import {
  getConversationLabelIds,
  listLabels,
  setConversationLabels,
} from "@/lib/labels";
import { conversationCsStatus } from "@/lib/mobile/conversations";
import {
  authorizeMobileRequest,
  mobileData,
  mobileError,
  mobileServerError,
} from "@/lib/mobile/http";
import { mobileReminderConfirmationFor } from "@/lib/mobile/reminders";
import { setReservationFollowUp } from "@/lib/reservation-follow-up-server";

const CS_STATUSES = new Set<CsStatus>(["open", "waiting", "resolved"]);
const QUICK_REMINDER_STATUSES = new Set(["awaiting_reply", "confirmed"]);
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

type Payload = {
  csStatus?: unknown;
  bookingStage?: unknown;
  labelIds?: unknown;
  reminderConfirmation?: unknown;
};

/**
 * Save the editable fields shown in the mobile conversation-actions sheet.
 * Metadata writes stay ordered because reminder and booking updates both have
 * deliberate side effects on communication status.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;

  const payload = (await request.json().catch(() => null)) as Payload | null;
  const csStatus = payload?.csStatus as CsStatus | undefined;
  const bookingStage = payload?.bookingStage;
  const labelIds = Array.isArray(payload?.labelIds)
    ? [...new Set(payload.labelIds.filter((id): id is string => typeof id === "string"))]
    : null;
  const reminder =
    payload?.reminderConfirmation &&
    typeof payload.reminderConfirmation === "object"
      ? (payload.reminderConfirmation as { dayKey?: unknown; status?: unknown })
      : null;

  if (!csStatus || !CS_STATUSES.has(csStatus)) {
    return mobileError(400, "INVALID_CS_STATUS", "Conversation status is invalid");
  }
  if (bookingStage !== null && !isBookingStage(bookingStage)) {
    return mobileError(400, "INVALID_BOOKING_STAGE", "Booking stage is invalid");
  }
  if (!labelIds) {
    return mobileError(400, "INVALID_LABELS", "Conversation labels are invalid");
  }
  if (
    reminder &&
    (!DAY_KEY.test(String(reminder.dayKey ?? "")) ||
      !QUICK_REMINDER_STATUSES.has(String(reminder.status ?? "")))
  ) {
    return mobileError(
      400,
      "INVALID_REMINDER_CONFIRMATION",
      "Reminder confirmation is invalid"
    );
  }

  const { id } = await params;
  const viewer = {
    isAdmin: auth.session.role === "admin",
    teamMemberId: auth.session.teamMemberId,
  };

  try {
    const conversation = await getConversationById(id, viewer);
    if (!conversation) {
      return mobileError(404, "CONVERSATION_NOT_FOUND", "Conversation not found");
    }
    if (
      auth.session.role !== "admin" &&
      conversation.assigned_to !== auth.session.teamMemberId
    ) {
      return mobileError(
        conversation.assigned_to ? 403 : 409,
        conversation.assigned_to
          ? "CONVERSATION_ASSIGNED_TO_ANOTHER_EMPLOYEE"
          : "CONVERSATION_NOT_TAKEN",
        conversation.assigned_to
          ? "Only the assigned employee can update conversation actions"
          : "Take the conversation before updating conversation actions"
      );
    }

    const [availableLabels, currentLabelIds, currentReminder] = await Promise.all([
      listLabels(),
      getConversationLabelIds(id),
      mobileReminderConfirmationFor({
        customerPhone: conversation.customer_phone,
        metadata: conversation.metadata,
      }),
    ]);
    const validLabelIds = new Set(availableLabels.map((label) => label.id));
    if (labelIds.some((labelId) => !validLabelIds.has(labelId))) {
      return mobileError(400, "UNKNOWN_LABEL", "One or more labels are invalid");
    }

    if (reminder) {
      const dayKey = String(reminder.dayKey);
      const status = String(reminder.status) as "awaiting_reply" | "confirmed";
      if (!currentReminder || currentReminder.dayKey !== dayKey) {
        return mobileError(
          409,
          "REMINDER_CONFIRMATION_OUTDATED",
          "The appointment changed; refresh the conversation and try again"
        );
      }
      if (currentReminder.status !== status) {
        await setReservationFollowUp(
          id,
          dayKey,
          status,
          auth.session.teamMemberId
        );
      }
    }

    if (bookingStage && bookingStageOf(conversation) !== bookingStage) {
      await setBookingStage(id, bookingStage);
    }
    if (conversationCsStatus(conversation) !== csStatus || bookingStage || reminder) {
      // Booking and reminder writes can alter cs_status, so the user's explicit
      // selection is applied last even when it matched the opening snapshot.
      await setCsStatus(id, csStatus);
    }

    const labelsChanged =
      labelIds.length !== currentLabelIds.length ||
      labelIds.some((labelId) => !currentLabelIds.includes(labelId));
    if (labelsChanged) {
      await setConversationLabels(auth.session.userId, id, labelIds);
    }

    return mobileData({ ok: true });
  } catch (error) {
    return mobileServerError(
      error,
      "CONVERSATION_ACTIONS_FAILED",
      "Unable to update conversation actions"
    );
  }
}
