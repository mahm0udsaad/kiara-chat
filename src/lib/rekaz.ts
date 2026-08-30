/**
 * Kiara's schedule, read straight off the Rekaz platform.
 *
 * The client still hasn't enabled the "الوصول لـ API" integration, so there is
 * no API key — the platform's own SPA endpoint is what this reads, carrying the
 * tenant id in the `__tenant` header.
 *
 * That endpoint used to answer any request that named the tenant. On
 * 2026-08-22 it stopped: it now returns 401 with `www-authenticate: Bearer`.
 * The door the module was built on closed, exactly as the old comment here
 * anticipated, so requests now also carry a credential obtained by logging in
 * as the salon's own Rekaz user — see `src/lib/rekaz-auth.ts`. Everything
 * downstream still consumes `RekazReservation` and did not change.
 */
import type { RekazReservation } from "@/lib/reservations";
import { fetchWithTimeout } from "@/lib/http-timeout";
import {
  invalidateRekazAuth,
  RekazAuthError,
  rekazAuthHeaders,
} from "@/lib/rekaz-auth";

const REKAZ_API = "https://platform.rekaz.io/api/app/reservation";

/**
 * Kiara's Rekaz tenant (storefront `rekaz.io/kyara-sba-1`). Overridable so a
 * second salon never means a code change, but pinned by default the same way
 * `KIARA_RESTAURANT_ID` is — this app is deliberately single-tenant.
 */
const REKAZ_TENANT_ID =
  process.env.REKAZ_TENANT_ID ?? "3a1f3638-e6dc-d864-4aa7-df60cdbb1146";

/** Yesterday onwards: the day just past is still worth seeing on the tab. */
const DAYS_BACK = 1;
/** Rekaz holds bookings months out; past this they aren't today's work. */
const DAYS_AHEAD = 60;

const PAGE_SIZE = 200;
/** Runaway guard. The real window is ~150 rows, so this is never reached. */
const MAX_PAGES = 25;

const RIYADH_DAY_FMT = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: "Asia/Riyadh",
});

