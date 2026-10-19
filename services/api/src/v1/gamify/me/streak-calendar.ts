import { StreakState, daysBetween } from '../streaks/streak-fold';

export type CalendarDayState = 'done' | 'frozen' | 'missed' | 'today';

export interface CalendarDay {
  date: string;
  state: CalendarDayState;
}

export interface StreakDayRecord {
  date: string;
  streakCount: number;
}

export type StreakStatus = 'NONE' | 'DONE_TODAY' | 'AT_RISK' | 'SAVED_BY_FREEZE' | 'BROKEN';

export const shiftDate = (date: string, days: number): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

const coveredDays = (records: ReadonlyArray<StreakDayRecord>): Set<string> => {
  const covered = new Set<string>();
  const ordered = [...records].sort((a, b) => a.date.localeCompare(b.date));
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const next = ordered[index];
    const gap = daysBetween(previous.date, next.date);
    if (gap > 1 && next.streakCount === previous.streakCount + 1) {
      for (let n = 1; n < gap; n += 1) covered.add(shiftDate(previous.date, n));
    }
  }
  return covered;
};

export const streakCalendar = (records: ReadonlyArray<StreakDayRecord>, today: string, length = 7): CalendarDay[] => {
  const done = new Set(records.map((record) => record.date));
  const frozen = coveredDays(records);
  return Array.from({ length }, (_, n) => {
    const date = shiftDate(today, n - (length - 1));
    if (done.has(date)) return { date, state: 'done' as const };
    if (frozen.has(date)) return { date, state: 'frozen' as const };
    return { date, state: date === today ? ('today' as const) : ('missed' as const) };
  });
};

export const streakStatus = (state: Pick<StreakState, 'current' | 'freezes' | 'lastDate'>, today: string): StreakStatus => {
  if (state.lastDate === null || state.current === 0) return 'NONE';
  const gap = daysBetween(state.lastDate, today);
  if (gap <= 0) return 'DONE_TODAY';
  if (gap === 1) return 'AT_RISK';
  return state.freezes >= gap - 1 ? 'SAVED_BY_FREEZE' : 'BROKEN';
};
