import { type NextRequest } from "next/server";
import { updateSession } from "./lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  // Webhook / internal / cron / mobile routes authenticate themselves (signature,
  // Bearer or shared secret) and the cookie-only client here can't validate
  // those — running the middleware on them only added latency to WhatsApp
  // ingest, and on /api/cron/* it redirected the scheduled sweep to /login.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/webhooks|api/internal|api/cron|api/mobile|.*\\..*).*)",
  ],
};
