/**
 * Keeping staff signed in on slow connections.
 *
 * Supabase rotates the refresh token on every refresh and only accepts the old
 * one again for a short reuse window. If our client gives up on a refresh the
 * server already honoured, Auth retries with the spent token; once the window
 * has passed the server rejects it and the library deletes the session, which
 * signs her out. So token requests get a generous deadline, and a lookup that
 * failed on the network is reported as a network problem, not a lost session.
 */

/** Ordinary Supabase requests (none of them carry a session). */
export const SUPABASE_REQUEST_TIMEOUT_MS = 7_000;
/**
 * Token requests: long enough for a slow mobile connection to bring the rotated
 * token back, short enough that Auth can still retry inside its 30 s tick.
 */
export const SUPABASE_TOKEN_TIMEOUT_MS = 25_000;

export function supabaseRequestDeadlineMs(input: unknown): number {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : typeof (input as { url?: unknown })?.url === "string"
          ? (input as { url: string }).url
          : "";
  return url.includes("/auth/v1/token") ? SUPABASE_TOKEN_TIMEOUT_MS : SUPABASE_REQUEST_TIMEOUT_MS;
}

export type SessionLookup =
  | { kind: "token"; accessToken: string }
  | { kind: "network" }
  | { kind: "signed_out" };

/**
 * What a `getSession()` result means for an API call. A session that is still
 * there wins even beside an error; a retryable (network) error with no session
 * in hand is a connection problem; only a definite absence is a sign-out.
 */
export function classifySessionLookup(
  session: { access_token?: string | null } | null | undefined,
  error: unknown,
  isRetryable: (error: unknown) => boolean,
): SessionLookup {
  if (session?.access_token) return { kind: "token", accessToken: session.access_token };
  if (error && isRetryable(error)) return { kind: "network" };
  return { kind: "signed_out" };
}
