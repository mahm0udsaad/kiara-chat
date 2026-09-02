import "server-only";

import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import type { AgentRole } from "@/lib/tenant";
import type { FieldOrderAction, FieldStaffRole } from "@/lib/field-staff";
import type { TripType } from "@/lib/types";

export type OperationalConflictCode =
  | "ORDER_VERSION_CONFLICT"
  | "ORDER_ALREADY_DISPATCHED"
  | "ORDER_DISPATCH_IN_PROGRESS"
  | "COMMAND_IN_PROGRESS"
  | "FIELD_VERSION_CONFLICT"
  | "FIELD_ACTION_OUT_OF_SEQUENCE";

const CONFLICT_CODES = new Set<OperationalConflictCode>([
  "ORDER_VERSION_CONFLICT",
  "ORDER_ALREADY_DISPATCHED",
  "ORDER_DISPATCH_IN_PROGRESS",
  "COMMAND_IN_PROGRESS",
  "FIELD_VERSION_CONFLICT",
  "FIELD_ACTION_OUT_OF_SEQUENCE",
]);

export class OperationalCommandError extends Error {
  constructor(
    public readonly code: string,
    public readonly detail: Record<string, unknown> | null = null,
  ) {
    super(code);
    this.name = "OperationalCommandError";
  }

  get isConflict(): boolean {
    return CONFLICT_CODES.has(this.code as OperationalConflictCode);
  }
}

function recordOf(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new OperationalCommandError("COMMAND_RESPONSE_INVALID");
  }
  return value as Record<string, unknown>;
}

function commandError(error: {
  message?: string;
  details?: string | null;
}): OperationalCommandError {
  const code = error.message?.trim() || "COMMAND_FAILED";
  let detail: Record<string, unknown> | null = null;
  if (error.details) {
    try {
      detail = recordOf(JSON.parse(error.details));
    } catch {
      detail = null;
    }
  }
  return new OperationalCommandError(code, detail);
}

async function rpc(
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { data, error } = await getAdminSupabaseClient().rpc(name, args);
  if (error) throw commandError(error);
  return recordOf(data);
}

export interface OperationsActor {
  userId: string;
  teamMemberId: string | null;
  role: AgentRole;
}

export async function updateOrderCommand(input: {
  restaurantId: string;
  orderId: string;
  expectedVersion: number;
  idempotencyKey: string;
  actor: OperationsActor;
  patch: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  return rpc("kiara_command_update_driver_order", {
    p_restaurant_id: input.restaurantId,
    p_order_id: input.orderId,
    p_expected_version: input.expectedVersion,
    p_idempotency_key: input.idempotencyKey,
    p_actor_user_id: input.actor.userId,
    p_actor_team_member_id: input.actor.teamMemberId,
    p_actor_role: input.actor.role,
    p_patch: input.patch,
  });
}

export async function prepareOrderDispatchCommand(input: {
  restaurantId: string;
  orderId: string;
  expectedVersion: number;
  idempotencyKey: string;
  actor: OperationsActor;
  specialistId: string;
  driverId: string;
  tripType: TripType;
  price: number | null;
  /** Shown to the driver inside the app — nothing is sent over WhatsApp. */
  driverNote: string;
  specialistNote: string;
  /** `whatsapp-media` storage path of the specialist's voice note, if any. */
  specialistVoicePath: string | null;
}): Promise<Record<string, unknown>> {
  return rpc("kiara_command_prepare_order_dispatch", {
    p_restaurant_id: input.restaurantId,
    p_order_id: input.orderId,
    p_expected_version: input.expectedVersion,
    p_idempotency_key: input.idempotencyKey,
    p_actor_user_id: input.actor.userId,
    p_actor_team_member_id: input.actor.teamMemberId,
    p_actor_role: input.actor.role,
    p_specialist_id: input.specialistId,
    p_driver_id: input.driverId,
    p_trip_type: input.tripType,
    p_price: input.price,
    p_driver_note: input.driverNote,
    p_specialist_note: input.specialistNote,
    p_specialist_voice_path: input.specialistVoicePath,
  });
}

export async function finishOrderDispatchCommand(input: {
  restaurantId: string;
  orderId: string;
  commandId: string;
  driverSent: boolean;
  specialistSent: boolean;
  driverError: string | null;
  specialistError: string | null;
}): Promise<Record<string, unknown>> {
  return rpc("kiara_command_finish_order_dispatch", {
    p_restaurant_id: input.restaurantId,
    p_order_id: input.orderId,
    p_command_id: input.commandId,
    p_driver_sent: input.driverSent,
    p_specialist_sent: input.specialistSent,
    p_driver_error: input.driverError,
    p_specialist_error: input.specialistError,
  });
}

export interface FieldLocationEvidence {
  latitude?: number;
  longitude?: number;
  accuracyMeters?: number;
  capturedAt?: string;
  source: "device" | "manual_exception";
  permissionState?: string;
  exceptionReason?: string;
}

export async function fieldOrderStepCommand(input: {
  restaurantId: string;
  orderId: string;
  expectedVersion: number;
  idempotencyKey: string;
  actorUserId: string;
  fieldStaffAccountId: string;
  role: FieldStaffRole;
  rosterId: string;
  action: FieldOrderAction;
  location: FieldLocationEvidence | null;
}): Promise<Record<string, unknown>> {
  return rpc("kiara_command_field_order_step", {
    p_restaurant_id: input.restaurantId,
    p_order_id: input.orderId,
    p_expected_version: input.expectedVersion,
    p_idempotency_key: input.idempotencyKey,
    p_actor_user_id: input.actorUserId,
    p_field_staff_account_id: input.fieldStaffAccountId,
    p_role: input.role,
    p_roster_id: input.rosterId,
    p_action: input.action,
    p_location: input.location,
  });
}
