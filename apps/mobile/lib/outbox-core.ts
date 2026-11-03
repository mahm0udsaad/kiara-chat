/**
 * The rules of the chat outbox, kept free of React Native so they can be tested.
 *
 * A typed reply goes into the outbox the moment she taps send and stays in the
 * thread as her own bubble until the server's copy of it shows up. If the send
 * fails it stays, red, with a retry button. Before this, a send that failed
 * on the phone left only an error line under the typing box. Leaving the chat
 * threw the text away, so a message she believed was sent simply vanished.
 *
 * Retrying reuses the entry's key, which the server stores as the message's
 * client_request_id. A retry of a send that did reach the server returns the
 * existing message instead of sending it twice.
 */

export type OutboxState = "sending" | "sent" | "failed";

export type OutboxEntry = {
  /** Also the idempotency key the server deduplicates on. */
  key: string;
  conversationId: string;
  text: string;
  replyToMessageId?: string;
  createdAt: string;
  state: OutboxState;
  /** Set once the server has accepted it. */
  messageId?: string;
  /** Why the last attempt failed, in words she can act on. */
  error?: string;
};

/** A sent entry stops being drawn once the thread has it, or after this long. */
export const SENT_GRACE_MS = 2 * 60_000;
/** Failed sends nobody retried or discarded are forgotten after a week. */
export const FAILED_KEEP_MS = 7 * 24 * 60 * 60_000;

/** What reopening the app means for entries saved before it closed. */
export const INTERRUPTED_ERROR = "انقطع الإرسال قبل أن يكتمل";

/**
 * Entries read back from disk. A send still marked "sending" was cut off when
 * the app closed. It may or may not have reached the server, so it is shown as
 * failed: retrying is safe either way.
 */
export function restoreEntries(stored: unknown, now: number): OutboxEntry[] {
  if (!Array.isArray(stored)) return [];
  return prune(
    stored.filter(isEntry).map((entry) =>
      entry.state === "sending" ? { ...entry, state: "failed", error: INTERRUPTED_ERROR } : entry,
    ),
    now,
  );
}

/** Drops what no longer needs keeping. */
export function prune(entries: OutboxEntry[], now: number): OutboxEntry[] {
  return entries.filter((entry) => {
    const age = now - Date.parse(entry.createdAt);
    if (!Number.isFinite(age)) return false;
    if (entry.state === "sent") return age < SENT_GRACE_MS;
    if (entry.state === "failed") return age < FAILED_KEEP_MS;
    return true;
  });
}

/**
 * The entries to draw in one thread, oldest first. A sent entry stays drawn
 * until the thread's own copy arrives, so the bubble never blinks out between
 * the server saying yes and the thread refetching.
 */
export function visibleEntries(
  entries: OutboxEntry[],
  conversationId: string,
  threadMessageIds: ReadonlySet<string>,
): OutboxEntry[] {
  return entries
    .filter((entry) => entry.conversationId === conversationId)
    .filter((entry) => !(entry.messageId && threadMessageIds.has(entry.messageId)))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function isEntry(value: unknown): value is OutboxEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.key === "string" &&
    typeof entry.conversationId === "string" &&
    typeof entry.text === "string" &&
    typeof entry.createdAt === "string" &&
    (entry.state === "sending" || entry.state === "sent" || entry.state === "failed")
  );
}
