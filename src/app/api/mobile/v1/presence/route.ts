import { listConversations } from "@/lib/inbox";
import { isGroupConversation } from "@/lib/mobile/conversations";
import {
  authorizeMobileRequest,
  mobileData,
  mobileServerError,
} from "@/lib/mobile/http";
import { isOpenWaConfigured, watchPresence } from "@/lib/transport/openwa";

const WATCH_LIMIT = 100;

export async function POST(request: Request) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;
  if (!isOpenWaConfigured()) return mobileData({ watched: 0 });

  try {
    const conversations = await listConversations(WATCH_LIMIT, {
      isAdmin: auth.session.role === "admin",
      teamMemberId: auth.session.teamMemberId,
    });
    // Groups keep their jid where a phone goes, and nothing renders typing
    // state for a room — subscribing to them is a wasted watch slot.
    const phones = [
      ...new Set(
        conversations
          .filter((item) => !isGroupConversation(item))
          .map((item) => item.customer_phone),
      ),
    ];
    await watchPresence(phones);
    return mobileData({ watched: phones.length });
  } catch (error) {
    return mobileServerError(
      error,
      "PRESENCE_WATCH_FAILED",
      "Unable to subscribe to typing indicators"
    );
  }
}
