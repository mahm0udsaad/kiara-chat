/**
 * Credit a Rekaz booking to the employee who entered it.
 *
 * Rekaz stamps every reservation with the name of whoever created it — the
 * same list of women who work the inbox — so a booking can be matched back to
 * a team member and set beside the chats she handled. That turns the customer
 * service report from "how busy was she" into "what came of it".
 *
 * Pure on purpose: the report fetches the rows, this decides who gets the
 * credit, and both halves stay testable without a database.
 */

import { normalizePhone } from "@/lib/phone";

/**
 * Rekaz names carry decoration the roster does not: "وفاء💞", and a "مــرام"
 * padded with tatweel. Strip both, fold the whitespace, and the two lists line
 * up — every distinct name seen in a month of production matched a roster row
 * this way.
 *
 * Matching stays exact after normalization, never fuzzy or by prefix. Two women
 * on the roster can share a stem, and crediting one for the other's work is
 * worse than crediting nobody.
 *
 * It also cannot merge two roster rows that belong to one woman — مرام and
 * مرامي are the same employee under two sign-ins, so her bookings land on
 * whichever row Rekaz names and her chats on whichever row she is signed in
 * with. That is a roster duplicate to settle in the team list, not something
 * name matching can guess at.
 */
export function normalizeStaffName(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/ـ/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .trim()
    .replace(/\s+/g, " ");
}

export interface RekazBookingRow {
  /** The reservation payload as Rekaz returned it. */
  payload: {
    createdBy?: string | null;
    customerPhone?: string | null;
    bookedAt?: string | null;
    amount?: number | string | null;
    status?: string | null;
  } | null;
  customer_phone?: string | null;
  first_seen_at?: string | null;
  removed_at?: string | null;
}

export interface RekazBookingCredit {
  /** Bookings she entered into Rekaz in the period. */
  bookings: number;
  /** Of those, the ones for a customer she had replied to herself. */
  bookingsFromHerChats: number;
  /** Booked value, cancelled and removed reservations excluded. */
  bookedRevenue: number;
  /** Typical gap between her first reply and the booking, in hours. */
  medianHoursToBooking: number | null;
}

export const EMPTY_REKAZ_CREDIT: RekazBookingCredit = {
  bookings: 0,
  bookingsFromHerChats: 0,
  bookedRevenue: 0,
  medianHoursToBooking: null,
};

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function creditRekazBookings(input: {
  reservations: RekazBookingRow[];
  /** Roster names, keyed by team member id. */
  namesByMemberId: Map<string, string | null>;
  /**
   * When each employee first replied to a customer, keyed
   * `<teamMemberId>:<normalized phone>`. Built from the same message rows the
   * rest of the report counts, so a chat outside the selected window is not
   * silently credited.
   */
  firstReplyAt: Map<string, string>;
  /** Only bookings made inside the reporting window are counted. */
  fromMs: number;
  toMs: number;
}): Map<string, RekazBookingCredit> {
  const memberByName = new Map<string, string>();
  for (const [memberId, name] of input.namesByMemberId) {
    const key = normalizeStaffName(name);
    // A duplicate roster name cannot be resolved, so credit neither: the
    // report would otherwise hand one woman all of another's bookings.
    if (!key) continue;
    if (memberByName.has(key)) memberByName.set(key, "");
    else memberByName.set(key, memberId);
  }

  const credits = new Map<string, RekazBookingCredit>();
  const lags = new Map<string, number[]>();

  for (const row of input.reservations) {
    const payload = row.payload;
    // An empty `createdBy` is Rekaz's own marker for a booking the customer
    // made herself on the website. Nobody on staff earns it.
    const memberId = memberByName.get(normalizeStaffName(payload?.createdBy));
    if (!memberId) continue;

    const bookedAt = Date.parse(payload?.bookedAt ?? row.first_seen_at ?? "");
    if (!Number.isFinite(bookedAt) || bookedAt < input.fromMs || bookedAt > input.toMs) {
      continue;
    }

    const credit = credits.get(memberId) ?? { ...EMPTY_REKAZ_CREDIT };
    credit.bookings += 1;

    // A cancelled or withdrawn reservation still shows the work she did, so it
    // keeps its place in the count — but it never became money.
    if (!row.removed_at && payload?.status !== "Cancelled") {
      credit.bookedRevenue += Number(payload?.amount ?? 0) || 0;
    }

    const phone = normalizePhone(
      String(payload?.customerPhone ?? row.customer_phone ?? ""),
    );
    const repliedAt = phone
      ? Date.parse(input.firstReplyAt.get(`${memberId}:${phone}`) ?? "")
      : NaN;
    if (Number.isFinite(repliedAt)) {
      credit.bookingsFromHerChats += 1;
      // Only forward gaps describe a chat that led to a booking. A booking
      // entered before she ever wrote is a walk-in or a phone call she is
      // still credited for, but it says nothing about her reply speed.
      if (bookedAt >= repliedAt) {
        const list = lags.get(memberId) ?? [];
        list.push((bookedAt - repliedAt) / 3_600_000);
        lags.set(memberId, list);
      }
    }

    credits.set(memberId, credit);
  }

  for (const [memberId, values] of lags) {
    const credit = credits.get(memberId);
    if (!credit) continue;
    const value = median(values);
    credit.medianHoursToBooking = value === null ? null : Math.round(value * 10) / 10;
  }
  for (const credit of credits.values()) {
    credit.bookedRevenue = Math.round(credit.bookedRevenue);
  }
  return credits;
}
