import { type NextRequest } from "next/server";
import { updateSession } from "./lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  // Webhook / internal / mobile routes authenticate themselves (signature or
  // Bearer) and the cookie-only client here can't validate those — running the
  // middleware on them only added latency to WhatsApp ingest.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/webhooks|api/internal|api/mobile|.*\\..*).*)",
  ],
};
