/**
 * Reusable scheduling model — shared by automations, campaigns, and any future
 * time-driven feature (stream-link sends, reminders). One `Schedule` shape and
 * one "is it due now?" evaluator, all computed in the church's own timezone so a
 * "9:00 AM Sunday" send fires at 9 AM local, not UTC.
 *
 * The pure evaluators use only Intl so the frontend can mirror the same
 * `Schedule` type and describe() text without drift; the Zod validator at the
 * bottom is backend-only.
 */
import { z } from 'zod';

export type ScheduleMode = 'once' | 'recurring';
export type ScheduleFrequency = 'daily' | 'weekly' | 'monthly';

export type Schedule = {
  mode: ScheduleMode;
  // one-time: an ISO datetime (UTC) to fire at, on/after which it runs once.
  at?: string | null;
  // recurring:
  frequency?: ScheduleFrequency;
  time?: string;             // 'HH:MM' 24h, interpreted in the org timezone
  daysOfWeek?: number[];     // 0=Sun … 6=Sat, for weekly
  dayOfMonth?: number;       // 1..31, for monthly (clamped to the month's length)
  startDate?: string | null; // 'YYYY-MM-DD' inclusive
  endDate?: string | null;   // 'YYYY-MM-DD' inclusive
};

type TzParts = { year: number; month: number; day: number; date: string; time: string; dow: number };

/** Current wall-clock parts of `now` in the given IANA timezone. */
export function partsInTz(now: Date, tz: string): TzParts {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz || 'UTC',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short',
    }).formatToParts(now);
  } catch {
    // Bad tz string → fall back to UTC so scheduling still works.
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short',
    }).formatToParts(now);
  }
  const get = (t: string) => parts.find((x) => x.type === t)?.value ?? '';
  const year = Number(get('year'));
  const month = Number(get('month'));
  const day = Number(get('day'));
  const hour = get('hour') === '24' ? '00' : get('hour'); // some engines emit 24 at midnight
  const time = `${hour}:${get('minute')}`;
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dow = dowMap[get('weekday')] ?? 0;
  return { year, month, day, date: `${get('year')}-${get('month')}-${get('day')}`, time, dow };
}

const daysInMonth = (year: number, month: number): number => new Date(Date.UTC(year, month, 0)).getUTCDate();

/**
 * Should a recurring schedule fire on this tick? True when today matches the
 * frequency (day-of-week / day-of-month), the local time has reached `time`, we
 * are within [startDate, endDate], and it hasn't already run today (`lastRunOn`
 * is the last calendar date it ran, per the church timezone).
 */
export function isRecurringDue(schedule: Schedule, lastRunOn: string | null, now: Date, tz: string): boolean {
  if (schedule.mode === 'once') return false;
  const p = partsInTz(now, tz);
  if (schedule.startDate && p.date < schedule.startDate) return false;
  if (schedule.endDate && p.date > schedule.endDate) return false;

  const freq = schedule.frequency ?? 'daily';
  if (freq === 'weekly') {
    const days = schedule.daysOfWeek?.length ? schedule.daysOfWeek : [0];
    if (!days.includes(p.dow)) return false;
  } else if (freq === 'monthly') {
    const target = Math.min(schedule.dayOfMonth ?? 1, daysInMonth(p.year, p.month));
    if (p.day !== target) return false;
  }

  if (p.time < (schedule.time || '09:00')) return false; // wait for the time-of-day
  if (lastRunOn === p.date) return false;                // once per due day
  return true;
}

/** Should a one-time schedule fire now? True on/after `at`, and not yet run. */
export function isOnceDue(schedule: Schedule, lastRunOn: string | null, now: Date): boolean {
  if (schedule.mode !== 'once' || !schedule.at) return false;
  if (lastRunOn) return false; // already fired
  const at = new Date(schedule.at);
  return !Number.isNaN(at.getTime()) && now.getTime() >= at.getTime();
}

/** Unified check used by workers. */
export function isDue(schedule: Schedule | null | undefined, lastRunOn: string | null, now: Date, tz: string): boolean {
  if (!schedule) return false;
  return schedule.mode === 'once' ? isOnceDue(schedule, lastRunOn, now) : isRecurringDue(schedule, lastRunOn, now, tz);
}

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Plain-English summary of a schedule for UI/logs (e.g. "Weekly on Sun at 09:00"). */
export function describeSchedule(schedule: Schedule | null | undefined): string {
  if (!schedule) return 'Not scheduled';
  if (schedule.mode === 'once') return schedule.at ? `Once on ${new Date(schedule.at).toLocaleString()}` : 'Once';
  const time = schedule.time || '09:00';
  const freq = schedule.frequency ?? 'daily';
  if (freq === 'daily') return `Every day at ${time}`;
  if (freq === 'weekly') {
    const days = (schedule.daysOfWeek?.length ? schedule.daysOfWeek : [0]).map((d) => DOW_LABELS[d]).join(', ');
    return `Weekly on ${days} at ${time}`;
  }
  return `Monthly on day ${schedule.dayOfMonth ?? 1} at ${time}`;
}

/** A sensible default schedule for an automation type (preserves legacy cadence). */
export function defaultAutomationSchedule(type: string): Schedule {
  if (type === 'absence_followup') return { mode: 'recurring', frequency: 'weekly', daysOfWeek: [1], time: '09:00' };
  return { mode: 'recurring', frequency: 'daily', time: '08:00' };
}

// Reusable request validator (automations, campaigns, and future schedulers).
export const scheduleZod = z.object({
  mode: z.enum(['once', 'recurring']),
  at: z.string().nullable().optional(),
  frequency: z.enum(['daily', 'weekly', 'monthly']).optional(),
  time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  dayOfMonth: z.number().int().min(1).max(31).optional(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
});
