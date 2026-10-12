/**
 * What went wrong on this phone, written down so someone can read it later.
 *
 * The app had no record of its own failures: a screen that threw, an interface
 * that froze and a request that took ten seconds all looked the same from the
 * outside — "the app is slow and crashes". This keeps a short list of exactly
 * those moments, with the screen they happened on, and `diagnostics-upload`
 * sends it to the server.
 *
 * Recorded:
 *   render_error     a screen threw while drawing (the "حدث خطأ غير متوقع" screen)
 *   fatal_js         an error outside rendering that takes the app down
 *   stall            the interface stopped responding for a second or more
 *   slow_request     a request that was slow, timed out or never connected
 *   request_summary  how long each endpoint took over the last stretch
 *   unclean_exit     the previous session ended while the app was on screen:
 *                    a native crash, or a freeze the employee force-closed
 *
 * Nothing here may throw, block a screen or wait on the network. Every entry
 * point swallows its own errors: a diagnostics bug must never become the next
 * crash it was meant to report.
 */
import Constants from "expo-constants";
import * as Device from "expo-device";
import { File, Paths } from "expo-file-system";
import * as Updates from "expo-updates";
import { AppState, Platform } from "react-native";

export type DiagnosticKind =
  | "render_error"
  | "fatal_js"
  | "stall"
  | "slow_request"
  | "request_summary"
  | "unclean_exit";

export type DiagnosticEvent = {
  kind: DiagnosticKind;
  message?: string;
  stack?: string;
  /** The route pattern, e.g. `(app)/conversation/[id]` — never an id or a phone. */
  route: string;
  at: string;
  details?: Record<string, unknown>;
};

const MAX_QUEUE = 40;
/** One session cannot fill the table with the same complaint. */
const SESSION_LIMITS: Record<DiagnosticKind, number> = {
  render_error: 10,
  fatal_js: 5,
  stall: 30,
  slow_request: 30,
  request_summary: 60,
  unclean_exit: 1,
};
/** The interface not answering for this long is a freeze someone felt. */
const STALL_MS = 1_000;
/** Longer than this is the phone having suspended the app, not a freeze. */
const SUSPENDED_MS = 5 * 60_000;
const SLOW_REQUEST_MS = 4_000;
const SUMMARY_EVERY_MS = 10 * 60_000;

const queue: DiagnosticEvent[] = [];
const recorded: Partial<Record<DiagnosticKind, number>> = {};
let route = "";
let started = false;

type Marker = { open: boolean; route: string; at: string; updateId: string | null };
type Stored = { marker?: Marker; pending?: DiagnosticEvent[] };

function storeFile() {
  return new File(Paths.document, "kiara-diagnostics.json");
}

function readStore(): Stored {
  try {
    const file = storeFile();
    if (!file.exists) return {};
    const parsed = JSON.parse(file.textSync()) as Stored;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(next: Stored) {
  try {
    const file = storeFile();
    if (!file.exists) file.create({ intermediates: true });
    file.write(JSON.stringify(next));
  } catch {
    // A phone that cannot write the marker simply reports less.
  }
}

let marker: Marker | undefined;
let pendingOnDisk: DiagnosticEvent[] = [];

function saveMarker(open: boolean) {
  marker = {
    open,
    route,
    at: new Date().toISOString(),
    updateId: Updates.updateId ?? null,
  };
  writeStore({ marker, pending: pendingOnDisk });
}

export function recordDiagnostic(event: Omit<DiagnosticEvent, "route" | "at"> & {
  route?: string;
  at?: string;
}) {
  try {
    const count = recorded[event.kind] ?? 0;
    if (count >= SESSION_LIMITS[event.kind]) return;
    recorded[event.kind] = count + 1;
    queue.push({
      kind: event.kind,
      message: event.message?.slice(0, 500),
      stack: event.stack?.slice(0, 4_000),
      route: event.route ?? route,
      at: event.at ?? new Date().toISOString(),
      details: event.details,
    });
    if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);
  } catch {
    // Never let the recorder be the failure.
  }
}

/**
 * Everything waiting to be sent; the caller puts it back if the send fails.
 * `closing` also folds in the request timings gathered so far, for the batch
 * sent as the app leaves the screen.
 */
export function takeDiagnostics(closing = false): DiagnosticEvent[] {
  flushRequestSummary(!closing);
  return queue.splice(0, queue.length);
}

export function returnDiagnostics(events: DiagnosticEvent[]) {
  queue.unshift(...events);
  if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);
}

/** The device and build, sent beside every batch. */
export function diagnosticsDevice() {
  return {
    platform: Platform.OS,
    osVersion: Device.osVersion ?? null,
    deviceModel: Device.modelName ?? null,
    appVersion: Constants.expoConfig?.version ?? null,
    updateId: Updates.updateId ?? null,
  };
}

/** Called on every navigation with the route pattern now on screen. */
export function setDiagnosticsRoute(next: string) {
  if (next === route) return;
  route = next;
  if (started && AppState.currentState === "active") saveMarker(true);
}

// ------------------------------------------------------------ request timing

type PathStats = { count: number; totalMs: number; maxMs: number; failed: number };
const requestStats = new Map<string, PathStats>();
let summaryStartedAt = Date.now();

