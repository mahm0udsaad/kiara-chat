import {
  authorizeMobileRequest,
  mobileData,
} from "@/lib/mobile/http";

/**
 * POST /api/mobile/v1/presence — retired no-op.
 *
 * Typing indicators came from the linked device, which is retired
 * (2026-09-04); the Business Platform exposes no inbound presence. Kept as a
 * successful no-op because every installed build calls it when the inbox
 * mounts — see the web route for the full reasoning.
 */
export async function POST(request: Request) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;
  return mobileData({ watched: 0 });
}
