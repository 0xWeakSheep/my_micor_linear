export interface ZonedDateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export type RecurringCadence = "daily" | "weekly" | "monthly";

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let current = formatterCache.get(timeZone);
  if (!current) {
    current = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    // Force validation here so invalid zones fail when a recurrence is processed.
    current.format(new Date(0));
    formatterCache.set(timeZone, current);
  }
  return current;
}

export function zonedParts(date: Date, timeZone: string): ZonedDateTimeParts {
  const values = new Map(
    formatter(timeZone)
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: values.get("year")!,
    month: values.get("month")!,
    day: values.get("day")!,
    hour: values.get("hour")!,
    minute: values.get("minute")!,
    second: values.get("second")!,
  };
}

function wallClockEpoch(parts: ZonedDateTimeParts): number {
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
}

/** Convert a local wall-clock value to UTC without requiring a timezone package. */
export function zonedPartsToDate(
  parts: ZonedDateTimeParts,
  timeZone: string,
): Date {
  const desiredEpoch = wallClockEpoch(parts);
  let candidateEpoch = desiredEpoch;
  const candidates: Array<{ epoch: number; wallEpoch: number }> = [];

  // Timezone offsets can change around DST. Re-evaluating converges for normal,
  // ambiguous, and skipped wall-clock values while preserving the requested time.
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const actual = zonedParts(new Date(candidateEpoch), timeZone);
    const actualWallEpoch = wallClockEpoch(actual);
    candidates.push({ epoch: candidateEpoch, wallEpoch: actualWallEpoch });
    const correction = desiredEpoch - actualWallEpoch;
    if (correction === 0) break;
    candidateEpoch += correction;
  }

  const exact = candidates.find((candidate) => candidate.wallEpoch === desiredEpoch);
  if (exact) return new Date(exact.epoch);

  // A spring-forward gap has no exact instant. Choose the closest valid local
  // time after the requested wall clock instead of oscillating around the gap.
  const nextValid = candidates
    .filter((candidate) => candidate.wallEpoch > desiredEpoch)
    .sort((left, right) => left.wallEpoch - right.wallEpoch)[0];
  return new Date(nextValid?.epoch ?? candidateEpoch);
}

function addCalendarDays(
  parts: ZonedDateTimeParts,
  days: number,
): ZonedDateTimeParts {
  const date = new Date(wallClockEpoch(parts));
  date.setUTCDate(date.getUTCDate() + days);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

function addCalendarMonths(
  parts: ZonedDateTimeParts,
  months: number,
): ZonedDateTimeParts {
  const monthIndex = parts.month - 1 + months;
  const year = parts.year + Math.floor(monthIndex / 12);
  const month = ((monthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return {
    year,
    month: month + 1,
    day: Math.min(parts.day, lastDay),
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

export function nextRecurringRun(
  scheduledAt: string,
  cadence: RecurringCadence,
  interval: number,
  timeZone: string,
): string {
  if (!Number.isInteger(interval) || interval < 1) {
    throw new Error("Recurring interval must be a positive integer.");
  }
  const scheduled = new Date(scheduledAt);
  if (Number.isNaN(scheduled.getTime())) {
    throw new Error("Recurring scheduled time is invalid.");
  }

  const current = zonedParts(scheduled, timeZone);
  const next =
    cadence === "monthly"
      ? addCalendarMonths(current, interval)
      : addCalendarDays(current, cadence === "weekly" ? interval * 7 : interval);
  return zonedPartsToDate(next, timeZone).toISOString();
}

export function dateInTimeZone(date: Date, timeZone: string): string {
  const parts = zonedParts(date, timeZone);
  return `${parts.year.toString().padStart(4, "0")}-${parts.month
    .toString()
    .padStart(2, "0")}-${parts.day.toString().padStart(2, "0")}`;
}

export function daysBetweenDates(from: string, to: string): number {
  const fromEpoch = Date.parse(`${from}T00:00:00.000Z`);
  const toEpoch = Date.parse(`${to}T00:00:00.000Z`);
  return Math.round((toEpoch - fromEpoch) / 86_400_000);
}
