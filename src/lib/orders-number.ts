import "server-only";

import { createHash } from "crypto";

import { notifyOrdersNumberWatchers } from "@/lib/inbox-notifications";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { KIARA_RESTAURANT_ID } from "@/lib/tenant";
import {
  EngineUnavailableError,
  getEngineState,
  isOpenWaConfigured,
  openWaTransport,
} from "@/lib/transport/openwa";
import type { MessageTransport, OutboundMedia, SendResult } from "@/lib/transport/types";

/**
 * The orders number — the linked device that tells drivers and specialists
 * about their orders — with an alarm on it.
 *
 * Every staff notification goes through here rather than straight to the
 * transport. When a send fails because the number cannot send at all, حنان and
 * وسيله are told in Arabic what happened and what to do; while it stays down
 * they are reminded every few hours; and the first send that works again tells
 * them it is back. Without this the number sat disconnected for seventeen days
 * with every order notification failing and nobody aware.
 *
 * Two things ring it: a send that fails, which is the moment an order
 * notification was lost, and `checkOrdersNumber()` every 30 minutes from
 * `/api/cron/orders-number`, which catches a drop on a quiet day before the
 * next order finds it. Both go through the same once-per-outage bookkeeping,
 * so the watchers hear about one outage once, whichever noticed it first.
 */

export { isOpenWaConfigured };

/** While still down, how long before the watchers are told again. */
const REMIND_EVERY_MS = 3 * 3600_000;

const AGGREGATE_TYPE = "orders_number";
const DOWN_EVENT = "orders_number.down_alerted";
const UP_EVENT = "orders_number.up_alerted";

type AlertRow = {
  id: string;
  event_type: string;
  occurred_at: string;
  payload: { since?: string } | null;
};

