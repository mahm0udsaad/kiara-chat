import { fetch } from "expo/fetch";

import { supabase } from "@/lib/supabase";

const apiUrl = (process.env.EXPO_PUBLIC_API_URL ?? "").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type ApiEnvelope<T> = { data?: T; error?: { message?: string; code?: string } };

/**
 * Nothing waits forever.
 *
 * Without a deadline a request that never answers leaves the screen spinning
 * with no way back: no error, no retry, and on a button whose label is
 * replaced by the spinner, no clue what it is even waiting for. A phone on
 * salon wifi drops connections silently, so this is the common case, not the
 * exotic one.
 *
 * Most calls are small reads and 20s is already generous. Routes that
 * legitimately take longer name their own deadline.
 */
const TIMEOUT_MS = 20_000;

/** A model call sits inside this one; the server caps its own wait well below. */
export const AI_TIMEOUT_MS = 45_000;

/**
 * Deliberately past the server's own 60s ceiling.
 *
 * Giving up first on a send is the one case where a deadline does harm: the
 * engine may already have handed the message to WhatsApp, and an employee told
 * it failed will send it again. Letting the server answer — success, failure,
 * or its own timeout — keeps that decision in the one place that knows.
 */
export const SEND_TIMEOUT_MS = 65_000;

/**
 * Rejects as soon as `signal` aborts, giving an otherwise untimed await the
 * caller's deadline. Used for work that must finish before the request starts
 * but has no cancellation of its own.
 */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      if (signal.aborted) {
        reject(new Error("aborted"));
        return;
      }
      signal.addEventListener("abort", () => reject(new Error("aborted")), {
        once: true,
      });
    }),
  ]);
}

export type ApiRequestOptions = RequestInit & {
  /** Override the default deadline for a route known to take longer. */
  timeoutMs?: number;
};

export async function apiRequest<T>(
  path: string,
  init: ApiRequestOptions = {},
): Promise<T> {
  if (!apiUrl) {
    throw new ApiError("أضيفي EXPO_PUBLIC_API_URL في ملف .env", 0, "NO_API_URL");
  }

  const { timeoutMs = TIMEOUT_MS, ...requestInit } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  /**
   * The deadline covers the session read, not just the fetch.
   *
   * This await used to sit above the timer, outside the deadline it claims to
   * have. That is not a theoretical gap: supabase-js serialises session access
   * behind a lock, and the keychain-backed storage reads a sharded value one
   * await at a time, so a token refresh stalling on salon wifi holds the lock
   * and every later read queues behind it with no upper bound. A "20 second"
   * request then hangs forever — the spinner the timeout exists to prevent.
   */
  let accessToken: string;
  try {
    const { data, error } = await untilAborted(
      supabase.auth.getSession(),
      controller.signal,
    );
    if (error || !data.session?.access_token) {
      throw new ApiError("انتهت الجلسة. سجّلي الدخول مرة أخرى.", 401, "NO_SESSION");
    }
    accessToken = data.session.access_token;
  } catch (cause) {
    clearTimeout(timer);
    if (cause instanceof ApiError) throw cause;
    throw new ApiError("الخادم تأخر في الرد. حاولي مرة أخرى.", 0, "TIMEOUT");
  }

  let response: Response;
  try {
    response = await fetch(`${apiUrl}/api/mobile/v1${path}`, {
      ...requestInit,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(requestInit.body ? { "Content-Type": "application/json" } : {}),
        ...requestInit.headers,
        Authorization: `Bearer ${accessToken}`,
      },
    });
  } catch {
    // An abort and a dropped connection are the same thing to the employee:
    // it did not go through, and she may try again.
    throw new ApiError(
      controller.signal.aborted
        ? "الخادم تأخر في الرد. حاولي مرة أخرى."
        : "تعذر الاتصال بالخادم. تحققي من الإنترنت.",
      0,
      controller.signal.aborted ? "TIMEOUT" : "NETWORK",
    );
  } finally {
    clearTimeout(timer);
  }

  return unwrap<T>(response);
}

/** A file part, as React Native's `FormData` wants it. */
export type UploadFile = {
  uri: string;
  name: string;
  type: string;
};

