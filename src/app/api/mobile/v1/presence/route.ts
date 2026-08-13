import { listConversations } from "@/lib/inbox";
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
    const phones = [...new Set(conversations.map((item) => item.customer_phone))];
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