/** A stable uuid from a string, so racing callers produce the same key. */
function uuidFrom(key: string): string {
  const hex = createHash("sha256").update(key).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

async function latestAlert(): Promise<AlertRow | null> {
  const { data, error } = await getAdminSupabaseClient()
    .from("operation_events")
    .select("id, event_type, occurred_at, payload")
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .eq("aggregate_type", AGGREGATE_TYPE)
    .eq("aggregate_id", KIARA_RESTAURANT_ID)
    .order("occurred_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as AlertRow | null) ?? null;
}

/**
 * Claim the right to send one alert. The key is derived from the alert it
 * follows, so a dispatch failing three sends at once — driver, specialist,
 * second specialist — produces one alert, not three: the losers hit the unique
 * index and stand down.
 */
async function claimAlert(input: {
  eventType: string;
  after: AlertRow | null;
  payload: Record<string, unknown>;
}): Promise<string | null> {
  const { data, error } = await getAdminSupabaseClient()
    .from("operation_events")
    .insert({
      restaurant_id: KIARA_RESTAURANT_ID,
      aggregate_type: AGGREGATE_TYPE,
      aggregate_id: KIARA_RESTAURANT_ID,
      event_type: input.eventType,
      actor_type: "system",
      actor_role: "system",
      idempotency_key: uuidFrom(`${input.eventType}:after:${input.after?.id ?? "none"}`),
      payload: input.payload,
    })
    .select("id")
    .single();
  if (error?.code === "23505") return null;
  if (error) throw new Error(error.message);
  return data.id as string;
}

/** Un-claim an alert whose push never left, so the next failure retries it. */
async function releaseAlert(id: string): Promise<void> {
  await getAdminSupabaseClient().from("operation_events").delete().eq("id", id);
}

async function announce(
  claimedId: string,
  message: { title: string; body: string },
): Promise<void> {
  try {
    await notifyOrdersNumberWatchers(message);
  } catch (cause) {
    await releaseAlert(claimedId).catch(() => undefined);
    throw cause;
  }
}

function arabicCount(n: number, one: string, two: string, few: string, many: string) {
  if (n === 1) return one;
  if (n === 2) return two;
  if (n <= 10) return `${n} ${few}`;
  return `${n} ${many}`;
}

/** "ساعتين", "5 ساعات", "يوم" — how long the number has been down. */
export function arabicDuration(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return arabicCount(minutes, "دقيقة", "دقيقتين", "دقائق", "دقيقة");
  const hours = Math.round(minutes / 60);
  if (hours < 48) return arabicCount(hours, "ساعة", "ساعتين", "ساعات", "ساعة");
  return arabicCount(Math.round(hours / 24), "يوم", "يومين", "أيام", "يومًا");
}

export function downMessage(input: {
  reason: EngineUnavailableError["reason"];
  /** Set on a reminder: how long it has been down. */
  downFor?: string | null;
}): { title: string; body: string } {
  const lost = "رسائل الطلبات لا تصل للسائقين والأخصائيات على واتساب.";
  const still = input.downFor ? ` منذ ${input.downFor}` : "";
  if (input.reason === "disconnected") {
    return {
      title: input.downFor
        ? "⚠️ رقم الطلبات ما زال غير متصل"
        : "⚠️ رقم الطلبات انفصل عن واتساب",
      body:
        `${lost}${still ? ` (الانقطاع${still})` : ""}\n` +
        "لإعادة الربط: افتحي صفحة «أرقام واتساب» في لوحة كيارا، ثم امسحي رمز QR " +
        "من جوال رقم الطلبات (الإعدادات › الأجهزة المرتبطة › ربط جهاز).",
    };
  }
  return {
    title: input.downFor
      ? "⚠️ خادم رقم الطلبات ما زال لا يستجيب"
      : "⚠️ خادم رقم الطلبات لا يستجيب",
    body:
      `${lost}${still ? ` (الانقطاع${still})` : ""}\n` +
      "المشكلة في الخادم وليست في الجوال، فإعادة مسح الرمز لن تحلها. " +
      "تواصلي مع الدعم الفني لإعادة تشغيله.",
  };
}

export function upMessage(downFor: string | null): { title: string; body: string } {
  return {
    title: "✅ رقم الطلبات عاد للعمل",
    body:
      "رسائل الطلبات تصل للسائقين والأخصائيات من جديد." +
      (downFor ? ` استمر الانقطاع ${downFor}.` : "") +
      "\nالطلبات التي أُرسلت أثناء الانقطاع لم تصلهم على واتساب — راجعيها وأعيدي إرسالها عند الحاجة.",
  };
}

/** The number could not send. Tell the watchers, once per stretch of silence. */
async function reportDown(error: EngineUnavailableError): Promise<void> {
  const last = await latestAlert();
  const now = Date.now();
  const stillDown = last?.event_type === DOWN_EVENT;
  if (stillDown && now - Date.parse(last.occurred_at) < REMIND_EVERY_MS) return;

  const since = stillDown ? (last.payload?.since ?? last.occurred_at) : new Date(now).toISOString();
  const claimed = await claimAlert({
    eventType: DOWN_EVENT,
    after: last,
    payload: { since, reason: error.reason, error: error.message.slice(0, 300) },
  });
  if (!claimed) return;

  await announce(
    claimed,
    downMessage({
      reason: error.reason,
      downFor: stillDown ? arabicDuration(now - Date.parse(since)) : null,
    }),
  );
}

/** A send went through. If the watchers were last told it was down, say it's back. */
async function reportUp(): Promise<void> {
  const last = await latestAlert();
  if (last?.event_type !== DOWN_EVENT) return;

  const since = last.payload?.since ?? last.occurred_at;
  const downFor = arabicDuration(Date.now() - Date.parse(since));
  const claimed = await claimAlert({ eventType: UP_EVENT, after: last, payload: { since } });
  if (!claimed) return;

  await announce(claimed, upMessage(downFor));
}

/**
 * Send, and keep the watchers informed. The alarm never changes the outcome of
 * the send itself — its own failures are logged and swallowed, and the original
 * result or error is what the caller sees.
 */
async function watched(send: () => Promise<SendResult>): Promise<SendResult> {
  let result: SendResult;
  try {
    result = await send();
  } catch (error) {
    if (error instanceof EngineUnavailableError) {
      await reportDown(error).catch((cause) =>
        console.error("[orders-number] down alert failed", cause),
      );
    }
    throw error;
  }
  await reportUp().catch((cause) => console.error("[orders-number] up alert failed", cause));
  return result;
}

/**
 * States the engine passes through on its way to `ready` after a restart or a
 * fresh scan. Seeing one is not an outage — a check landing mid-reconnect
 * would otherwise wake two people for something that fixes itself in seconds.
 */
const SETTLING_STATES = new Set(["initializing", "authenticated"]);

/**
 * Ask the engine directly, without sending anything. What the 30-minute cron
 * calls; the answer feeds the same alarm a failed send does.
 */
export async function checkOrdersNumber(): Promise<{ state: string }> {
  if (!isOpenWaConfigured()) return { state: "not_configured" };
  const engine = await getEngineState();
  if (engine.state === "ready") {
    await reportUp();
  } else if (engine.state === "unreachable") {
    await reportDown(
      new EngineUnavailableError("OpenWA engine unreachable", { reason: "unreachable" }),
    );
  } else if (!SETTLING_STATES.has(engine.state)) {
    await reportDown(
      new EngineUnavailableError(`OpenWA engine state: ${engine.state}`, {
        reason: "disconnected",
      }),
    );
  }
  return { state: engine.state };
}

export const ordersNumber = {
  sendText(toE164: string, body: string): Promise<SendResult> {
    return watched(() => openWaTransport.sendText(toE164, body));
  },
  sendMedia(toE164: string, media: OutboundMedia): Promise<SendResult> {
    return watched(() => openWaTransport.sendMedia(toE164, media));
  },
};

/**
 * The same number as an inbox transport, for driver and specialist threads
 * (see `src/lib/staff-threads.ts`). A linked device is a phone: it has no
 * approved templates and no 24-hour window, and it takes no quoted-reply
 * context, so the per-send options are accepted and ignored.
 */
export const ordersNumberTransport: MessageTransport = {
  provider: "openwa",
  sendText: (toE164, body) => ordersNumber.sendText(toE164, body),
  sendMedia: (toE164, media) => ordersNumber.sendMedia(toE164, media),
  async sendTemplate() {
    throw new Error("TEMPLATES_NOT_SUPPORTED: the orders number sends free-form text");
  },
};
