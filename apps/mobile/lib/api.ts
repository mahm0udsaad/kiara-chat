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

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  if (!apiUrl) {
    throw new ApiError("أضيفي EXPO_PUBLIC_API_URL في ملف .env", 0, "NO_API_URL");
  }

  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) {
    throw new ApiError("انتهت الجلسة. سجّلي الدخول مرة أخرى.", 401, "NO_SESSION");
  }

  let response: Response;
  try {
    response = await fetch(`${apiUrl}/api/mobile/v1${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
        Authorization: `Bearer ${data.session.access_token}`,
      },
    });
  } catch {
    throw new ApiError("تعذر الاتصال بالخادم. تحققي من الإنترنت.", 0, "NETWORK");
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
): Promise<T> {
  if (!apiUrl) {
    throw new ApiError("أضيفي EXPO_PUBLIC_API_URL في ملف .env", 0, "NO_API_URL");
  }

  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) {
    throw new ApiError("انتهت الجلسة. سجّلي الدخول مرة أخرى.", 401, "NO_SESSION");
  }

  const form = new FormData();
  for (const [key, value] of Object.entries(parts)) {
    if (typeof value === "string") form.append(key, value);
    // RN's FormData accepts the file descriptor object; the DOM lib types
    // it takes here only know about `Blob`.
    else form.append(key, value as unknown as Blob);
  }

  let response: Response;
  try {
    response = await globalThis.fetch(`${apiUrl}/api/mobile/v1${path}`, {
      method: "POST",
      body: form,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${data.session.access_token}`,
      },
    });
  } catch {
    throw new ApiError("تعذر رفع الملف. تحققي من الإنترنت.", 0, "NETWORK");
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
  init: RequestInit = {},
): Promise<T> {
  if (!apiUrl) {
    throw new ApiError("تعذر تحديد عنوان خادم كيارا", 0, "NO_API_URL");
  }

  let response: Response;
  try {
    response = await fetch(`${apiUrl}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new ApiError("تعذر الاتصال بالخادم. تحققي من الإنترنت.", 0, "NETWORK");
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
