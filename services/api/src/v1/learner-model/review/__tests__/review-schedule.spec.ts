import {
  DUE_RETRIEVABILITY,
  MAX_INTERVAL_DAYS,
  ReviewInput,
  buildReviewQueue,
  intervalDays,
  planReviewSession,
  retrievability,
  scheduleReview,
  stabilityDays,
} from '../review-schedule';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-16T00:00:00.000Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS);

const concept = (overrides: Partial<ReviewInput> = {}): ReviewInput => ({
  conceptId: 'l1-t01-accounting-equation',
  score: 0.75,
  evidenceCount: 3,
  lastEventAt: daysAgo(0),
  ...overrides,
});

describe('stability and interval', () => {
  it.each([
    [1, 0.5, 1.5 * 2 ** 0.5 * 1.0],
    [3, 0.75, 1.5 * 2 ** 1.5 * 1.25],
    [6, 0.9, 1.5 * 2 ** 3 * 1.4],
    [10, 0.95, 1.5 * 2 ** 5 * 1.45],
  ])('evidence %i at score %f gives %f days of stability', (evidenceCount, score, expected) => {
    expect(stabilityDays(evidenceCount, score)).toBeCloseTo(expected, 10);
  });

  it('grows with evidence and with score', () => {
    expect(stabilityDays(4, 0.8)).toBeGreaterThan(stabilityDays(3, 0.8));
    expect(stabilityDays(4, 0.9)).toBeGreaterThan(stabilityDays(4, 0.6));
  });

  it('stops growing after twelve assessments', () => {
    expect(stabilityDays(40, 0.8)).toBe(stabilityDays(12, 0.8));
  });

  it('puts the first review of a freshly passed concept about two days out', () => {
    expect(intervalDays(stabilityDays(3, 0.75))).toBeCloseTo(1.8915, 3);
  });

  it('never schedules further than the maximum interval', () => {
    expect(intervalDays(1e6)).toBe(MAX_INTERVAL_DAYS);
    expect(intervalDays(stabilityDays(12, 1))).toBeLessThanOrEqual(MAX_INTERVAL_DAYS);
  });

  it('puts retrievability at the due threshold exactly at the interval', () => {
    const stability = stabilityDays(3, 0.75);
    expect(retrievability(intervalDays(stability), stability)).toBeCloseTo(DUE_RETRIEVABILITY, 10);
  });

  it('treats a negative age as no time passed', () => {
    expect(retrievability(-3, 5)).toBe(1);
  });
});

describe('scheduleReview', () => {
  it('has nothing to schedule without evidence', () => {
    expect(scheduleReview(concept({ evidenceCount: 0 }), NOW)).toBeNull();
    expect(scheduleReview(concept({ lastEventAt: null }), NOW)).toBeNull();
  });

  it('is not due right after an assessment', () => {
    const item = scheduleReview(concept(), NOW);

    expect(item).toMatchObject({ due: false, daysSince: 0, overdueDays: 0, kind: 'REVIEW' });
    expect(item?.retrievability).toBe(1);
  });

  it('becomes due once the interval has passed and reports how overdue it is', () => {
    const item = scheduleReview(concept({ lastEventAt: daysAgo(5) }), NOW);

    expect(item?.due).toBe(true);
    expect(item?.overdueDays).toBeCloseTo(5 - 1.8915, 3);
    expect(item?.retrievability).toBeLessThan(DUE_RETRIEVABILITY);
  });

  it('is due exactly at the due instant', () => {
    const base = scheduleReview(concept(), NOW);
    const atDue = new Date(NOW.getTime() + (base?.intervalDays ?? 0) * DAY_MS);

    expect(scheduleReview(concept(), atDue)?.due).toBe(true);
    expect(scheduleReview(concept(), new Date(atDue.getTime() - 1))?.due).toBe(false);
  });

  it('tells a concept to review from a concept to learn again by the pass score', () => {
    expect(scheduleReview(concept({ score: 0.7 }), NOW)?.kind).toBe('REVIEW');
    expect(scheduleReview(concept({ score: 0.69 }), NOW)?.kind).toBe('RELEARN');
  });

  it('gives a stronger concept a longer interval than a weaker one', () => {
    const weak = scheduleReview(concept({ conceptId: 'weak', score: 0.5, evidenceCount: 3 }), NOW);
    const strong = scheduleReview(concept({ conceptId: 'strong', score: 0.95, evidenceCount: 9 }), NOW);

    expect(strong?.intervalDays).toBeGreaterThan(weak?.intervalDays ?? Infinity);
  });

  it('ignores a last event in the future', () => {
    const item = scheduleReview(concept({ lastEventAt: new Date(NOW.getTime() + DAY_MS) }), NOW);

    expect(item).toMatchObject({ daysSince: 0, due: false });
  });
});

describe('buildReviewQueue', () => {
  it('orders due concepts by how much has been forgotten, then by id', () => {
    const queue = buildReviewQueue(
      [
        concept({ conceptId: 'b-mild', lastEventAt: daysAgo(3) }),
        concept({ conceptId: 'a-deep', lastEventAt: daysAgo(30) }),
        concept({ conceptId: 'c-mild', lastEventAt: daysAgo(3) }),
      ],
      NOW,
    );

    expect(queue.due.map((item) => item.conceptId)).toEqual(['a-deep', 'b-mild', 'c-mild']);
  });

  it('keeps fresh concepts out of the due list and lists the ones coming up within a week', () => {
    const queue = buildReviewQueue(
      [
        concept({ conceptId: 'fresh', lastEventAt: daysAgo(0) }),
        concept({ conceptId: 'soon', lastEventAt: daysAgo(1.5) }),
        concept({ conceptId: 'far', score: 0.95, evidenceCount: 12, lastEventAt: daysAgo(0) }),
        concept({ conceptId: 'overdue', lastEventAt: daysAgo(9) }),
      ],
      NOW,
    );

    expect(queue.due.map((item) => item.conceptId)).toEqual(['overdue']);
    expect(queue.upcoming.map((item) => item.conceptId)).toEqual(['soon', 'fresh']);
  });

  it('skips concepts that have no evidence', () => {
    const queue = buildReviewQueue([concept({ conceptId: 'unseen', evidenceCount: 0, lastEventAt: null })], NOW);

    expect(queue).toEqual({ due: [], upcoming: [] });
  });

  it('is empty for no input', () => {
    expect(buildReviewQueue([], NOW)).toEqual({ due: [], upcoming: [] });
  });
});

describe('planReviewSession', () => {
  const due = (ids: string[]) => buildReviewQueue(ids.map((conceptId) => concept({ conceptId, lastEventAt: daysAgo(20) })), NOW).due;

  it('takes at most three concepts and sizes the session from the question count', () => {
    const plan = planReviewSession(due(['a', 'b', 'c', 'd', 'e']));

    expect(plan).toEqual({ conceptIds: ['a', 'b', 'c'], questionsPerConcept: 3, totalQuestions: 9, estimatedMinutes: 6 });
  });

  it('plans a short session for a single concept', () => {
    expect(planReviewSession(due(['a']))).toEqual({ conceptIds: ['a'], questionsPerConcept: 3, totalQuestions: 3, estimatedMinutes: 2 });
  });

  it('plans nothing when nothing is due', () => {
    expect(planReviewSession([])).toEqual({ conceptIds: [], questionsPerConcept: 3, totalQuestions: 0, estimatedMinutes: 0 });
  });
});
