import { authorizeMobileRequest, mobileData, mobileServerError } from "@/lib/mobile/http";
import { listSendersFor } from "@/lib/whatsapp-senders";

/**
 * GET /api/mobile/v1/senders — the business numbers this employee may reply
 * from, with whether each can send right now. No credentials or engine
 * addresses: only what the composer shows.
 */
export async function GET(request: Request) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;
  try {
    return mobileData({ senders: await listSendersFor(auth.session.role) });
  } catch (error) {
    return mobileServerError(error, "SENDERS_FAILED", "تعذّر تحميل أرقام الإرسال");
  }
}
