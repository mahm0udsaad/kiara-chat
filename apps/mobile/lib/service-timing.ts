export type ServiceStartTiming = {
  scheduledAt: string;
  startedAt: string | null;
  minutes: number;
  state: "upcoming" | "waiting" | "on_time" | "early" | "late";
};

/**
 * Compare the booked appointment with the specialist's own start-service tap.
 * Before she taps, the value remains live; afterwards it is frozen to the
 * recorded timestamp so later report views never rewrite history.
 */
export function serviceStartTimingOf(
  scheduledAt: string,
  startedAt: string | null | undefined,
  now = new Date(),
): ServiceStartTiming | null {
  const scheduledMs = Date.parse(scheduledAt);
  const startedMs = startedAt ? Date.parse(startedAt) : NaN;
  if (!Number.isFinite(scheduledMs)) return null;

  if (Number.isFinite(startedMs)) {
    const minutes = Math.round((startedMs - scheduledMs) / 60_000);
    return {
      scheduledAt,
      startedAt: startedAt ?? null,
      minutes: Math.abs(minutes),
      state: minutes > 0 ? "late" : minutes < 0 ? "early" : "on_time",
    };
  }

  const minutes = Math.round((now.getTime() - scheduledMs) / 60_000);
  return {
    scheduledAt,
    startedAt: null,
    minutes: Math.abs(minutes),
    state: minutes > 0 ? "waiting" : "upcoming",
  };
}

