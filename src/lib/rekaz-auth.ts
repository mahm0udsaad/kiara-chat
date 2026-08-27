/**
 * Signing in to Rekaz on the salon's behalf.
 *
 * Rekaz used to answer `/api/app/reservation` to any request that carried the
 * tenant id — that is the door `src/lib/rekaz.ts` was built on, and on
 * 2026-08-22 it closed: the endpoint now returns 401 with `www-authenticate:
 * Bearer` and redirects to `/Account/Login`. The tenant itself is still public
 * (`/api/abp/application-configuration` answers anonymously), so nothing about
 * Kiara's account changed — only that reading the schedule now requires being
 * someone.
 *
 * The client still has no API integration enabled, so "being someone" means
 * logging in as the salon's own Rekaz user. Two mechanisms exist on the
 * platform and both are probed here, in order:
 *
 *   1. OpenIddict password grant at `/connect/token` — returns a bearer token
 *      and a refresh token. Preferred: stateless, no cookie jar, and the
 *      expiry is stated rather than guessed.
 *   2. ABP's `/api/account/login` — returns an identity cookie. The fallback
 *      for when the token endpoint refuses the grant for this client.
 *
 * Credentials never live in the repo. Set them in `.env.local` and in Vercel:
 *
 *   REKAZ_USERNAME       the salon's Rekaz login (email or username)
 *   REKAZ_PASSWORD       its password
 *   REKAZ_CLIENT_ID      optional — only if the token endpoint demands one
 *   REKAZ_SCOPE          optional — defaults to "Platform offline_access"
 *   REKAZ_ACCESS_TOKEN   optional stopgap — a token copied from a logged-in
 *                        browser session, used as-is when no password is set
 *
 * Everything downstream calls `rekazAuthHeaders()` and, on a 401, calls
 * `invalidateRekazAuth()` once before retrying — see `fetchPage` in
 * `src/lib/rekaz.ts`.
 */

import { fetchWithTimeout } from "@/lib/http-timeout";

const PLATFORM = "https://platform.rekaz.io";
const TOKEN_URL = `${PLATFORM}/connect/token`;
const LOGIN_URL = `${PLATFORM}/api/account/login`;

/** Refresh this early so a token never expires mid-pull. */
const EXPIRY_SKEW_MS = 60_000;
/** A cookie login states no expiry, so it is re-done on this cadence. */
const COOKIE_TTL_MS = 6 * 60 * 60 * 1000;

export type RekazAuthReason =
  /** No credentials configured — the integration was never connected. */
  | "not_configured"
  /** Rekaz rejected the credentials — wrong password, locked, 2FA added. */
  | "rejected"
  /** Rekaz could not be reached at all. */
  | "unreachable";

/**
 * A failure to authenticate, as opposed to a failure to read. The sync routes
 * turn this into its own error code so the banner can say "reconnect Rekaz"
 * instead of "try again later" — one is a task for a human, the other is not.
 */
export class RekazAuthError extends Error {
  constructor(
    message: string,
    readonly reason: RekazAuthReason,
    readonly detail?: string
  ) {
    super(message);
    this.name = "RekazAuthError";
  }
}

/** How a request proves who it is. Both forms are just headers to the caller. */
type RekazCredential =
  | { kind: "bearer"; token: string; refreshToken: string | null }
  | { kind: "cookie"; cookie: string };

let cached: { credential: RekazCredential; expiresAt: number } | null = null;
/** Concurrent pulls must produce one login, not one login each. */
let inflight: Promise<RekazCredential> | null = null;

const credentialsFromEnv = () => ({
  username: process.env.REKAZ_USERNAME?.trim() ?? "",
  password: process.env.REKAZ_PASSWORD ?? "",
  clientId: process.env.REKAZ_CLIENT_ID?.trim() ?? "",
  scope: process.env.REKAZ_SCOPE?.trim() || "Platform offline_access",
  staticToken: process.env.REKAZ_ACCESS_TOKEN?.trim() ?? "",
});

/** True when this deployment has something to log in with. */
export function isRekazAuthConfigured(): boolean {
  const { username, password, staticToken } = credentialsFromEnv();
  return Boolean(staticToken || (username && password));
}

function headersFor(credential: RekazCredential): Record<string, string> {
  return credential.kind === "bearer"
    ? { Authorization: `Bearer ${credential.token}` }
    : { Cookie: credential.cookie };
}

/**
 * The headers that make a Rekaz request authenticated. Cached until the token
 * is close to expiry; one login is shared by every concurrent caller.
 */
export async function rekazAuthHeaders(): Promise<Record<string, string>> {
  const now = Date.now();
  if (cached && now < cached.expiresAt) return headersFor(cached.credential);
  if (inflight) return headersFor(await inflight);

  const attempt = authenticate();
  inflight = attempt;
  try {
    return headersFor(await attempt);
  } finally {
    // Clear regardless of outcome: a failed login must not be remembered as
    // the in-flight one, or every later caller awaits the same rejection.
    if (inflight === attempt) inflight = null;
  }
}

/** Drop the cached credential so the next call logs in again. */
export function invalidateRekazAuth(): void {
  cached = null;
}

