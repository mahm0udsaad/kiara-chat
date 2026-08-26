import type {
  FieldOrderProgress,
  FieldSessionRole,
  FieldSessionState,
  OrderSummary,
} from "@/types/api";

/**
 * Reading an order's execution the way the office needs it.
 *
 * The field app advances a five-link chain — confirm_ride → confirm_pickup →
 * start_service → complete_order → driver_return — and the driver's
 * "I've reached the specialist" ping sits beside it. The office screens only
 * ever ask two things of that chain: how far has it got, and who is holding it
 * up. Both answers live here so the orders list, the order detail and the
 * status screen never disagree about a visit.
 *
 * Orders raised before the in-app workflow (and orders served by an API build
 * that predates `field_progress`) have no progress row. Those fall back to the
 * older two-timestamp `driver_session`/`specialist_session` mirror, which is
 * coarser but never wrong about whether a leg started.
 */

export type ExecutionStepId =
  | "confirm_ride"
  | "confirm_pickup"
  | "start_service"
  | "complete_order"
  | "driver_return";

export type ExecutionStep = {
  id: ExecutionStepId;
  /** Short label for the rail; the timeline adds the timestamp itself. */
  label: string;
  /** Who performs it — the person a reminder should go to. */
  owner: FieldSessionRole;
  at: string | null;
  done: boolean;
  /** The one step the chain is waiting on right now. */
  current: boolean;
};

export type ExecutionStage =
  | "not_dispatched"
  | "awaiting_driver"
  | "driver_on_the_way"
  | "driver_waiting"
  | "on_the_way_to_customer"
  | "service_running"
  | "awaiting_driver_return"
  | "completed";

export type ExecutionState = {
  stage: ExecutionStage;
  /** One line for a badge or a card subtitle. */
  label: string;
  tone: "neutral" | "brand" | "success" | "warning" | "danger" | "info";
  steps: ExecutionStep[];
  /** Whoever must act next; null once the visit is closed or undispatched. */
  pendingRole: FieldSessionRole | null;
  pendingLabel: string | null;
  /** The driver announced he reached the specialist but she is not in yet. */
  driverWaiting: boolean;
  /** Minutes since the last recorded step, when a step is still outstanding. */
  stalledMinutes: number | null;
  /** No progress row at all — the visit has not been dispatched into the app. */
  tracked: boolean;
  completedAt: string | null;
};

const STAGE_LABEL: Record<ExecutionStage, string> = {
  not_dispatched: "لم يبدأ التنفيذ",
  awaiting_driver: "بانتظار تأكيد السائق",
  driver_on_the_way: "السائق في الطريق للأخصائية",
  driver_waiting: "السائق ينتظر الأخصائية",
  on_the_way_to_customer: "في الطريق إلى العميلة",
  service_running: "الجلسة جارية",
  awaiting_driver_return: "بانتظار عودة السائق",
  completed: "اكتمل الطلب",
};

const STAGE_TONE: Record<ExecutionStage, ExecutionState["tone"]> = {
  not_dispatched: "neutral",
  awaiting_driver: "warning",
  driver_on_the_way: "info",
  driver_waiting: "warning",
  on_the_way_to_customer: "info",
  service_running: "brand",
  awaiting_driver_return: "warning",
  completed: "success",
};

/** Wording matches the field app's own buttons, so both sides say the same thing. */
const STEP_LABEL: Record<ExecutionStepId, string> = {
  confirm_ride: "تأكيد الرحلة",
  confirm_pickup: "ركوب الأخصائية",
  start_service: "بدء الخدمة",
  complete_order: "إنهاء الخدمة",
  driver_return: "عودة السائق",
};

const STEP_ACTION_LABEL: Record<ExecutionStepId, string> = {
  confirm_ride: "تأكيد الرحلة والانطلاق",
  confirm_pickup: "ركوب الأخصائية مع السائق",
  start_service: "بدء الخدمة عند العميلة",
  complete_order: "إنهاء الخدمة والمغادرة",
  driver_return: "إنهاء الرحلة والعودة",
};

const STEP_OWNER: Record<ExecutionStepId, FieldSessionRole> = {
  confirm_ride: "driver",
  confirm_pickup: "specialist",
  start_service: "specialist",
  complete_order: "specialist",
  driver_return: "driver",
};

const STEP_ORDER: ExecutionStepId[] = [
  "confirm_ride",
  "confirm_pickup",
  "start_service",
  "complete_order",
  "driver_return",
];

export const EXECUTION_STEP_LABEL = STEP_LABEL;

