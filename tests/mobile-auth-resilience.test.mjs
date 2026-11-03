import { describe, expect, test } from "bun:test";

import {
  SUPABASE_REQUEST_TIMEOUT_MS,
  SUPABASE_TOKEN_TIMEOUT_MS,
  classifySessionLookup,
  supabaseRequestDeadlineMs,
} from "../apps/mobile/lib/auth-resilience.ts";

const base = "https://ugbplqgrheovlfgolsjf.supabase.co";

describe("Supabase request deadlines", () => {
  test("a token refresh may take longer than a slow phone's 7-11 s round trip", () => {
    const refresh = `${base}/auth/v1/token?grant_type=refresh_token`;
    expect(supabaseRequestDeadlineMs(refresh)).toBe(SUPABASE_TOKEN_TIMEOUT_MS);
    expect(supabaseRequestDeadlineMs(new URL(refresh))).toBe(SUPABASE_TOKEN_TIMEOUT_MS);
    expect(supabaseRequestDeadlineMs({ url: `${base}/auth/v1/token?grant_type=password` })).toBe(
      SUPABASE_TOKEN_TIMEOUT_MS,
    );
    // Auth retries a failed refresh only while it is inside its 30 s tick.
    expect(SUPABASE_TOKEN_TIMEOUT_MS).toBeGreaterThan(11_000);
    expect(SUPABASE_TOKEN_TIMEOUT_MS).toBeLessThan(30_000);
  });

  test("everything else keeps the short deadline", () => {
    expect(supabaseRequestDeadlineMs(`${base}/auth/v1/user`)).toBe(SUPABASE_REQUEST_TIMEOUT_MS);
    expect(supabaseRequestDeadlineMs(`${base}/rest/v1/team_members`)).toBe(SUPABASE_REQUEST_TIMEOUT_MS);
    expect(supabaseRequestDeadlineMs(undefined)).toBe(SUPABASE_REQUEST_TIMEOUT_MS);
  });
});

describe("reading getSession() for an API call", () => {
  const retryable = (error) => error?.name === "AuthRetryableFetchError";
  const networkError = { name: "AuthRetryableFetchError" };
  const rejected = { name: "AuthApiError", code: "refresh_token_already_used" };

  test("a refresh lost on the network is a connection problem, not «انتهت الجلسة»", () => {
    expect(classifySessionLookup(null, networkError, retryable)).toEqual({ kind: "network" });
  });

  test("a session still in hand is used even beside an error", () => {
    expect(classifySessionLookup({ access_token: "jwt" }, networkError, retryable)).toEqual({
      kind: "token",
      accessToken: "jwt",
    });
    expect(classifySessionLookup({ access_token: "jwt" }, null, retryable)).toEqual({
      kind: "token",
      accessToken: "jwt",
    });
  });

  test("only a definite absence or a rejected token is a sign-out", () => {
    expect(classifySessionLookup(null, null, retryable)).toEqual({ kind: "signed_out" });
    expect(classifySessionLookup(null, rejected, retryable)).toEqual({ kind: "signed_out" });
  });
});
