import { CONVERSATION_EVENTS, recordConversationEvent } from "@/lib/audit";
import { getConversationById } from "@/lib/inbox";
import { setCustomerName } from "@/lib/interactions";
import {
  authorizeMobileRequest,
  mobileData,
  mobileError,
  mobileServerError,
} from "@/lib/mobile/http";

const MAX_NAME = 80;

/** Rename the customer from mobile. An empty name deliberately clears it. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;

  const body = (await request.json().catch(() => null)) as { name?: unknown } | null;
  if (typeof body?.name !== "string") {
    return mobileError(400, "INVALID_CUSTOMER_NAME", "اسم العميلة غير صالح");
  }
  const name = body.name.trim().slice(0, MAX_NAME);
  const { id } = await params;

  try {
    const conversation = await getConversationById(id, {
      isAdmin: auth.session.role === "admin",
      teamMemberId: auth.session.teamMemberId,
    });
    if (!conversation) {
      return mobileError(404, "CONVERSATION_NOT_FOUND", "المحادثة غير موجودة");
    }

    const previousName = conversation.customer_name?.trim() || null;
    const nextName = name || null;
    if (previousName !== nextName) {
      await setCustomerName(id, nextName);
      await recordConversationEvent(
        id,
        CONVERSATION_EVENTS.customerRenamed,
        {
          userId: auth.session.userId,
          teamMemberId: auth.session.teamMemberId,
          role: auth.session.role,
        },
        { from: previousName, to: nextName },
      );
    }

    return mobileData({ ok: true, name: nextName });
  } catch (error) {
    return mobileServerError(
      error,
      "CUSTOMER_RENAME_FAILED",
      "تعذّر حفظ اسم العميلة",
    );
  }
}