/**
 * The older mirror, read as a progress row.
 *
 * It only ever recorded a start and a finish per leg, so the two middle links
 * are inferred: a specialist session that started means she was picked up, and
 * a driver leg that finished means he came back.
 */
function progressFromSessions(
  driver: FieldSessionState | undefined,
  specialist: FieldSessionState | undefined,
): FieldOrderProgress | null {
  if (!driver?.started_at && !specialist?.started_at) return null;
  return {
    driverConfirmedAt: driver?.started_at ?? null,
    driverArrivedAt: null,
    specialistPickupAt: specialist?.started_at ?? null,
    serviceStartedAt: specialist?.started_at ?? null,
    completedAt: specialist?.completed_at ?? null,
    driverReturnedAt: driver?.completed_at ?? null,
    lastActivityAt:
      specialist?.completed_at ??
      specialist?.started_at ??
      driver?.completed_at ??
      driver?.started_at ??
      "",
    lastReminderAt: null,
    version: 0,
  };
}

function stampOf(
  progress: FieldOrderProgress,
  step: ExecutionStepId,
): string | null {
  switch (step) {
    case "confirm_ride":
      return progress.driverConfirmedAt;
    case "confirm_pickup":
      return progress.specialistPickupAt;
    case "start_service":
      return progress.serviceStartedAt;
    case "complete_order":
      return progress.completedAt;
    case "driver_return":
      return progress.driverReturnedAt;
  }
}

function stageOf(
  progress: FieldOrderProgress,
  current: ExecutionStepId | null,
): ExecutionStage {
  if (!current) return "completed";
  switch (current) {
    case "confirm_ride":
      return "awaiting_driver";
    case "confirm_pickup":
      return progress.driverArrivedAt ? "driver_waiting" : "driver_on_the_way";
    case "start_service":
      return "on_the_way_to_customer";
    case "complete_order":
      return "service_running";
    case "driver_return":
      return "awaiting_driver_return";
  }
}

/** Read one order's execution, whichever source of truth it has. */
export function executionStateOf(
  order: Pick<
    OrderSummary,
    "field_progress" | "driver_session" | "specialist_session"
  >,
  now = new Date(),
): ExecutionState {
  const progress =
    order.field_progress ??
    progressFromSessions(order.driver_session, order.specialist_session);

  if (!progress) {
    return {
      stage: "not_dispatched",
      label: STAGE_LABEL.not_dispatched,
      tone: STAGE_TONE.not_dispatched,
      steps: STEP_ORDER.map((id) => ({
        id,
        label: STEP_LABEL[id],
        owner: STEP_OWNER[id],
        at: null,
        done: false,
        current: false,
      })),
      pendingRole: null,
      pendingLabel: null,
      driverWaiting: false,
      stalledMinutes: null,
      tracked: false,
      completedAt: null,
    };
  }

  const current = STEP_ORDER.find((id) => !stampOf(progress, id)) ?? null;
  const stage = stageOf(progress, current);
  const lastActivityAt =
    progress.lastActivityAt ||
    [...STEP_ORDER]
      .reverse()
      .map((id) => stampOf(progress, id))
      .find(Boolean) ||
    null;

  return {
    stage,
    label: STAGE_LABEL[stage],
    tone: STAGE_TONE[stage],
    steps: STEP_ORDER.map((id) => ({
      id,
      label: STEP_LABEL[id],
      owner: STEP_OWNER[id],
      at: stampOf(progress, id),
      done: Boolean(stampOf(progress, id)),
      current: id === current,
    })),
    pendingRole: current ? STEP_OWNER[current] : null,
    pendingLabel: current ? STEP_ACTION_LABEL[current] : null,
    driverWaiting: stage === "driver_waiting",
    stalledMinutes:
      current && lastActivityAt
        ? Math.max(
            0,
            Math.round(
              (now.getTime() - new Date(lastActivityAt).getTime()) / 60_000,
            ),
          )
        : null,
    tracked: true,
    completedAt: progress.driverReturnedAt ?? progress.completedAt,
  };
}

/**
 * Is this order late enough to say so out loud?
 *
 * Deliberately generous: the salon's own reminder cron waits 30 minutes before
 * nudging anyone, so anything under that is just a step in progress, not a
 * problem worth colouring a card red.
 */
export function executionIsStalled(state: ExecutionState): boolean {
  return state.tracked && (state.stalledMinutes ?? 0) >= 30;
}

/** "٤٥ د" / "٣ س" — how long the current step has been outstanding. */
export function stalledLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} دقيقة`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} س و${rest} د` : `${hours} ساعة`;
}

export const ROLE_LABEL: Record<FieldSessionRole, string> = {
  driver: "السائق",
  specialist: "الأخصائية",
};