async function authenticate(): Promise<RekazCredential> {
  const { username, password, staticToken } = credentialsFromEnv();

  // A hand-copied token is a stopgap with no refresh path, so it is only used
  // when there is nothing better; a real login supersedes it.
  if (!username || !password) {
    if (staticToken) {
      const credential: RekazCredential = {
        kind: "bearer",
        token: staticToken,
        refreshToken: null,
      };
      cached = { credential, expiresAt: Date.now() + COOKIE_TTL_MS };
      return credential;
    }
    throw new RekazAuthError(
      "Rekaz credentials are not configured",
      "not_configured",
      "Set REKAZ_USERNAME and REKAZ_PASSWORD"
    );
  }

  // A refresh is cheaper than a full login and does not re-send the password,
  // so it is tried first whenever the previous credential offered one.
  const refreshToken =
    cached?.credential.kind === "bearer" ? cached.credential.refreshToken : null;
  if (refreshToken) {
    const refreshed = await tokenGrant({ grant_type: "refresh_token", refresh_token: refreshToken })
      .catch(() => null);
    if (refreshed) return refreshed;
  }

  const passwordGrant = await tokenGrant({
    grant_type: "password",
    username,
    password,
  });
  if (passwordGrant) return passwordGrant;

  return cookieLogin(username, password);
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

/**
 * The OpenIddict token endpoint. Returns null when Rekaz refuses the grant
 * itself (so the caller can fall back to the cookie login) but throws when the
 * credentials are wrong — falling back on a bad password would just get the
 * account locked twice as fast.
 */
async function tokenGrant(
  params: Record<string, string>
): Promise<RekazCredential | null> {
  const { clientId, scope } = credentialsFromEnv();
  const body = new URLSearchParams({ ...params, scope });
  // The endpoint accepts a public client (`none` is among its supported auth
  // methods), so the id is sent only when this deployment was given one.
  if (clientId) body.set("client_id", clientId);

  let response: Response;
  try {
    response = await fetchWithTimeout(TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        __tenant: rekazTenantId(),
      },
      body,
      cache: "no-store",
    });
  } catch (error) {
    throw new RekazAuthError(
      "Rekaz could not be reached",
      "unreachable",
      error instanceof Error ? error.message : String(error)
    );
  }

  const payload = (await response.json().catch(() => ({}))) as TokenResponse;

  if (response.ok && payload.access_token) {
    const credential: RekazCredential = {
      kind: "bearer",
      token: payload.access_token,
      refreshToken: payload.refresh_token ?? null,
    };
    const ttl = (payload.expires_in ?? 3600) * 1000;
    cached = {
      credential,
      expiresAt: Date.now() + Math.max(ttl - EXPIRY_SKEW_MS, 30_000),
    };
    return credential;
  }

  // `invalid_grant` on a password grant means Rekaz read the credentials and
  // said no. Anything else (`invalid_client`, `unsupported_grant_type`) is
  // about how we asked, which the cookie login may not care about.
  if (payload.error === "invalid_grant" && params.grant_type === "password") {
    throw new RekazAuthError(
      "Rekaz rejected the salon credentials",
      "rejected",
      payload.error_description
    );
  }
  return null;
}

interface AbpLoginResult {
  result?: number; // 1 = success, per ABP's LoginResultType
  description?: string;
  error?: { message?: string; details?: string };
}

/**
 * ABP's own login, which answers with an identity cookie rather than a token.
 * Used when the token endpoint will not issue for this client.
 */
async function cookieLogin(
  username: string,
  password: string
): Promise<RekazCredential> {
  let response: Response;
  try {
    response = await fetchWithTimeout(LOGIN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Requested-With": "XMLHttpRequest",
        __tenant: rekazTenantId(),
      },
      body: JSON.stringify({
        userNameOrEmailAddress: username,
        password,
        rememberMe: true,
      }),
      cache: "no-store",
      redirect: "manual",
    });
  } catch (error) {
    throw new RekazAuthError(
      "Rekaz could not be reached",
      "unreachable",
      error instanceof Error ? error.message : String(error)
    );
  }

  const payload = (await response.json().catch(() => ({}))) as AbpLoginResult;
  const cookie = identityCookie(response);

  if (!response.ok || !cookie) {
    throw new RekazAuthError(
      "Rekaz rejected the salon credentials",
      "rejected",
      payload.error?.message ?? payload.description ?? `HTTP ${response.status}`
    );
  }

  const credential: RekazCredential = { kind: "cookie", cookie };
  cached = { credential, expiresAt: Date.now() + COOKIE_TTL_MS };
  return credential;
}

/**
 * The `name=value` pairs worth sending back. Attributes (`Path`, `HttpOnly`,
 * the rest) are for a browser to enforce and would confuse the server if
 * echoed into a request.
 */
function identityCookie(response: Response): string | null {
  const setCookies =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie") ?? ""].filter(Boolean);

  const pairs = setCookies
    .map((line) => line.split(";")[0]?.trim() ?? "")
    .filter((pair) => pair.includes("=") && !pair.endsWith("="));

  return pairs.length ? pairs.join("; ") : null;
}

/**
 * Kiara's tenant, kept in step with `src/lib/rekaz.ts`. The login itself is
 * tenant-scoped: without this header Rekaz resolves the host tenant and the
 * salon's user does not exist there.
 */
function rekazTenantId(): string {
  return (
    process.env.REKAZ_TENANT_ID ?? "3a1f3638-e6dc-d864-4aa7-df60cdbb1146"
  );
}
