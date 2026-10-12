import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { KIARA_RESTAURANT_ID } from "@/lib/tenant";

/**
 * Failures the mobile app reports about itself: screens that threw, freezes,
 * slow requests, and sessions that ended while the app was on screen.
 *
 * Everything from the phone is untrusted and bounded here: unknown kinds are
 * dropped, text is cut to length, and a batch is capped, so a misbehaving
 * build cannot fill the table.
 */

export const DIAGNOSTIC_KINDS = [
  "render_error",
  "fatal_js",
  "stall",
  "slow_request",
  "request_summary",
  "unclean_exit",
] as const;
export type DiagnosticKind = (typeof DIAGNOSTIC_KINDS)[number];

export type DiagnosticEvent = {
  kind: DiagnosticKind;
  message: string | null;
  stack: string | null;
  route: string | null;
  details: Record<string, unknown>;
  occurredAt: string;
};

export type DiagnosticDevice = {
  platform: string | null;
  osVersion: string | null;
  deviceModel: string | null;
  appVersion: string | null;
  updateId: string | null;
};

const MAX_EVENTS = 40;
const MAX_DETAILS_BYTES = 8_000;

const text = (value: unknown, max: number): string | null =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isKind(value: unknown): value is DiagnosticKind {
  return DIAGNOSTIC_KINDS.some((kind) => kind === value);
}

/** A phone's clock can be wrong; a time it cannot have seen is replaced. */
function occurredAt(value: unknown, nowMs: number): string {
  const ms = typeof value === "string" ? Date.parse(value) : NaN;
  const plausible =
    Number.isFinite(ms) && ms <= nowMs + 5 * 60_000 && ms >= nowMs - 30 * 86_400_000;
  return new Date(plausible ? ms : nowMs).toISOString();
}

export function parseDiagnosticDevice(raw: unknown): DiagnosticDevice {
  const device = record(raw);
  return {
    platform: text(device?.platform, 20),
    osVersion: text(device?.osVersion, 40),
    deviceModel: text(device?.deviceModel, 80),
    appVersion: text(device?.appVersion, 40),
    updateId: text(device?.updateId, 80),
  };
}

export function parseDiagnosticEvents(raw: unknown, nowMs = Date.now()): DiagnosticEvent[] {
  if (!Array.isArray(raw)) return [];
  const events: DiagnosticEvent[] = [];
  for (const item of raw.slice(0, MAX_EVENTS)) {
    const event = record(item);
    if (!event || !isKind(event.kind)) continue;
    const details = record(event.details) ?? {};
    events.push({
      kind: event.kind,
      message: text(event.message, 500),
      stack: text(event.stack, 4_000),
      route: text(event.route, 200),
      details: JSON.stringify(details).length <= MAX_DETAILS_BYTES ? details : { dropped: "too_large" },
      occurredAt: occurredAt(event.at, nowMs),
    });
  }
  return events;
}

/** Returns how many were stored; 0 when the table is not there yet. */
export async function saveMobileDiagnostics(
  reporter: { userId: string; role: string },
  device: DiagnosticDevice,
  events: DiagnosticEvent[],
): Promise<number> {
  if (!events.length) return 0;
  const { error } = await getAdminSupabaseClient()
    .from("mobile_diagnostics")
    .insert(
      events.map((event) => ({
        restaurant_id: KIARA_RESTAURANT_ID,
        user_id: reporter.userId,
        role: reporter.role,
        kind: event.kind,
        message: event.message,
        stack: event.stack,
        route: event.route,
        details: event.details,
        platform: device.platform,
        os_version: device.osVersion,
        device_model: device.deviceModel,
        app_version: device.appVersion,
        update_id: device.updateId,
        occurred_at: event.occurredAt,
      })),
    );
  return error ? 0 : events.length;
}
