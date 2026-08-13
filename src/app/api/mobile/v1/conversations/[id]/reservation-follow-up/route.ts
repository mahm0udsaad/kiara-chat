import { getConversationById } from "@/lib/inbox";
import {
  isReservationFollowUpStatus,
  type ReservationFollowUpStatus,
} from "@/lib/reservation-follow-up";
import { setReservationFollowUp } from "@/lib/reservation-follow-up-server";
import { mobileReminderConfirmationFor } from "@/lib/mobile/reminders";
import {
  authorizeMobileRequest,
  mobileData,
  mobileError,
  mobileServerError,
} from "@/lib/mobile/http";

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const QUICK_STATUSES = new Set<ReservationFollowUpStatus>([
  "awaiting_reply",
  "confirmed",
]);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;

  const payload = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const dayKey = String(payload?.dayKey ?? "");
  const status = payload?.status as ReservationFollowUpStatus;
  if (!DAY_KEY.test(dayKey)) {
    return mobileError(400, "INVALID_RESERVATION_DAY", "Reservation day is invalid");
  }
  if (!isReservationFollowUpStatus(status) || !QUICK_STATUSES.has(status)) {
    return mobileError(
      400,
      "INVALID_REMINDER_CONFIRMATION",
      "Reminder confirmation must be awaiting_reply or confirmed"
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
          ? "Only the assigned employee can update the reminder confirmation"
          : "Take the conversation before updating the reminder confirmation"
      );
    }

    const currentReminder = await mobileReminderConfirmationFor({
      customerPhone: conversation.customer_phone,
      metadata: conversation.metadata,
    });
    if (!currentReminder || currentReminder.dayKey !== dayKey) {
      return mobileError(
        409,
        "REMINDER_CONFIRMATION_OUTDATED",
        "The appointment changed; refresh the conversation and try again"
      );
    }

    const followUp = await setReservationFollowUp(
      id,
      dayKey,
      status,
      auth.session.teamMemberId
    );
    return mobileData({
      reminderConfirmation: {
        dayKey,
        status: followUp.status,
        remindedAt: followUp.reminded_at,
        updatedAt: followUp.updated_at,
      },
    });
  } catch (error) {
    return mobileServerError(
      error,
      "REMINDER_CONFIRMATION_FAILED",
      "Unable to update the reminder confirmation"
    );
  }
}
