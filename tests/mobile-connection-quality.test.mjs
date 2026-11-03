import { describe, expect, test } from "bun:test";

import { ConnectionQualityTracker } from "../apps/mobile/lib/connection-quality.ts";

const at = (seconds) => 1_000_000 + seconds * 1_000;

describe("connection quality from the app's own requests", () => {
  test("normal answers stay good, and one slow request is not a warning", () => {
    const t = new ConnectionQualityTracker();
    expect(t.record(300, "ok", at(0))).toBe("good");
    expect(t.record(6_000, "ok", at(5))).toBe("good");
    expect(t.record(400, "ok", at(10))).toBe("good");
  });

  test("three slow answers out of five read as slow (وفاء on 2 Nov: 5-11 s)", () => {
    const t = new ConnectionQualityTracker();
    t.record(5_300, "ok", at(0));
    t.record(900, "ok", at(2));
    t.record(7_100, "ok", at(4));
    expect(t.record(11_200, "ok", at(6))).toBe("slow");
  });

  test("two timeouts read as slow", () => {
    const t = new ConnectionQualityTracker();
    t.record(10_000, "timeout", at(0));
    expect(t.record(10_000, "timeout", at(12))).toBe("slow");
  });

  test("requests failing before reaching the server read as offline", () => {
    const t = new ConnectionQualityTracker();
    t.record(40, "network", at(0));
    expect(t.record(45, "network", at(1))).toBe("offline");
  });

  test("a server error is not a network failure", () => {
    const t = new ConnectionQualityTracker();
    t.record(200, "http_error", at(0));
    expect(t.record(200, "http_error", at(1))).toBe("good");
  });

  test("the warning holds through one quick answer and clears after two", () => {
    const t = new ConnectionQualityTracker();
    t.record(6_000, "ok", at(0));
    t.record(6_000, "ok", at(1));
    expect(t.record(6_000, "ok", at(2))).toBe("slow");
    expect(t.record(500, "ok", at(3))).toBe("slow");
    expect(t.record(600, "ok", at(4))).toBe("good");
  });

  test("an idle phone drifts back to good once old samples expire", () => {
    const t = new ConnectionQualityTracker();
    t.record(40, "network", at(0));
    expect(t.record(40, "network", at(1))).toBe("offline");
    expect(t.evaluate(at(120))).toBe("good");
  });
});
