import { describe, expect, test } from "bun:test";

import { statusesReplaceableBy } from "../src/lib/delivery-status.ts";

const allows = (from, to) => statusesReplaceableBy(to)?.includes(from) ?? true;

describe("delivery marks only move forward", () => {
  test("the normal path advances", () => {
    expect(allows("queued", "sent")).toBe(true);
    expect(allows("sent", "delivered")).toBe(true);
    expect(allows("delivered", "read")).toBe(true);
    expect(allows("sent", "read")).toBe(true);
  });

  test("a late report never walks a mark back", () => {
    // The linked device's own phone reports "sent" long after she read it.
    expect(allows("read", "sent")).toBe(false);
    expect(allows("delivered", "sent")).toBe(false);
    expect(allows("read", "delivered")).toBe(false);
  });

  test("repeating a mark changes nothing", () => {
    for (const status of ["sent", "delivered", "read"]) {
      expect(allows(status, status)).toBe(false);
    }
  });

  test("a failure replaces sent but not proof of arrival", () => {
    expect(allows("sent", "failed")).toBe(true);
    expect(allows("queued", "undelivered")).toBe(true);
    expect(allows("delivered", "failed")).toBe(false);
    expect(allows("read", "failed")).toBe(false);
  });

  test("proof of arrival replaces a recorded failure", () => {
    expect(allows("failed", "delivered")).toBe(true);
    expect(allows("undelivered", "read")).toBe(true);
    // A stale "sent" does not undo a failure the provider reported.
    expect(allows("failed", "sent")).toBe(false);
  });

  test("an inbound message's own state is never overwritten by a receipt", () => {
    for (const status of ["sent", "delivered", "read", "failed"]) {
      expect(allows("received", status)).toBe(false);
    }
  });

  test("an unknown report is applied as it comes", () => {
    expect(statusesReplaceableBy("accepted")).toBeNull();
  });
});
