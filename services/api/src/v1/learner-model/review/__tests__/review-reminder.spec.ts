import {
  REMINDER_ACTIVE_DAYS,
  REMINDER_PAUSE_DAYS,
  REMINDER_TITLE,
  activeSince,
  jakartaDay,
  pausedSince,
  reminderCopy,
  reminderKey,
} from '../review-reminder';

const DAY_MS = 24 * 60 * 60 * 1000;
const entry = (title: string) => ({ conceptId: title, title }) as never;
const view = (titles: string[], overrides: { dueTotal?: number; totalQuestions?: number; estimatedMinutes?: number } = {}) =>
  ({
    dueTotal: overrides.dueTotal ?? titles.length,
    due: titles.map(entry),
    session: { totalQuestions: overrides.totalQuestions ?? 6, estimatedMinutes: overrides.estimatedMinutes ?? 4 },
  }) as never;

describe('review reminder day and key', () => {
  it('uses the calendar day in Jakarta, so 18.00 and 23.30 there are the same day but 00.30 is the next one', () => {
    expect(jakartaDay(new Date('2026-10-16T11:00:00.000Z'))).toBe('2026-10-16');
    expect(jakartaDay(new Date('2026-10-16T16:30:00.000Z'))).toBe('2026-10-16');
    expect(jakartaDay(new Date('2026-10-16T17:30:00.000Z'))).toBe('2026-10-17');
  });

  it('makes one key per learner and day so a retried job cannot send twice', () => {
    const now = new Date('2026-10-16T11:00:00.000Z');
    expect(reminderKey('u1', now)).toBe('review-reminder:u1:2026-10-16');
    expect(reminderKey('u1', new Date(now.getTime() + 60_000))).toBe(reminderKey('u1', now));
    expect(reminderKey('u2', now)).not.toBe(reminderKey('u1', now));
    expect(reminderKey('u1', new Date(now.getTime() + DAY_MS))).not.toBe(reminderKey('u1', now));
  });

  it('looks 30 days back for active learners and 3 days back for a reminder that is still unread', () => {
    const now = new Date('2026-10-16T11:00:00.000Z');
    expect(now.getTime() - activeSince(now).getTime()).toBe(REMINDER_ACTIVE_DAYS * DAY_MS);
    expect(now.getTime() - pausedSince(now).getTime()).toBe(REMINDER_PAUSE_DAYS * DAY_MS);
    expect([REMINDER_ACTIVE_DAYS, REMINDER_PAUSE_DAYS]).toEqual([30, 3]);
  });
});

describe('reminderCopy', () => {
  it('sends nothing when nothing is due', () => {
    expect(reminderCopy(view([], { dueTotal: 0 }))).toBeNull();
  });

  it('names the one concept that is fading and the length of the session', () => {
    expect(reminderCopy(view(['Debit dan kredit']))).toEqual({
      title: REMINDER_TITLE,
      body: 'Konsep Debit dan kredit mulai terlupa. Ulasan singkat sekitar 4 menit.',
    });
  });

  it('names both concepts when two are due', () => {
    expect(reminderCopy(view(['A', 'B']))!.body).toBe('2 konsep mulai terlupa: A dan B. Ulasan singkat sekitar 4 menit.');
  });

  it('counts all due concepts but names only the first two', () => {
    expect(reminderCopy(view(['A', 'B', 'C'], { dueTotal: 9 }))!.body).toBe('9 konsep mulai terlupa, antara lain A dan B. Ulasan singkat sekitar 4 menit.');
  });

  it('leaves out the session length when no concept has a step to open', () => {
    expect(reminderCopy(view(['A'], { totalQuestions: 0, estimatedMinutes: 0 }))!.body).toBe('Konsep A mulai terlupa.');
  });

  it('never promises less than one minute', () => {
    expect(reminderCopy(view(['A'], { estimatedMinutes: 0.2 }))!.body).toContain('sekitar 1 menit');
  });
});
