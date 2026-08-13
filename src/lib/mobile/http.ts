import { NextResponse } from "next/server";
import { getKiaraSession, type KiaraSession } from "@/lib/tenant";
import { getFieldStaffSession, type FieldStaffSession } from "@/lib/field-staff";
import {
  MOBILE_API_VERSION,
  type MobileApiError,
} from "@/lib/mobile/contracts";

const MOBILE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Kiara-Api-Version": String(MOBILE_API_VERSION),
  Vary: "Authorization",
};

export function mobileData<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(
    { data },
    { status, headers: MOBILE_HEADERS }
  );
}

export function mobileError(
  status: number,
  code: string,
  message: string
): NextResponse<MobileApiError> {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: MOBILE_HEADERS }
  );
}

export type MobileAuthorization =
  | { session: KiaraSession; response?: never }
  | { session?: never; response: NextResponse<MobileApiError> };

export type AnyMobileSession = KiaraSession | FieldStaffSession;
export type AnyMobileAuthorization =
  | { session: AnyMobileSession; response?: never }
  | { session?: never; response: NextResponse<MobileApiError> };

/**
 * Mobile endpoints intentionally accept only an explicit Supabase access
 * token. Cookie sessions belong to the web dashboard and are not a fallback
 * here, which makes the v1 contract predictable for native clients.
 */
export async function authorizeMobileRequest(
  request: Request
): Promise<MobileAuthorization> {
  const authorization = request.headers.get("authorization")?.trim();
  if (!authorization?.startsWith("Bearer ") || authorization.length <= 7) {
    return {
      response: mobileError(
        401,
        "MISSING_ACCESS_TOKEN",
        "A Bearer access token is required"
      ),
    };
  }

  const session = await getKiaraSession();
  if (!session) {
    return {
      response: mobileError(
        401,
        "INVALID_ACCESS_TOKEN",
        "The access token is invalid or the account cannot access Kiara"
      ),
    };
  }

  return { session };
}

export async function authorizeAnyMobileRequest(
  request: Request
): Promise<AnyMobileAuthorization> {
  const authorization = request.headers.get("authorization")?.trim();
  if (!authorization?.startsWith("Bearer ") || authorization.length <= 7) {
    return {
      response: mobileError(401, "MISSING_ACCESS_TOKEN", "A Bearer access token is required"),
    };
  }
  const operations = await getKiaraSession();
  if (operations) return { session: operations };
  const field = await getFieldStaffSession();
  if (field) return { session: field };
  return {
    response: mobileError(
      401,
      "INVALID_ACCESS_TOKEN",
      "The access token is invalid or the account cannot access Kiara"
    ),
  };
}

export async function authorizeFieldStaffRequest(
  request: Request
): Promise<
  | { session: FieldStaffSession; response?: never }
  | { session?: never; response: NextResponse<MobileApiError> }
> {
  const auth = await authorizeAnyMobileRequest(request);
  if (auth.response) return auth;
  if (!("kind" in auth.session) || auth.session.kind !== "field") {
    return { response: mobileError(403, "FIELD_STAFF_REQUIRED", "Field staff access is required") };
  }
  return { session: auth.session };
}

export function mobileServerError(
  error: unknown,
  code: string,
  fallbackMessage: string
): NextResponse<MobileApiError> {
  console.error(`[mobile-api] ${code}`, error);
  return mobileError(500, code, fallbackMessage);
}

export function parseIntegerParam(
  value: string | null,
  fallback: number,
  min: number,
  max: number
): number {
  if (value === null || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}
