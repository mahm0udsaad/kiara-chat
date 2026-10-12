import { describe, expect, mock, test } from "bun:test";

// The parser is pure; the module's storage imports are not needed to test it.
mock.module("@/lib/supabase/admin", () => ({ getAdminSupabaseClient: () => null }));
mock.module("@/lib/tenant", () => ({ KIARA_RESTAURANT_ID: "tenant" }));

const { parseDiagnosticDevice, parseDiagnosticEvents } = await import(
  "../src/lib/mobile-diagnostics.ts"
);

const now = Date.parse("2026-10-12T12:00:00Z");

describe("mobile diagnostics parsing", () => {
  test("keeps a well-formed event", () => {
    expect(
      parseDiagnosticEvents(
        [{
          kind: "render_error",
          message: " Cannot read property 'x' of undefined ",
          stack: "at Bubble",
          route: "(app)/conversation/[id]",
          at: "2026-10-12T11:59:00.000Z",
          details: { attempt: 1 },
        }],
        now,
      ),
    ).toEqual([{
      kind: "render_error",
      message: "Cannot read property 'x' of undefined",
      stack: "at Bubble",
      route: "(app)/conversation/[id]",
      details: { attempt: 1 },
      occurredAt: "2026-10-12T11:59:00.000Z",
    }]);
  });

  test("drops unknown kinds and anything that is not an event", () => {
    expect(parseDiagnosticEvents([{ kind: "made_up" }, null, "text", 4], now)).toEqual([]);
    expect(parseDiagnosticEvents("not a list", now)).toEqual([]);
  });

  test("cuts long text and oversized details", () => {
    const [event] = parseDiagnosticEvents(
      [{
        kind: "fatal_js",
        message: "m".repeat(2_000),
        stack: "s".repeat(10_000),
        details: { blob: "d".repeat(20_000) },
      }],
      now,
    );
    expect(event.message).toHaveLength(500);
    expect(event.stack).toHaveLength(4_000);
    expect(event.details).toEqual({ dropped: "too_large" });
  });

  test("replaces a time the phone cannot have seen", () => {
    const [future, ancient, missing] = parseDiagnosticEvents(
      [
        { kind: "stall", at: "2030-01-01T00:00:00Z" },
        { kind: "stall", at: "2020-01-01T00:00:00Z" },
        { kind: "stall" },
      ],
      now,
    );
    for (const event of [future, ancient, missing]) {
      expect(event.occurredAt).toBe("2026-10-12T12:00:00.000Z");
    }
  });

  test("caps one batch", () => {
    const many = Array.from({ length: 200 }, () => ({ kind: "stall" }));
    expect(parseDiagnosticEvents(many, now)).toHaveLength(40);
  });

  test("reads the device, ignoring anything that is not text", () => {
    expect(
      parseDiagnosticDevice({ platform: "android", osVersion: 14, deviceModel: "SM-A155F" }),
    ).toEqual({
      platform: "android",
      osVersion: null,
      deviceModel: "SM-A155F",
      appVersion: null,
      updateId: null,
    });
  });
});
