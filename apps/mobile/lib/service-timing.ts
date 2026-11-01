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


export type ServiceEndTiming = {
  startedAt: string;
  expectedEndAt: string;
  completedAt: string | null;
  durationMinutes: number;
  minutes: number;
  state: "running" | "overdue" | "on_time" | "early" | "late";
};

/**
 * From her start tap she has the booked services' durations, added up — two
 * one-hour services give her two hours. Her finish tap is judged against that
 * moment; until she taps it the value stays live. Mirrors the server's
 * `serviceTimingOf`, which the reports use.
 */
export function serviceEndTimingOf(
  startedAt: string | null | undefined,
  durationMinutes: number | null | undefined,
  completedAt: string | null | undefined,
  now = new Date(),
): ServiceEndTiming | null {
  const startedMs = startedAt ? Date.parse(startedAt) : NaN;
  const duration = Math.max(Number(durationMinutes) || 0, 0);
  if (!startedAt || !Number.isFinite(startedMs) || !duration) return null;
  const expectedEndMs = startedMs + duration * 60_000;
  const base = {
    startedAt,
    expectedEndAt: new Date(expectedEndMs).toISOString(),
    durationMinutes: duration,
  };

  const completedMs = completedAt ? Date.parse(completedAt) : NaN;
  if (Number.isFinite(completedMs)) {
    const minutes = Math.trunc((completedMs - expectedEndMs) / 60_000);
    return {
      ...base,
      completedAt: completedAt ?? null,
      minutes: Math.abs(minutes),
      state: minutes > 0 ? "late" : minutes < 0 ? "early" : "on_time",
    };
  }

  const minutes = Math.round((now.getTime() - expectedEndMs) / 60_000);
  return {
    ...base,
    completedAt: null,
    minutes: Math.abs(minutes),
    state: minutes > 0 ? "overdue" : "running",
  };
}

/**
 * The visit's service time: its approved services added up, else the order's
 * own duration. The services win because the order's figure goes stale when a
 * service is added or swapped in Rekaz — the same total the reports judge by.
 */
export function totalServiceMinutes(
  services: readonly { minutes: number }[] | null | undefined,
  fallbackMinutes: number | null | undefined,
): number {
  const summed = (services ?? []).reduce((sum, service) => sum + Math.max(Number(service.minutes) || 0, 0), 0);
  return summed > 0 ? summed : Math.max(Number(fallbackMinutes) || 0, 0);
}