/**
 * Multipart POST to the mobile API.
 *
 * Deliberately uses the global `fetch` rather than `expo/fetch`: only React
 * Native's networking layer knows how to stream a `file://` part from a
 * `{ uri, name, type }` object, which is the one form every picker on the
 * device hands back. `Content-Type` is left unset on purpose so RN can attach
 * the multipart boundary it generated.
 */
export async function apiUpload<T>(
  path: string,
  parts: Record<string, string | UploadFile>,
  options: { timeoutMs?: number } = {},
): Promise<T> {
  if (!apiUrl) {
    throw new ApiError("أضيفي EXPO_PUBLIC_API_URL في ملف .env", 0, "NO_API_URL");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? TIMEOUT_MS);
  let accessToken: string;
  try {
    const { data, error } = await untilAborted(
      supabase.auth.getSession(),
      controller.signal,
    );
    if (error || !data.session?.access_token) {
      throw new ApiError("انتهت الجلسة. سجّلي الدخول مرة أخرى.", 401, "NO_SESSION");
    }
    accessToken = data.session.access_token;
  } catch (cause) {
    clearTimeout(timer);
    if (cause instanceof ApiError) throw cause;
    throw new ApiError("الخادم تأخر في الرد. حاولي مرة أخرى.", 0, "TIMEOUT");
  }

  const form = new FormData();
  for (const [key, value] of Object.entries(parts)) {
    if (typeof value === "string") form.append(key, value);
    // RN's FormData accepts the file descriptor object; the DOM lib types
    // it takes here only know about `Blob`.
    else form.append(key, value as unknown as Blob);
  }

  // An upload that never answers used to hang the screen forever — there was
  // no deadline here at all. Callers that send on a person's behalf name their
  // own; the rest get the ordinary one.
  let response: Response;
  try {
    response = await globalThis.fetch(`${apiUrl}/api/mobile/v1${path}`, {
      method: "POST",
      body: form,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    });
  } catch {
    throw new ApiError(
      controller.signal.aborted
        ? "الخادم تأخر في الرد. حاولي مرة أخرى."
        : "تعذر رفع الملف. تحققي من الإنترنت.",
      0,
      controller.signal.aborted ? "TIMEOUT" : "NETWORK",
    );
  } finally {
    clearTimeout(timer);
  }

  return unwrap<T>(response);
}

/** Reads the `{ data } | { error }` envelope every mobile endpoint returns. */
async function unwrap<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as ApiEnvelope<T>;
  if (!response.ok) {
    if (response.status === 401) await supabase.auth.signOut({ scope: "local" });
    throw new ApiError(
      payload.error?.message || "تعذر إكمال الطلب",
      response.status,
      payload.error?.code,
    );
  }

  if (!("data" in payload)) {
    throw new ApiError("استجابة الخادم غير مكتملة", response.status, "INVALID_RESPONSE");
  }
  return payload.data as T;
}

export async function publicApiRequest<T>(
  path: string,
  init: ApiRequestOptions = {},
): Promise<T> {
  if (!apiUrl) {
    throw new ApiError("تعذر تحديد عنوان خادم كيارا", 0, "NO_API_URL");
  }

  const { timeoutMs = TIMEOUT_MS, ...requestInit } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${apiUrl}${path}`, {
      ...requestInit,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(requestInit.body ? { "Content-Type": "application/json" } : {}),
        ...requestInit.headers,
      },
    });
  } catch {
    throw new ApiError(
      controller.signal.aborted
        ? "الخادم تأخر في الرد. حاولي مرة أخرى."
        : "تعذر الاتصال بالخادم. تحققي من الإنترنت.",
      0,
      controller.signal.aborted ? "TIMEOUT" : "NETWORK",
    );
  } finally {
    clearTimeout(timer);
  }

  const payload = (await response.json().catch(() => ({}))) as {
    error?: string | { code?: string; message?: string };
  } & T;
  if (!response.ok) {
    const message =
      typeof payload.error === "string"
        ? payload.error
        : payload.error?.message || "تعذر إكمال الطلب";
    const code = typeof payload.error === "object" ? payload.error?.code : undefined;
    throw new ApiError(message, response.status, code);
  }
  return payload;
}
