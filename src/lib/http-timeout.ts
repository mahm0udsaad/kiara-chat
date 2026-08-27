/**
 * `fetch` with a deadline.
 *
 * Deliberately not `server-only`: the typing-indicator client component reaches
 * this through `presence.ts`, and the wrapper holds no credentials of its own.
 *
 * Node's fetch has no default request timeout. An upstream that accepts the TCP
 * connection and then goes quiet — the shape a struggling host actually fails
 * in, rather than refusing outright — will therefore stall the caller until the
 * serverless function itself is killed. The caller learns nothing, and the whole
 * function budget is spent waiting instead of answering.
 *
 * So every outbound call from a request path carries an explicit deadline. The
 * point is not to succeed more often; it is to fail while there is still time to
 * say so, and to let each caller choose what a missing upstream means for it.
 *
 * Messages here deliberately contain "timed out"/"upstream" so
 * `isTransientUpstreamError` classifies them as retryable 503s rather than 500s.
 */

/** Generous enough for a slow third party, short enough to leave room to respond. */
export const DEFAULT_UPSTREAM_TIMEOUT_MS = 10_000;

export class UpstreamTimeoutError extends Error {
  constructor(label: string, timeoutMs: number, options?: { cause?: unknown }) {
    super(`Upstream ${label} request timed out after ${timeoutMs}ms`, options);
    this.name = "UpstreamTimeoutError";
  }
}

/**
 * `label` names the upstream in the thrown message; it is what shows up in logs
 * and, for mobile callers, decides nothing else — the deadline is the contract.
 */
export async function fetchWithTimeout(
  input: string | URL,
  init: RequestInit = {},
  options: { timeoutMs?: number; label?: string } = {},
): Promise<Response> {
  const { timeoutMs = DEFAULT_UPSTREAM_TIMEOUT_MS, label = "Upstream" } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (cause) {
    if (controller.signal.aborted) {
      throw new UpstreamTimeoutError(label, timeoutMs, { cause });
    }
    throw cause;
  } finally {
    clearTimeout(timer);
  }
}
