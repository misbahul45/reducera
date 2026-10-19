import { streakCalendar, streakStatus } from '../streak-calendar';

const run = (dates: string[], firstCount = 1) => dates.map((date, index) => ({ date, streakCount: firstCount + index }));

const state = (overrides: Partial<{ current: number; longest: number; freezes: number; lastDate: string | null }> = {}) => ({
  current: 3,
  longest: 5,
  freezes: 0,
  lastDate: '2026-10-09',
  ...overrides,
});

describe('streakCalendar', () => {
  it('shows the last seven local days ending today, oldest first, with done days from the history', () => {
    const days = streakCalendar(run(['2026-10-07', '2026-10-08', '2026-10-09']), '2026-10-10');

    expect(days.map((d) => d.date)).toEqual(['2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10']);
    expect(days.map((d) => d.state)).toEqual(['missed', 'missed', 'missed', 'done', 'done', 'done', 'today']);
  });

  it('marks today done when the learner already qualified', () => {
    const days = streakCalendar(run(['2026-10-09', '2026-10-10']), '2026-10-10');

    expect(days[6]).toEqual({ date: '2026-10-10', state: 'done' });
  });

  it('marks a day that a freeze covered as frozen, because the streak went on across the gap', () => {
    const days = streakCalendar(
      [
        ...run(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07']),
        { date: '2026-10-09', streakCount: 8 },
      ],
      '2026-10-10',
    );

    expect(days.find((d) => d.date === '2026-10-08')?.state).toBe('frozen');
    expect(days.find((d) => d.date === '2026-10-09')?.state).toBe('done');
  });

  it('marks every day of a gap a freeze covered, whatever the freeze rule is today', () => {
    const days = streakCalendar([{ date: '2026-10-04', streakCount: 4 }, { date: '2026-10-08', streakCount: 5 }], '2026-10-09');

    expect(days.filter((d) => d.state === 'frozen').map((d) => d.date)).toEqual(['2026-10-05', '2026-10-06', '2026-10-07']);
  });

  it('marks a missed day without a freeze as missed, because the streak started over after the gap', () => {
    const days = streakCalendar([{ date: '2026-10-05', streakCount: 3 }, { date: '2026-10-07', streakCount: 1 }], '2026-10-08');

    expect(days.find((d) => d.date === '2026-10-06')?.state).toBe('missed');
  });

  it('takes the history in any order', () => {
    const days = streakCalendar([{ date: '2026-10-08', streakCount: 5 }, { date: '2026-10-04', streakCount: 4 }], '2026-10-09');

    expect(days.find((d) => d.date === '2026-10-06')?.state).toBe('frozen');
  });

  it('follows the requested length', () => {
    expect(streakCalendar([], '2026-10-10', 3).map((d) => d.date)).toEqual(['2026-10-08', '2026-10-09', '2026-10-10']);
  });
});

describe('streakStatus', () => {
  it('is NONE for a learner who never qualified', () => {
    expect(streakStatus(state({ current: 0, longest: 0, lastDate: null }), '2026-10-10')).toBe('NONE');
  });

  it('is DONE_TODAY when the last qualified day is today', () => {
    expect(streakStatus(state({ lastDate: '2026-10-10' }), '2026-10-10')).toBe('DONE_TODAY');
  });

  it('is AT_RISK when the last qualified day was yesterday', () => {
    expect(streakStatus(state({ lastDate: '2026-10-09' }), '2026-10-10')).toBe('AT_RISK');
  });

  it('is SAVED_BY_FREEZE when the missed days can all be covered and BROKEN when they cannot', () => {
    expect(streakStatus(state({ lastDate: '2026-10-08', freezes: 1 }), '2026-10-10')).toBe('SAVED_BY_FREEZE');
    expect(streakStatus(state({ lastDate: '2026-10-07', freezes: 1 }), '2026-10-10')).toBe('BROKEN');
    expect(streakStatus(state({ lastDate: '2026-10-08', freezes: 0 }), '2026-10-10')).toBe('BROKEN');
  });
});
