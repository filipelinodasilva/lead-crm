// Pacing rules for mass sending: when the campaign may send, how many
// messages per day (with a warm-up ramp) and the random gap between sends.

export interface SendWindow {
  /** Minutes after local midnight, e.g. 540 = 09:00. */
  startMin: number;
  /** Exclusive end, e.g. 1080 = 18:00. */
  endMin: number;
  /** ISO weekdays, 1 = Monday ... 7 = Sunday. */
  days: number[];
  timezone: string;
}

export interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 1 = Monday ... 7 = Sunday */
  weekday: number;
}

const WEEKDAYS: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

export function localParts(date: Date, timezone: string): LocalParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    weekday: 'short',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')) % 24,
    minute: Number(get('minute')),
    second: Number(get('second')),
    weekday: WEEKDAYS[get('weekday')] ?? 1,
  };
}

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export function isInWindow(now: Date, w: SendWindow): boolean {
  const p = localParts(now, w.timezone);
  const minutes = p.hour * 60 + p.minute;
  return (
    w.days.includes(p.weekday) && minutes >= w.startMin && minutes < w.endMin
  );
}

/** The instant (UTC) at which the local day of `now` began. */
export function localDayStart(now: Date, timezone: string): Date {
  const p = localParts(now, timezone);
  const localAsUtc = Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour,
    p.minute,
    p.second
  );
  const offsetMs = localAsUtc - Math.floor(now.getTime() / 1000) * 1000;
  return new Date(Date.UTC(p.year, p.month - 1, p.day) - offsetMs);
}

export const WARMUP_START = 10;
export const WARMUP_STEP = 5;

/**
 * Messages allowed today. With warm-up the number grows from 10 on the first
 * day by 5 per day until it reaches the owner's limit, which is how a number
 * that never sent in bulk avoids looking like a bot on day one.
 */
export function effectiveDailyCap(
  limit: number,
  warmup: boolean,
  startedAt: Date | null,
  now: Date,
  timezone: string
): number {
  if (!warmup || !startedAt) return limit;
  const days = Math.max(
    0,
    Math.round(
      (localDayStart(now, timezone).getTime() -
        localDayStart(startedAt, timezone).getTime()) /
        86_400_000
    )
  );
  return Math.min(limit, WARMUP_START + WARMUP_STEP * days);
}

/** Random wait (ms) between two sends, uniform in [minS, maxS]. */
export function nextDelayMs(
  minS: number,
  maxS: number,
  rng: () => number = Math.random
): number {
  return Math.round((minS + rng() * Math.max(0, maxS - minS)) * 1000);
}

export function minutesToHHMM(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

export function hhmmToMinutes(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  return h <= 24 && mm < 60 && h * 60 + mm <= 1440 ? h * 60 + mm : null;
}
