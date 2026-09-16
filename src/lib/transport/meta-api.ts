const DEFAULT_GRAPH_VERSION = "v26.0";
const GRAPH_ROOT = "https://graph.facebook.com";
const REQUEST_TIMEOUT_MS = 15_000;

export interface MetaCloudConfig {
  accessToken: string | undefined;
  appId: string | undefined;
  appSecret: string | undefined;
  phoneNumberId: string | undefined;
  wabaId: string | undefined;
  graphVersion: string;
  verifyToken: string | undefined;
}

/** Read credentials per request so a Vercel secret rotation takes effect immediately. */
export function metaCloudConfig(): MetaCloudConfig {
  return {
    accessToken: process.env.META_CLOUD_ACCESS_TOKEN?.trim(),
    appId: process.env.META_CLOUD_APP_ID?.trim(),
    appSecret: process.env.META_APP_SECRET?.trim(),
    phoneNumberId: process.env.META_CLOUD_PHONE_NUMBER_ID?.trim(),
    wabaId: process.env.META_CLOUD_WABA_ID?.trim(),
    graphVersion:
      process.env.META_CLOUD_GRAPH_VERSION?.trim() || DEFAULT_GRAPH_VERSION,
    verifyToken: process.env.META_CLOUD_VERIFY_TOKEN?.trim(),
  };
}

export function isMetaCloudConfigured(): boolean {
  const config = metaCloudConfig();
  return Boolean(config.accessToken && config.phoneNumberId && config.wabaId);
}

export function metaGraphUrl(path: string): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  return `${GRAPH_ROOT}/${metaCloudConfig().graphVersion}${clean}`;
}

export async function metaGraphCall<T>(
  path: string,
  init: Omit<RequestInit, "headers"> & { headers?: Record<string, string> } = {},
): Promise<T> {
  const token = metaCloudConfig().accessToken;
  if (!token) throw new Error("Meta Cloud API is not configured: missing access token");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(metaGraphUrl(path), {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...init.headers,
      },
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (cause) {
    throw new Error(
      controller.signal.aborted
        ? `Meta Cloud API did not respond within ${REQUEST_TIMEOUT_MS}ms`
        : "Meta Cloud API unreachable",
      { cause },
    );
  } finally {
    clearTimeout(timer);
  }

  const data = (await response.json().catch(() => ({}))) as {
    error?: {
      code?: number | string;
      error_subcode?: number | string;
      message?: string;
      error_data?: { details?: string };
    };
  };
  if (!response.ok || data.error) {
    const code = data.error?.code ?? response.status;
    const subcode = data.error?.error_subcode
      ? `_${data.error.error_subcode}`
      : "";
    // `message` is a generic title ("Parameter format does not match..."); the
    // field that names which parameter is wrong lives in error_data.details.
    const reason = data.error?.error_data?.details || data.error?.message;
    const detail = reason ? `: ${reason}` : "";
    throw new Error(`META_${code}${subcode}${detail}`);
  }
  return data as T;
}

export function metaErrorCode(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  const match = /^META_([A-Za-z0-9_]+):?/.exec(error.message);
  return match ? match[1] : null;
}
