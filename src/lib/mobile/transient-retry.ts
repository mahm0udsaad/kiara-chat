import "server-only";

const TRANSIENT_MESSAGE =
  /\b(?:408|425|429|500|502|503|504|520|521|522|523|524)\b|connection timed out|request timed out|temporar(?:y|ily) unavailable|fetch failed|network error|socket hang up|abort(?:ed|error)|econnreset|enotfound|etimedout|upstream/i;

function errorRecord(error: unknown): Record<string, unknown> | null {
  return error && typeof error === "object"
    ? (error as Record<string, unknown>)
    : null;
}

export function upstreamErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  const record = errorRecord(error);
  return typeof record?.message === "string" ? record.message : String(error);
}

/** Network, rate-limit, and upstream 5xx failures that are safe to retry. */
export function isTransientUpstreamError(error: unknown): boolean {
  const record = errorRecord(error);
  const status = Number(record?.status ?? record?.statusCode ?? 0);
  if (status === 408 || status === 425 || status === 429 || status >= 500) {
    return true;
  }
  return TRANSIENT_MESSAGE.test(upstreamErrorMessage(error));
}

/** Keep logs useful without printing an entire Cloudflare HTML error page. */
export function conciseUpstreamError(error: unknown): string {
  const message = upstreamErrorMessage(error).replace(/\s+/g, " ").trim();
  const cloudflare = message.match(
    /(?:Error code\s*|\|\s*)(5\d{2})\b|\b(Connection timed out)\b/i,
  );
  if (cloudflare?.[1]) return `Upstream HTTP ${cloudflare[1]}`;
  if (cloudflare?.[2]) return cloudflare[2];
  return message.slice(0, 240) || "Unknown upstream error";
}

export async function withTransientUpstreamRetry<T>(
  operation: () => Promise<T>,
  options: { label: string; attempts?: number },
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 3);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === attempts || !isTransientUpstreamError(error)) throw error;
      console.warn("[mobile-api] transient upstream failure; retrying", {
        label: options.label,
        attempt,
        error: conciseUpstreamError(error),
      });
      await new Promise((resolve) => setTimeout(resolve, attempt * 300));
    }
  }
  throw new Error("Transient retry exhausted");
}
