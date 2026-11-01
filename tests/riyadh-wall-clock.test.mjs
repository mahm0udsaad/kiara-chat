import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, test } from "bun:test";

// Staff edit orders from phones and laptops set to Cairo time. Since Egypt left
// summer time (30 Oct 2026) Cairo is UTC+2 while Riyadh stays UTC+3, so any
// order time read or built in the device's zone lands an hour off.
process.env.TZ = "Africa/Cairo";

let format;
let riyadh;
let webTime;

beforeAll(async () => {
  format = await import("../apps/mobile/lib/format.ts");
  riyadh = await import("../apps/mobile/lib/riyadh-time.ts");
  webTime = await import("../src/lib/riyadh-time.ts");
});

// The real order (customer مريم الحصين): Rekaz had the visit at 23:00 Riyadh.
const elevenPmRiyadh = "2026-11-01T20:00:00.000Z";

describe("a Cairo-zoned device in Egyptian winter time", () => {
  test("the emulated device really is an hour behind Riyadh", () => {
    expect(new Date(elevenPmRiyadh).getHours()).toBe(22);
  });

  test("mobile shows the visit at its Riyadh time, not an hour early", () => {
    expect(format.formatters.time.format(new Date(elevenPmRiyadh))).toBe("11:00 PM");
  });

  test("mobile counts days on the Riyadh calendar", () => {
    // 00:30 Riyadh on 2 Nov is still 23:30 on 1 Nov in Cairo.
    const now = new Date("2026-11-01T19:00:00Z");
    expect(format.dayOffset("2026-11-01T21:30:00Z", now)).toBe(1);
    expect(format.relativeDayLabel("2026-11-01T21:30:00Z", now)).toBe("غدًا");
  });

  test("the booking default keeps the working day in Riyadh hours", () => {
    // 22:45 Riyadh: an hour on is past 22:00, so tomorrow 08:00 Riyadh.
    expect(riyadh.roundedBookingDefault(new Date("2026-11-01T19:45:00Z")).toISOString()).toBe(
      "2026-11-02T05:00:00.000Z",
    );
    // 13:10 Riyadh: an hour on, rounded up to the half hour.
    expect(riyadh.roundedBookingDefault(new Date("2026-11-01T10:10:00Z")).toISOString()).toBe(
      "2026-11-01T11:30:00.000Z",
    );
    // 04:00 Riyadh: too early, so 08:00 the same Riyadh day.
    expect(riyadh.roundedBookingDefault(new Date("2026-11-01T01:00:00Z")).toISOString()).toBe(
      "2026-11-01T05:00:00.000Z",
    );
  });

  test("web edit form fills and reads its date and time boxes in Riyadh time", () => {
    expect(webTime.riyadhDateInput(new Date(elevenPmRiyadh))).toBe("2026-11-01");
    expect(webTime.riyadhTimeInput(new Date(elevenPmRiyadh))).toBe("23:00");
    // Staff type 11 PM for the customer: that is 20:00Z, not 21:00Z.
    expect(webTime.riyadhInputsToIso("2026-11-01", "23:00")).toBe(elevenPmRiyadh);
    expect(webTime.riyadhInputsToIso("2026-11-02", "00:30")).toBe("2026-11-01T21:30:00.000Z");
    expect(webTime.riyadhInputsToIso("", "23:00")).toBeNull();
  });

  test("web create-order sheet seeds and saves the Riyadh wall clock", () => {
    const seeded = webTime.riyadhWallClock(new Date(elevenPmRiyadh));
    expect(seeded.getHours()).toBe(23);
    expect(webTime.localDateKey(seeded)).toBe("2026-11-01");
    expect(webTime.riyadhInputsToIso(webTime.localDateKey(seeded), "23:00")).toBe(elevenPmRiyadh);
  });

  test("mobile pickers that set an order's time are pinned to Riyadh", () => {
    for (const file of [
      "apps/mobile/app/(app)/(tabs)/orders/[id]/edit.tsx",
      "apps/mobile/components/inbox/booking-sheet.tsx",
    ]) {
      const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
      const pickers = source.match(/<DateTimePicker[\s\S]*?\/>/g) ?? [];
      expect(pickers.length).toBeGreaterThan(0);
      for (const picker of pickers) expect(picker).toContain("timeZoneName={RIYADH_TZ}");
    }
  });
});
