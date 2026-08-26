import {
  FieldReminderError,
  FIELD_REMINDER_CHANNELS,
  getFieldReminderContext,
  sendFieldReminder,
  type FieldReminderChannel,
} from "@/lib/field-reminders";
import type { FieldStaffRole } from "@/lib/field-staff";
import {
  authorizeMobileRequest,
  mobileData,
  mobileError,
  mobileServerError,
} from "@/lib/mobile/http";

const ROLES = new Set<FieldStaffRole>(["driver", "specialist"]);

function bodyRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Where the visit stands, and the reminder text to open the composer with. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;

  const { id } = await params;
  try {
    const context = await getFieldReminderContext(id);
    if (!context) return mobileError(404, "ORDER_NOT_FOUND", "Order not found");
    return mobileData({ reminder: context });
  } catch (error) {
    return mobileServerError(
      error,
      "REMINDER_CONTEXT_FAILED",
      "Unable to load the reminder details",
    );
  }
}

/** Send one employee-authored reminder to the driver or the specialist. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;

  const body = bodyRecord(await request.json().catch(() => null));
  if (!body) {
    return mobileError(400, "INVALID_JSON", "A JSON object is required");
  }

  const role = body.role as FieldStaffRole;
  if (!ROLES.has(role)) {
    return mobileError(400, "INVALID_REMINDER_ROLE", "role must be driver or specialist");
  }
  if (typeof body.message !== "string" || !body.message.trim()) {
    return mobileError(400, "EMPTY_REMINDER", "message must be a non-empty string");
  }
  const channels = Array.isArray(body.channels)
    ? [
        ...new Set(
          body.channels.filter((channel): channel is FieldReminderChannel =>
            FIELD_REMINDER_CHANNELS.includes(channel as FieldReminderChannel),
          ),
        ),
      ]
    : [];
  if (!channels.length) {
    return mobileError(
      400,
      "NO_REMINDER_CHANNEL",
      "channels must contain push and/or whatsapp",
    );
  }

  const { id } = await params;
  try {
    const result = await sendFieldReminder({
      orderId: id,
      role,
      message: body.message,
      channels,
      actor: {
        userId: auth.session.userId,
        teamMemberId: auth.session.teamMemberId,
        role: auth.session.role,
      },
    });
    return mobileData({ delivery: result });
  } catch (error) {
    if (error instanceof FieldReminderError) {
      return mobileError(error.status, error.code, error.message);
    }
    return mobileServerError(
      error,
      "REMINDER_SEND_FAILED",
      "Unable to send the reminder",
    );
  }
}
