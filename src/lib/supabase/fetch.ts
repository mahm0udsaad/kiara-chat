import "server-only";

/**
 * Supabase normally answers these small auth/data requests in well under a
 * second. A bounded deadline prevents an upstream outage from holding a
 * Vercel function open for five minutes and leaving the mobile app spinning.
 */
const SUPABASE_REQUEST_TIMEOUT_MS = 8_000;

export const supabaseServerFetch: typeof fetch = async (input, init = {}) => {
  const controller = new AbortController();
  const upstreamSignal = init.signal;
  const abortFromUpstream = () => controller.abort(upstreamSignal?.reason);
  if (upstreamSignal?.aborted) abortFromUpstream();
  else upstreamSignal?.addEventListener("abort", abortFromUpstream, { once: true });

  const timer = setTimeout(
    () => controller.abort(new Error("Supabase request timed out")),
    SUPABASE_REQUEST_TIMEOUT_MS,
  );
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    upstreamSignal?.removeEventListener("abort", abortFromUpstream);
  }
};
