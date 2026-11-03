import { describe, expect, test } from "bun:test";

import {
  FAILED_KEEP_MS,
  INTERRUPTED_ERROR,
  SENT_GRACE_MS,
  prune,
  restoreEntries,
  visibleEntries,
} from "../apps/mobile/lib/outbox-core.ts";

const NOW = Date.parse("2026-11-03T18:16:00Z");
const at = (msAgo) => new Date(NOW - msAgo).toISOString();
const entry = (over) => ({
  key: "k1",
  conversationId: "c1",
  text: "هلا حبيبتي تبغين نقدم معاد الحجز؟",
  createdAt: at(1_000),
  state: "sending",
  ...over,
});

describe("chat outbox", () => {
  test("a send cut off by the app closing comes back as failed, ready to retry", () => {
    const [restored] = restoreEntries([entry({ state: "sending" })], NOW);
    expect(restored.state).toBe("failed");
    expect(restored.error).toBe(INTERRUPTED_ERROR);
    expect(restored.key).toBe("k1"); // same key, so the server can deduplicate
  });

  test("a failed send stays for a week; a sent one only until its grace runs out", () => {
    const kept = prune(
      [
        entry({ key: "failed-new", state: "failed", createdAt: at(FAILED_KEEP_MS - 1) }),
        entry({ key: "failed-old", state: "failed", createdAt: at(FAILED_KEEP_MS + 1) }),
        entry({ key: "sent-new", state: "sent", createdAt: at(SENT_GRACE_MS - 1) }),
        entry({ key: "sent-old", state: "sent", createdAt: at(SENT_GRACE_MS + 1) }),
        entry({ key: "sending", state: "sending", createdAt: at(FAILED_KEEP_MS * 2) }),
      ],
      NOW,
    ).map((e) => e.key);
    expect(kept).toEqual(["failed-new", "sent-new", "sending"]);
  });

  test("an entry disappears once the thread has the server's copy, not before", () => {
    const sent = entry({ state: "sent", messageId: "m1" });
    expect(visibleEntries([sent], "c1", new Set())).toHaveLength(1);
    expect(visibleEntries([sent], "c1", new Set(["m1"]))).toHaveLength(0);
  });

  test("each thread sees only its own entries, oldest first", () => {
    const list = visibleEntries(
      [
        entry({ key: "b", createdAt: at(1_000) }),
        entry({ key: "other", conversationId: "c2" }),
        entry({ key: "a", createdAt: at(5_000), state: "failed" }),
      ],
      "c1",
      new Set(),
    );
    expect(list.map((e) => e.key)).toEqual(["a", "b"]);
  });

  test("a corrupt file reads as an empty outbox", () => {
    expect(restoreEntries("nonsense", NOW)).toEqual([]);
    expect(restoreEntries([{ key: 1 }, null], NOW)).toEqual([]);
  });
});
