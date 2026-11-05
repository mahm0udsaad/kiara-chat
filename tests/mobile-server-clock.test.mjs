import { describe, expect, test } from "bun:test";

import {
  isClockSkewed,
  medianOffset,
  offsetFromResponse,
  recordServerDate,
  serverNow,
} from "../apps/mobile/lib/server-clock.ts";

const server = Date.parse("2026-11-05T07:34:46Z");
const header = new Date(server).toUTCString();

describe("phone clock measured against the server", () => {
  test("a correct clock reads as about zero offset", () => {
    const offset = offsetFromResponse(header, server - 200, server + 200);
    expect(Math.abs(offset)).toBeLessThan(1_000);
  });

  test("a phone an hour fast reads as minus one hour (وفاء, Nov 2026)", () => {
    const hour = 3_600_000;
    const offset = offsetFromResponse(header, server + hour - 150, server + hour + 150);
    expect(Math.round(offset / 60_000)).toBe(-60);
  });

  test("a missing or broken Date header gives no reading", () => {
    expect(offsetFromResponse(null, 0, 0)).toBeNull();
    expect(offsetFromResponse("not a date", 0, 0)).toBeNull();
  });

  test("one slow response cannot swing the median", () => {
    expect(medianOffset([-3_600_000, -3_600_500, 40_000, -3_599_800, -3_600_200])).toBe(-3_600_000);
  });

  test("after a few fast-clock responses, expiry is judged on server time", () => {
    const hourFast = Date.now() + 3_600_000;
    const date = new Date(Date.now()).toUTCString();
    for (let i = 0; i < 5; i += 1) recordServerDate(date, hourFast, hourFast);
    expect(isClockSkewed()).toBe(true);
    // A token valid for another 59 minutes on the server is still valid here.
    const expiresAtMs = Date.now() + 59 * 60_000;
    expect(expiresAtMs > serverNow() + 5_000).toBe(true);
    expect(expiresAtMs > hourFast).toBe(false);
  });
});
