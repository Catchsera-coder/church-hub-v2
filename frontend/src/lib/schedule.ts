// Frontend mirror of the backend Schedule model (backend/src/modules/scheduling
// /schedule.ts). Kept in sync by hand — same shape, same describe() wording.

export type ScheduleMode = 'once' | 'recurring';
export type ScheduleFrequency = 'daily' | 'weekly' | 'monthly';

export type Schedule = {
  mode: ScheduleMode;
  at?: string | null;
  frequency?: ScheduleFrequency;
  time?: string;             // 'HH:MM'
  daysOfWeek?: number[];     // 0=Sun … 6=Sat
  dayOfMonth?: number;       // 1..31
  startDate?: string | null; // 'YYYY-MM-DD'
  endDate?: string | null;   // 'YYYY-MM-DD'
  quietStart?: string;       // 'HH:MM' — never send inside quiet hours
  quietEnd?: string;         // 'HH:MM'
};

export const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** A ready-to-edit recurring schedule with sensible defaults. */
export function defaultSchedule(): Schedule {
  return { mode: 'recurring', frequency: 'daily', time: '09:00', daysOfWeek: [0], dayOfMonth: 1 };
}

/** Plain-English summary (mirrors the backend describeSchedule). */
export function describeSchedule(s: Schedule | null | undefined): string {
  if (!s) return 'Not scheduled';
  if (s.mode === 'once') return s.at ? `Once on ${new Date(s.at).toLocaleString()}` : 'Once';
  const time = s.time || '09:00';
  const freq = s.frequency ?? 'daily';
  if (freq === 'daily') return `Every day at ${time}`;
  if (freq === 'weekly') {
    const days = (s.daysOfWeek?.length ? s.daysOfWeek : [0]).map((d) => DOW_LABELS[d]).join(', ');
    return `Weekly on ${days} at ${time}`;
  }
  return `Monthly on day ${s.dayOfMonth ?? 1} at ${time}`;
}
