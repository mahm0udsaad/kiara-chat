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
