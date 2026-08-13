/**
 * Kiara's schedule, read straight off the Rekaz platform.
 *
 * The client hasn't enabled the "الوصول لـ API" integration, so there is no API
 * key and no OAuth — but the platform's own SPA endpoint answers a plain server
 * request as long as it carries the tenant id in the `__tenant` header. No
 * session cookie, no antiforgery pair (those are only needed for the endpoints
 * that write). That is what lets /orders refresh itself from a button instead
 * of someone exporting rows out of a logged-in browser.
 *
 * If Rekaz ever closes that door, this module is the only thing that changes:
 * everything downstream consumes `RekazReservation`.
 */
import type { RekazReservation } from "@/lib/reservations";

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

/**
 * Rekaz stamps Riyadh wall clock with a fake `Z` — `17:00:00Z` means 5pm in
 * Riyadh, not UTC. Every date in the payload carries the same lie, so the
 * window is expressed in that same shape and compared as a plain string: no
 * Date math, and therefore no chance of the server's own timezone leaking in.
 */
function riyadhDayKey(offsetDays: number): string {
  const base = new Date(`${RIYADH_DAY_FMT.format(new Date())}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + offsetDays);
  return base.toISOString().slice(0, 10);
}

/** The fake `Z` rewritten as the offset it actually meant. */
const riyadhIso = (fakeZ: string) => fakeZ.replace(/Z$/, "+03:00");

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
  // Both stamps carry the same fake Z, so the difference between them is the
  // real duration even though neither instant is real.
  if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
    return Math.round((end - start) / 60_000);
  }
  return minutesBetween(item.startAt, item.endAt);
}

function toReservation(item: RekazApiReservation): RekazReservation {
  const location = item.customerLocation;
  return {
    id: String(item.reservationNumber),
    arrivalAt: riyadhIso(item.date),
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
    // Unlike every other stamp in the payload, `creationTime` is a true UTC
    // instant, so it must not be rewritten as +03:00 the way `date` is.
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

  const res = await fetch(url, {
    headers: {
      "X-Requested-With": "XMLHttpRequest",
      __tenant: REKAZ_TENANT_ID,
      Accept: "application/json",
    },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Rekaz responded ${res.status}`);
  }
  const body = (await res.json()) as { items?: RekazApiReservation[] };
  return body.items ?? [];
}

/** The bounds a fetch actually covered, as real +03:00 instants. */
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
  const windowStart = `${riyadhDayKey(-DAYS_BACK)}T00:00:00Z`;
  const windowEnd = `${riyadhDayKey(DAYS_AHEAD)}T23:59:59Z`;

  const collected: RekazReservation[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const items = await fetchPage(page * PAGE_SIZE);
    if (items.length === 0) break;

    for (const item of items) {
      if (item.date > windowEnd) continue; // further out than we care about
      if (item.date < windowStart) continue;
      collected.push(toReservation(item));
    }

    // Sorted descending, so once a page ends before the window starts every
    // later page does too.
    if (items[items.length - 1].date < windowStart) break;
    if (items.length < PAGE_SIZE) break;
  }

  return {
    reservations: collected.sort((a, b) => a.arrivalAt.localeCompare(b.arrivalAt)),
    window: { start: riyadhIso(windowStart), end: riyadhIso(windowEnd) },
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
  firstBookingAt: string | null; // earliest arrivalAt, ISO +03:00
  lastBookingAt: string | null; // latest arrivalAt, ISO +03:00
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