/** The Riyadh calendar day `offsetDays` from today, as `YYYY-MM-DD`. */
function riyadhDayKey(offsetDays: number): string {
  const base = new Date(`${RIYADH_DAY_FMT.format(new Date())}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + offsetDays);
  return base.toISOString().slice(0, 10);
}

/**
 * A Riyadh wall-clock boundary as the real instant it names.
 *
 * `date` in the payload is a true UTC stamp — an 11:00 Riyadh booking arrives
 * as `08:00:00Z` — so a window built from Riyadh midnights has to be converted
 * rather than stamped with a `Z` and hoped for. This used to read the `Z` as a
 * label on Riyadh wall clock and rewrite it as `+03:00`, which moved every
 * booking three hours earlier than the salon had actually booked it.
 */
function riyadhBoundary(dayKey: string, wallClock: string): string {
  return new Date(`${dayKey}T${wallClock}+03:00`).toISOString().replace(/\.\d{3}Z$/, "Z");
}

interface RekazApiReservation {
  reservationNumber: number;
  date: string;
  toDate: string | null;
  startAt: string;
  endAt: string;
  creationTime: string | null;
  statusString: string;
  productName: string | null;
  priceName: string | null;
  quantity: number | null;
  customerName: string | null;
  customerMobile: string | null;
  customerNotes: string | null;
  providers: { name: string | null }[] | null;
  orderId: string | null;
  orderPaymentStatusString: string | null;
  orderStatusString: string | null;
  orderTotalAmount: number | null;
  orderTotalRefunded: number | null;
  reservationTotalAmount: number | null;
  source: string | null;
  creatorName: string | null;
  customerLocation: {
    latitude: number;
    longitude: number;
    description: string | null;
  } | null;
}

/** `"HH:MM:SS"` pair → minutes, wrapping past midnight (`23:00` → `00:00`). */
function minutesBetween(startAt: string, endAt: string): number {
  const toMin = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  };
  const diff = toMin(endAt) - toMin(startAt);
  return diff > 0 ? diff : diff + 24 * 60;
}

function durationOf(item: RekazApiReservation): number {
  const start = Date.parse(item.date);
  const end = item.toDate ? Date.parse(item.toDate) : NaN;
  // Both stamps are real instants, so their difference is the real duration.
  if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
    return Math.round((end - start) / 60_000);
  }
  return minutesBetween(item.startAt, item.endAt);
}

function toReservation(item: RekazApiReservation): RekazReservation {
  const location = item.customerLocation;
  return {
    id: String(item.reservationNumber),
    arrivalAt: item.date,
    durationMinutes: durationOf(item),
    // The price name is the variant the customer actually booked ("حمام مغربي
    // عادي"); the product name is the family it belongs to. Prefer the variant.
    service: item.priceName?.trim() || item.productName?.trim() || "",
    customerName: item.customerName?.trim() ?? "",
    customerPhone: `+${String(item.customerMobile ?? "").replace(/\D/g, "")}`,
    providers: (item.providers ?? [])
      .map((p) => p.name?.trim() ?? "")
      .filter(Boolean),
    status: item.statusString,
    payment: item.orderPaymentStatusString ?? "",
    amount: Number(item.reservationTotalAmount) || 0,
    location: location
      ? {
          lat: location.latitude,
          lng: location.longitude,
          label: location.description?.trim() ?? "",
        }
      : null,
    quantity: Number(item.quantity) || 1,
    source: item.source ?? "",
    // Absent on a customer's own online booking — nobody on staff entered it.
    createdBy: item.creatorName?.trim() ?? "",
    // `creationTime` is a true UTC instant, like `date`.
    bookedAt: item.creationTime ?? "",
    order: {
      id: item.orderId ?? "",
      status: item.orderStatusString ?? "",
      total: Number(item.orderTotalAmount) || 0,
      refunded: Number(item.orderTotalRefunded) || 0,
    },
    notes: item.customerNotes?.trim() ?? "",
  };
}

/** One page of the reservation list, with any extra filter params merged in. */
async function fetchPage(
  skipCount: number,
  params: Record<string, string> = {}
): Promise<RekazApiReservation[]> {
  const url = new URL(REKAZ_API);
  url.searchParams.set("MaxResultCount", String(PAGE_SIZE));
  url.searchParams.set("SkipCount", String(skipCount));
  // Newest date first, so the upcoming window is the first page or two and
  // paging can stop the moment it walks off the back of it.
  url.searchParams.set("Sorting", "date desc");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const read = async () => {
    const auth = await rekazAuthHeaders();
    return fetchWithTimeout(url, {
      headers: {
        "X-Requested-With": "XMLHttpRequest",
        __tenant: REKAZ_TENANT_ID,
        Accept: "application/json",
        ...auth,
      },
      cache: "no-store",
    });
  };

  let res = await read();
  if (res.status === 401 || res.status === 403) {
    // The credential expired mid-window, or Rekaz invalidated the session.
    // One re-login, then believe the answer: retrying a genuine rejection in a
    // loop is how an account gets locked.
    invalidateRekazAuth();
    res = await read();
  }

  if (res.status === 401 || res.status === 403) {
    throw new RekazAuthError(
      "Rekaz refused the salon session",
      "rejected",
      `HTTP ${res.status}`
    );
  }
  if (!res.ok) {
    throw new Error(`Rekaz responded ${res.status}`);
  }
  const body = (await res.json()) as { items?: RekazApiReservation[] };
  return body.items ?? [];
}

/** The bounds a fetch actually covered, as real UTC instants. */
export interface RekazFetchWindow {
  start: string;
  end: string;
}

export interface RekazFetchResult {
  reservations: RekazReservation[];
  window: RekazFetchWindow;
}

/** A cancelled booking still exists in Rekaz; it has not disappeared. */
export const isCancelledReservation = (reservation: RekazReservation): boolean =>
  reservation.status === "Cancelled";

/**
 * Every reservation in the working window, oldest first, together with the
 * window that produced it.
 *
 * The window travels with the rows because absence only means something
 * relative to it: this is a ROLLING range, so a reservation from last week is
 * missing for a wholly innocent reason. A sync that judged absence without the
 * window would retire the previous day's bookings on every run.
 *
 * Cancelled rows are KEPT here. They are a status the delta sync must be able
 * to record — a cancellation is not a removal — and dropping them at the
 * adapter is what made a cancelled booking indistinguishable from one deleted
 * out of Rekaz entirely. Display surfaces filter them instead: the web tab
 * groups a customer's services into one visit, where a cancelled service would
 * inflate the visit total and its time span.
 */
export async function fetchRekazReservations(): Promise<RekazFetchResult> {
  const windowStart = riyadhBoundary(riyadhDayKey(-DAYS_BACK), "00:00:00");
  const windowEnd = riyadhBoundary(riyadhDayKey(DAYS_AHEAD), "23:59:59");
  const startMs = Date.parse(windowStart);
  const endMs = Date.parse(windowEnd);

  const collected: RekazReservation[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const items = await fetchPage(page * PAGE_SIZE);
    if (items.length === 0) break;

    for (const item of items) {
      // Compared as instants, not strings: the boundaries are Riyadh midnights
      // converted to UTC, so they no longer share the payload's shape.
      const at = Date.parse(item.date);
      if (!Number.isFinite(at)) continue;
      if (at > endMs) continue; // further out than we care about
      if (at < startMs) continue;
      collected.push(toReservation(item));
    }

    // Sorted descending, so once a page ends before the window starts every
    // later page does too.
    if (Date.parse(items[items.length - 1].date) < startMs) break;
    if (items.length < PAGE_SIZE) break;
  }

  return {
    reservations: collected.sort((a, b) => a.arrivalAt.localeCompare(b.arrivalAt)),
    window: { start: windowStart, end: windowEnd },
  };
}

export interface CustomerRevenue {
  /** Lifetime value of non-cancelled orders, net of refunds — the headline. */
  net: number;
  /** Gross booked value before refunds. */
  booked: number;
  refunded: number;
  /** Distinct Rekaz orders (a visit of several services is one order). */
  orders: number;
}

export interface CustomerRekazHistory {
  reservations: RekazReservation[]; // newest arrival first
  revenue: CustomerRevenue;
  firstBookingAt: string | null; // earliest arrivalAt, UTC ISO
  lastBookingAt: string | null; // latest arrivalAt, UTC ISO
}

/**
 * One customer's whole Rekaz history — every booking she has ever had, not just
 * the windowed snapshot the table renders.
 *
 * The reservation endpoint takes a `CustomerMobile` filter (verified: it wants
 * the bare `9665…`, no `+`), so this is a direct lookup rather than a scan.
 * Cancelled reservations are KEPT here, unlike the schedule snapshot: a
 * customer's timeline should show that a booking was cancelled, and revenue is
 * computed per distinct order so a cancelled order simply contributes nothing.
 */
export async function fetchCustomerReservations(
  phone: string
): Promise<CustomerRekazHistory> {
  const mobile = String(phone).replace(/\D/g, "");
  if (mobile.length < 8) {
    return { reservations: [], revenue: emptyRevenue(), firstBookingAt: null, lastBookingAt: null };
  }

  const items: RekazApiReservation[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const batch = await fetchPage(page * PAGE_SIZE, { CustomerMobile: mobile });
    items.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }

  // Revenue is per distinct order: several services booked together share one
  // order total, so summing per reservation would multiply-count it.
  const orders = new Map<string, { total: number; refunded: number; status: string }>();
  for (const it of items) {
    const id = it.orderId ?? String(it.reservationNumber);
    if (!orders.has(id)) {
      orders.set(id, {
        total: Number(it.orderTotalAmount) || 0,
        refunded: Number(it.orderTotalRefunded) || 0,
        status: it.orderStatusString ?? "",
      });
    }
  }
  let booked = 0;
  let refunded = 0;
  for (const o of orders.values()) {
    if (o.status === "Cancelled") continue;
    booked += o.total;
    refunded += o.refunded;
  }

  const reservations = items
    .map(toReservation)
    .sort((a, b) => b.arrivalAt.localeCompare(a.arrivalAt));

  return {
    reservations,
    revenue: {
      net: Math.round((booked - refunded) * 100) / 100,
      booked: Math.round(booked * 100) / 100,
      refunded: Math.round(refunded * 100) / 100,
      orders: orders.size,
    },
    firstBookingAt: reservations.at(-1)?.arrivalAt ?? null,
    lastBookingAt: reservations[0]?.arrivalAt ?? null,
  };
}

const emptyRevenue = (): CustomerRevenue => ({ net: 0, booked: 0, refunded: 0, orders: 0 });
