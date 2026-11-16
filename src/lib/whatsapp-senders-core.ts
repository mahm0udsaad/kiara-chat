/**
 * Rules for choosing a customer-reply sender, free of imports so they can be
 * tested on their own. The server module wraps these with the database and the
 * engines' live state.
 */

/** The Meta Business number: every conversation's sender unless changed. */
export const DEFAULT_SENDER_ID = "meta";

export type SenderRow = {
  id: string;
  provider: "meta" | "openwa";
  phone: string | null;
  label: string;
  enabled: boolean;
  allowed_roles: string[];
  sort_order: number;
};

export type SenderStatus = {
  available: boolean;
  reason: "disabled" | "not_configured" | "disconnected" | "unreachable" | null;
};

export type SenderErrorCode =
  | "SENDER_UNKNOWN"
  | "SENDER_FORBIDDEN"
  | "SENDER_DISABLED"
  | "SENDER_UNAVAILABLE";

const MESSAGES: Record<SenderErrorCode, string> = {
  SENDER_UNKNOWN: "رقم الإرسال غير معروف.",
  SENDER_FORBIDDEN: "لا تملكين صلاحية الإرسال من هذا الرقم.",
  SENDER_DISABLED: "رقم الإرسال هذا موقوف حاليًا.",
  SENDER_UNAVAILABLE: "رقم الإرسال غير متصل الآن — لم تُرسل الرسالة. اختاري رقمًا آخر أو حاولي لاحقًا.",
};

const STATUS: Record<SenderErrorCode, number> = {
  SENDER_UNKNOWN: 400,
  SENDER_FORBIDDEN: 403,
  SENDER_DISABLED: 409,
  SENDER_UNAVAILABLE: 503,
};

export class SenderError extends Error {
  readonly code: SenderErrorCode;
  readonly status: number;
  readonly senderId: string | null;
  readonly reason: SenderStatus["reason"];

  constructor(code: SenderErrorCode, senderId: string | null = null, reason: SenderStatus["reason"] = null) {
    super(MESSAGES[code]);
    this.name = "SenderError";
    this.code = code;
    this.status = STATUS[code];
    this.senderId = senderId;
    this.reason = reason;
  }
}

/**
 * Which sender a reply uses. An explicit request wins over the saved choice,
 * which wins over the default; whichever is picked must exist, be on, and be
 * allowed for this role. There is no fallback: a bad pick is an error, so a
 * message never leaves from a number the employee did not choose.
 */
export function pickSender(
  rows: SenderRow[],
  // `role` is absent only for system-initiated sends, which skip the role rule.
  input: { requested: string | null | undefined; saved: string | null | undefined; role?: string },
): SenderRow {
  const id = input.requested || input.saved || DEFAULT_SENDER_ID;
  const row = rows.find((candidate) => candidate.id === id);
  if (!row) throw new SenderError("SENDER_UNKNOWN", id);
  if (input.role !== undefined && !row.allowed_roles.includes(input.role)) throw new SenderError("SENDER_FORBIDDEN", id);
  if (!row.enabled) throw new SenderError("SENDER_DISABLED", id, "disabled");
  return row;
}

/** A sender id from a request body, or null if it is not one. */
export function parseSenderId(value: unknown): string | null {
  return typeof value === "string" && /^[a-z][a-z0-9_]{1,31}$/.test(value) ? value : null;
}

/**
 * Meta's 24-hour window opens only on a customer message that reached the
 * Meta number. History rows carry no sender and were all on the Business
 * number, so they count; a message to an OpenWA number does not.
 */
export function opensMetaWindow(senderAccount: string | null | undefined): boolean {
  return !senderAccount || senderAccount === DEFAULT_SENDER_ID;
}