/** `/orders/3f2c…/dispatch?x=1` → `/orders/:id/dispatch`. */
function pathPattern(path: string): string {
  return (path.split("?")[0] ?? "")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id")
    .replace(/\/\+?\d{6,}(?=\/|$)/g, "/:phone")
    .replace(/\/[A-Za-z0-9_-]{24,}(?=\/|$)/g, "/:token")
    .slice(0, 120);
}

export function recordRequestTiming(
  path: string,
  ms: number,
  outcome: "ok" | "http_error" | "timeout" | "network",
) {
  try {
    if (path.startsWith("/diagnostics")) return;
    const pattern = pathPattern(path);
    const stats = requestStats.get(pattern) ?? { count: 0, totalMs: 0, maxMs: 0, failed: 0 };
    stats.count += 1;
    stats.totalMs += ms;
    stats.maxMs = Math.max(stats.maxMs, ms);
    if (outcome !== "ok") stats.failed += 1;
    requestStats.set(pattern, stats);

    if (ms >= SLOW_REQUEST_MS || outcome === "timeout" || outcome === "network") {
      recordDiagnostic({
        kind: "slow_request",
        message: pattern,
        details: { ms: Math.round(ms), outcome },
      });
    }
    flushRequestSummary(true);
  } catch {
    // Timing is a bonus; the request itself has already been answered.
  }
}

function flushRequestSummary(onlyWhenDue: boolean) {
  if (!requestStats.size) return;
  if (onlyWhenDue && Date.now() - summaryStartedAt < SUMMARY_EVERY_MS) return;
  const paths = [...requestStats.entries()]
    .sort(([, a], [, b]) => b.totalMs - a.totalMs)
    .slice(0, 15)
    .map(([path, stats]) => ({
      path,
      count: stats.count,
      avgMs: Math.round(stats.totalMs / stats.count),
      maxMs: Math.round(stats.maxMs),
      failed: stats.failed,
    }));
  const seconds = Math.round((Date.now() - summaryStartedAt) / 1_000);
  requestStats.clear();
  summaryStartedAt = Date.now();
  recordDiagnostic({ kind: "request_summary", details: { seconds, paths } });
}

// ------------------------------------------------------------------- startup

type ErrorUtilsLike = {
  getGlobalHandler: () => (error: unknown, isFatal?: boolean) => void;
  setGlobalHandler: (handler: (error: unknown, isFatal?: boolean) => void) => void;
};

function installFatalHandler() {
  const errorUtils = (globalThis as { ErrorUtils?: ErrorUtilsLike }).ErrorUtils;
  if (!errorUtils) return;
  const previous = errorUtils.getGlobalHandler();
  errorUtils.setGlobalHandler((error, isFatal) => {
    try {
      const failure = error instanceof Error ? error : new Error(String(error));
      const event: DiagnosticEvent = {
        kind: "fatal_js",
        message: failure.message.slice(0, 500),
        stack: failure.stack?.slice(0, 4_000),
        route,
        at: new Date().toISOString(),
        details: { isFatal: isFatal === true },
      };
      // To disk first: a fatal error ends the process before anything is sent.
      pendingOnDisk = [...pendingOnDisk, event].slice(-5);
      writeStore({ marker, pending: pendingOnDisk });
    } catch {
      // Fall through to the handler that was already there.
    }
    previous(error, isFatal);
  });
}

function watchForStalls() {
  const TICK_MS = 500;
  let last = Date.now();
  // Armed only once a tick has run with the app on screen, so the gap a phone
  // leaves while the app is suspended is never read as a freeze.
  let armed = false;
  setInterval(() => {
    const now = Date.now();
    const gap = now - last - TICK_MS;
    last = now;
    const active = AppState.currentState === "active";
    if (armed && active && gap >= STALL_MS && gap < SUSPENDED_MS) {
      recordDiagnostic({ kind: "stall", details: { ms: Math.round(gap) } });
    }
    armed = active;
  }, TICK_MS);
  AppState.addEventListener("change", () => {
    armed = false;
    last = Date.now();
  });
}

/**
 * Starts recording. Safe to call more than once; only the first call counts.
 * Run it as early as the bundle allows so a failure during startup is caught.
 */
export function startDiagnostics() {
  if (started || Platform.OS === "web") return;
  started = true;
  try {
    const stored = readStore();
    pendingOnDisk = [];
    for (const event of stored.pending ?? []) queue.push(event);
    // The last session was still on screen when it ended, and nothing closed
    // it: the process died under the employee, or she killed a frozen app.
    if (stored.marker?.open) {
      recordDiagnostic({
        kind: "unclean_exit",
        route: stored.marker.route,
        at: stored.marker.at,
        details: {
          previousUpdateId: stored.marker.updateId,
          // A reload into a new update also ends a session this way.
          updateChanged: stored.marker.updateId !== (Updates.updateId ?? null),
        },
      });
    }
    saveMarker(AppState.currentState === "active");
    AppState.addEventListener("change", (state) => {
      // "inactive" counts as leaving: it is what iOS reports while the app
      // switcher is open, which is where a deliberate swipe-away happens.
      saveMarker(state === "active");
    });
    installFatalHandler();
    watchForStalls();
  } catch {
    // Recording is best effort from the first line.
  }
}
