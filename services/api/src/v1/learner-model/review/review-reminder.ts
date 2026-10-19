import { ReviewView } from './review.service';

export const REVIEW_REMINDER_QUEUE = 'review-reminders';
export const REVIEW_REMINDER_CRON = '0 18 * * *';
export const REMINDER_ACTIVE_DAYS = 30;
export const REMINDER_PAUSE_DAYS = 3;
export const REMINDER_BATCH = 200;
export const REMINDER_TITLE = 'Waktunya mengulang';
const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const jakartaDay = (now: Date): string => new Date(now.getTime() + JAKARTA_OFFSET_MS).toISOString().slice(0, 10);

export const reminderKey = (userId: string, now: Date): string => `review-reminder:${userId}:${jakartaDay(now)}`;

export const activeSince = (now: Date): Date => new Date(now.getTime() - REMINDER_ACTIVE_DAYS * DAY_MS);

export const pausedSince = (now: Date): Date => new Date(now.getTime() - REMINDER_PAUSE_DAYS * DAY_MS);

type ReminderView = Pick<ReviewView, 'dueTotal' | 'due' | 'session'>;

export interface ReminderCopy {
  title: string;
  body: string;
}

export function reminderCopy(view: ReminderView): ReminderCopy | null {
  if (view.dueTotal <= 0 || view.due.length === 0) return null;
  const [first, second] = view.due;
  const lead =
    view.dueTotal === 1
      ? `Konsep ${first!.title} mulai terlupa.`
      : view.dueTotal === 2 || !second
        ? `${view.dueTotal} konsep mulai terlupa: ${first!.title}${second ? ` dan ${second.title}` : ''}.`
        : `${view.dueTotal} konsep mulai terlupa, antara lain ${first!.title} dan ${second.title}.`;
  const minutes = view.session.totalQuestions > 0 ? Math.max(1, Math.round(view.session.estimatedMinutes)) : 0;
  const body = minutes > 0 ? `${lead} Ulasan singkat sekitar ${minutes} menit.` : lead;
  return { title: REMINDER_TITLE, body };
}

export interface ReminderSweep {
  considered: number;
  sent: number;
  nothingDue: number;
  paused: number;
  duplicate: number;
  failed: number;
}

export const emptySweep = (): ReminderSweep => ({ considered: 0, sent: 0, nothingDue: 0, paused: 0, duplicate: 0, failed: 0 });
