/** Pure scheduling rules shared by preview generation and regression tests. */
export function planServiceChange(input: {
  arrivalAt: string;
  durationMinutes: number;
  serviceStartedAt: string | null;
  minutes: number;
  previousMinutes?: number;
  previousStartsAt?: string;
  requestedStart?: string;
  now: string;
}) {
  const arrival = Date.parse(input.arrivalAt);
  const actualStart = input.serviceStartedAt
    ? Date.parse(input.serviceStartedAt)
    : arrival;
  const oldEnd = actualStart + input.durationMinutes * 60_000;
  if (
    !Number.isInteger(input.minutes) ||
    input.minutes < 1 ||
    input.minutes > 480
  )
    throw new Error("مدة الخدمة يجب أن تكون بين ١ و٤٨٠ دقيقة.");
  let startsAt: number;
  let end: number;
  if (input.previousMinutes !== undefined) {
    startsAt = Date.parse(input.requestedStart ?? input.arrivalAt);
    const delay = input.previousStartsAt
      ? Math.max(0, startsAt - Date.parse(input.previousStartsAt))
      : 0;
    end = oldEnd + (input.minutes - input.previousMinutes) * 60_000 + delay;
  } else {
    startsAt = Math.max(
      oldEnd,
      Date.parse(input.now),
      input.requestedStart ? Date.parse(input.requestedStart) : oldEnd,
    );
    end = startsAt + input.minutes * 60_000;
  }
  const durationMinutes = Math.ceil((end - actualStart) / 60_000);
  if (
    ![arrival, actualStart, startsAt, end].every(Number.isFinite) ||
    durationMinutes < 5 ||
    durationMinutes > 480
  )
    throw new Error("مدة الزيارة بعد التعديل يجب ألا تتجاوز ٨ ساعات.");
  return {
    startsAt: new Date(startsAt).toISOString(),
    oldEnd: new Date(oldEnd).toISOString(),
    newEnd: new Date(actualStart + durationMinutes * 60_000).toISOString(),
    durationMinutes,
    extensionMinutes: durationMinutes - input.durationMinutes,
  };
}

export function serviceFingerprint(payload: Record<string, unknown>) {
  return JSON.stringify([
    payload.service,
    payload.durationMinutes,
    payload.arrivalAt,
    payload.quantity,
    payload.providers,
    payload.location,
    payload.status,
  ]);
}
