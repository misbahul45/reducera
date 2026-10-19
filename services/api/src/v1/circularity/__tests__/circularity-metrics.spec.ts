import {
  AssessmentObservation,
  ConversionLearner,
  MINIMUM_EVIDENCE,
  StoredAssessment,
  creatorConversion,
  isDemoAccount,
  knowledgeReuse,
  masteryChange,
  observeAssessments,
  promptEvidence,
  resolveWindow,
  reviewOutcome,
} from '../circularity-metrics';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-17T12:00:00.000Z');
const window = { from: new Date(NOW.getTime() - 30 * DAY_MS), to: NOW };
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS);

const payload = (score: number) => ({ attemptId: `a-${Math.random()}`, quizId: 'q', score, items: 5, hintsUsed: 0, share: 1, attemptNumber: 1 });

const event = (userId: string, conceptId: string, streamSeq: number, occurredAt: Date, score = 1): StoredAssessment => ({
  userId,
  conceptId,
  streamSeq,
  occurredAt,
  payload: payload(score),
});

const observation = (userId: string, patch: Partial<AssessmentObservation> = {}): AssessmentObservation => ({
  userId,
  conceptId: 'c1',
  occurredAt: daysAgo(1),
  delta: 0.1,
  hadPriorState: true,
  due: false,
  passed: true,
  ...patch,
});

const demoSet = (...ids: string[]) => (userId: string) => ids.includes(userId);

describe('resolveWindow', () => {
  it('defaults to the last 30 days ending now', () => {
    const result = resolveWindow({}, NOW);

    expect(result.to).toEqual(NOW);
    expect(NOW.getTime() - result.from.getTime()).toBe(30 * DAY_MS);
  });

  it('refuses an empty or reversed window and one longer than 366 days', () => {
    expect(() => resolveWindow({ from: NOW, to: NOW }, NOW)).toThrow(RangeError);
    expect(() => resolveWindow({ from: daysAgo(-1), to: NOW }, NOW)).toThrow(RangeError);
    expect(() => resolveWindow({ from: daysAgo(367) }, NOW)).toThrow(RangeError);
    expect(resolveWindow({ from: daysAgo(366) }, NOW).from).toEqual(daysAgo(366));
  });
});

describe('isDemoAccount', () => {
  it('recognises the reserved demo domain only', () => {
    expect(isDemoAccount('t1.learner@reducera.local')).toBe(true);
    expect(isDemoAccount('  Demo.Admin@REDUCERA.LOCAL ')).toBe(true);
    expect(isDemoAccount('someone@reducera.local.example.com')).toBe(false);
    expect(isDemoAccount('someone@gmail.com')).toBe(false);
  });
});

describe('observeAssessments', () => {
  it('reports the change of the estimate caused by each graded event', () => {
    const [first] = observeAssessments([event('u1', 'c1', 1, daysAgo(2), 1)], window);

    expect(first.delta).toBeCloseTo(0.1225, 3);
    expect(first.hadPriorState).toBe(false);
    expect(first.passed).toBe(true);
  });

  it('folds events older than the window but reports only those inside it', () => {
    const events = [event('u1', 'c1', 1, daysAgo(60), 1), event('u1', 'c1', 2, daysAgo(2), 1)];

    const observed = observeAssessments(events, window);

    expect(observed).toHaveLength(1);
    expect(observed[0].hadPriorState).toBe(true);
    expect(observed[0].delta).toBeLessThan(0.1225);
  });

  it('marks an event as due only when the schedule says the concept had faded', () => {
    const late = observeAssessments([event('u1', 'c1', 1, daysAgo(10), 1), event('u1', 'c1', 2, daysAgo(5), 1)], window);
    const early = observeAssessments([event('u2', 'c1', 1, new Date(NOW.getTime() - 3 * 3_600_000), 1), event('u2', 'c1', 2, new Date(NOW.getTime() - 2 * 3_600_000), 1)], window);

    expect(late[1].due).toBe(true);
    expect(early[1].due).toBe(false);
  });

  it('treats a pass as a score of at least 0.7', () => {
    const observed = observeAssessments([event('u1', 'c1', 1, daysAgo(3), 0.69), event('u1', 'c2', 2, daysAgo(2), 0.7)], window);

    expect(observed.map((item) => item.passed)).toEqual([false, true]);
  });

  it('skips invalid payloads, other event types and events from the end of the window on', () => {
    const events: StoredAssessment[] = [
      { ...event('u1', 'c1', 1, daysAgo(3)), payload: { score: 'high' } },
      { ...event('u1', 'c1', 2, daysAgo(2)), eventType: 'NOTE_ADDED' },
      event('u1', 'c1', 3, NOW),
      event('u1', 'c1', 4, daysAgo(1)),
    ];

    expect(observeAssessments(events, window)).toHaveLength(1);
  });
});

describe('masteryChange', () => {
  const rows = (count: number, learners: number, prefix = 'u') =>
    Array.from({ length: count }, (_, index) => observation(`${prefix}${index % learners}`, { delta: index % 4 === 0 ? -0.02 : 0.04 }));

  it('shows no rate below the minimum and keeps the demo numbers apart', () => {
    const result = masteryChange([...rows(29, 12), ...rows(5, 2, 'demo')], demoSet('demo0', 'demo1'));

    expect(result.state).toBe('NOT_ENOUGH_EVIDENCE');
    expect(result.value).toBeNull();
    expect(result.organic).toEqual({ n: 29, learners: 12 });
    expect(result.demo).toEqual({ n: 5, learners: 2 });
    expect(result.demoValue).not.toBeNull();
  });

  it('needs both the event count and the learner count', () => {
    const manyEventsFewLearners = masteryChange(rows(MINIMUM_EVIDENCE.masteryChange.events, 9), demoSet());
    const enough = masteryChange(rows(MINIMUM_EVIDENCE.masteryChange.events, 10), demoSet());

    expect(manyEventsFewLearners.state).toBe('NOT_ENOUGH_EVIDENCE');
    expect(enough.state).toBe('OK');
  });

  it('computes mean, median and the share of events above zero', () => {
    const data = [0.1, 0.2, -0.1, 0.3].map((delta, index) => observation(`u${index}`, { delta }));

    const result = masteryChange(data, demoSet());

    expect(result.demoValue).toBeNull();
    const summary = masteryChange(data.map((item) => ({ ...item, userId: `demo${item.userId}` })), (id) => id.startsWith('demo')).demoValue;
    expect(summary).toEqual({ meanDelta: 0.125, medianDelta: 0.15, shareImproved: 0.75 });
  });
});

describe('reviewOutcome', () => {
  it('counts only events with a prior state that were due, and passes against the 0.7 threshold', () => {
    const data = [
      observation('demo1', { due: true, passed: true }),
      observation('demo1', { due: true, passed: false }),
      observation('demo2', { due: true, passed: true }),
      observation('demo2', { due: false, passed: true }),
      observation('demo2', { due: false, passed: false }),
      observation('demo3', { due: true, passed: true, hadPriorState: false }),
    ];

    const result = reviewOutcome(data, (id) => id.startsWith('demo'));

    expect(result.organic.n).toBe(0);
    expect(result.demo).toEqual({ n: 3, learners: 2 });
    expect(result.demoValue).toEqual({ dueEvents: 3, passed: 2, passRate: 0.6667, notDueEvents: 2, notDuePassRate: 0.5 });
  });

  it('is only calculated for organic learners once 20 due events from 10 learners exist', () => {
    const data = Array.from({ length: 20 }, (_, index) => observation(`u${index % 10}`, { due: true, passed: index % 2 === 0 }));

    const result = reviewOutcome(data, demoSet());

    expect(result.state).toBe('OK');
    expect(result.value).toMatchObject({ dueEvents: 20, passed: 10, passRate: 0.5, notDueEvents: 0, notDuePassRate: null });
  });
});

describe('knowledgeReuse', () => {
  const product = (id: string, patch = {}) => ({ kind: 'class' as const, id, title: id, ownerId: 'owner', ownerIsDemo: false, conceptIds: ['c1'], ...patch });
  const holder = (userId: string, productId = 'p1', startsAt = daysAgo(5)) => ({ kind: 'class' as const, productId, userId, startsAt });
  const use = (userId: string, conceptId = 'c1', occurredAt = daysAgo(2)) => ({ userId, conceptId, occurredAt });

  it('counts a product as reused when two distinct learners other than the author practised a linked concept after access', () => {
    const result = knowledgeReuse(
      [product('p1', { ownerIsDemo: true })],
      [holder('demo-a'), holder('demo-b'), holder('owner')],
      [use('demo-a'), use('demo-b'), use('owner')],
      window,
      (id) => id.startsWith('demo') || id === 'owner',
    );

    expect(result.demoValue).toMatchObject({ denominator: 1, numerator: 1, reuseRate: 1 });
    expect(result.demoValue?.products[0]).toMatchObject({ holders: 2, qualifyingLearners: 2 });
  });

  it('does not count use before access, use of another concept, or one learner twice', () => {
    const result = knowledgeReuse(
      [product('p1', { ownerIsDemo: true })],
      [holder('demo-a'), holder('demo-b'), holder('demo-c')],
      [use('demo-a', 'c1', daysAgo(9)), use('demo-b', 'c2'), use('demo-c'), use('demo-c')],
      window,
      (id) => id.startsWith('demo'),
    );

    expect(result.demoValue).toMatchObject({ numerator: 0, denominator: 1 });
    expect(result.demoValue?.products[0].qualifyingLearners).toBe(1);
  });

  it('does not mix organic learners into a demo product or demo learners into an organic one', () => {
    const result = knowledgeReuse(
      [product('p1'), product('p2', { ownerIsDemo: true })],
      [holder('real-a', 'p1'), holder('demo-a', 'p1'), holder('real-b', 'p2'), holder('demo-b', 'p2')],
      [use('real-a'), use('demo-a'), use('real-b'), use('demo-b')],
      window,
      (id) => id.startsWith('demo'),
    );

    expect(result.organic).toEqual({ n: 1, learners: 1 });
    expect(result.demo).toEqual({ n: 1, learners: 1 });
  });

  it('needs five organic products in the denominator before it reports a rate', () => {
    const products = (count: number) => Array.from({ length: count }, (_, index) => product(`p${index}`));
    const below = knowledgeReuse(products(4), [], [], window, demoSet());
    const enough = knowledgeReuse(products(5), [], [], window, demoSet());

    expect(below.state).toBe('NOT_ENOUGH_EVIDENCE');
    expect(below.value).toBeNull();
    expect(enough.state).toBe('OK');
    expect(enough.value).toMatchObject({ denominator: 5, numerator: 0, reuseRate: 0 });
  });
});

describe('creatorConversion', () => {
  const strong = new Map([
    ['c1', { score: 0.9, evidenceCount: 5, lastEventAt: daysAgo(1) }],
    ['c2', { score: 0.88, evidenceCount: 4, lastEventAt: daysAgo(1) }],
  ]);
  const weak = new Map([
    ['c1', { score: 0.9, evidenceCount: 5, lastEventAt: daysAgo(1) }],
    ['c2', { score: 0.6, evidenceCount: 5, lastEventAt: daysAgo(1) }],
  ]);
  const topics = [{ topicId: 't1', title: 'Topic', conceptIds: ['c1', 'c2'] }];
  const learner = (userId: string, patch: Partial<ConversionLearner> = {}): ConversionLearner => ({
    userId,
    isDemo: false,
    isAdmin: false,
    mastery: strong,
    approvedCreator: false,
    ...patch,
  });

  it('applies the server eligibility rule and ignores administrators', () => {
    const result = creatorConversion(topics, [
      learner('a', { isDemo: true, approvedCreator: true }),
      learner('b', { isDemo: true }),
      learner('c', { isDemo: true, mastery: weak }),
      learner('d', { isDemo: true, isAdmin: true, approvedCreator: true }),
    ]);

    expect(result.demo).toEqual({ n: 2, learners: 2 });
    expect(result.demoValue).toMatchObject({ eligible: 2, converted: 1, conversion: 0.5 });
    expect(result.demoValue?.topics[0]).toMatchObject({ topicId: 't1', concepts: 2, eligible: 2, converted: 1 });
  });

  it('reports organic conversion only from 20 eligible learners', () => {
    const people = (count: number) => Array.from({ length: count }, (_, index) => learner(`u${index}`, { approvedCreator: index < 3 }));

    const below = creatorConversion(topics, people(19));
    const enough = creatorConversion(topics, people(20));

    expect(below.state).toBe('NOT_ENOUGH_EVIDENCE');
    expect(below.value).toBeNull();
    expect(enough.state).toBe('OK');
    expect(enough.value).toMatchObject({ eligible: 20, converted: 3, conversion: 0.15 });
  });

  it('counts a learner who is eligible for two topics once', () => {
    const result = creatorConversion([...topics, { topicId: 't2', title: 'Other', conceptIds: ['c1'] }], [learner('a', { isDemo: true })]);

    expect(result.demoValue).toMatchObject({ eligible: 1 });
    expect(result.demoValue?.topics.map((item) => item.eligible)).toEqual([1, 1]);
  });
});

describe('promptEvidence', () => {
  const run = (patch = {}) => ({ completed: true, decided: false, identicalArms: false, criteria: [{ id: 'offline_correctness', status: 'PASS' }, { id: 'offline_safety', status: 'FAIL' }], ...patch });

  it('summarises drafts, runs, verdicts and outcomes as counts, without a rate', () => {
    const result = promptEvidence(
      [{ id: 'v1', status: 'REJECTED' }, { id: 'v2', status: 'DRAFT' }, { id: 'v3', status: 'REJECTED' }],
      [
        { action: 'PROMPT_PROPOSED_BY_AI', entityId: 'v1' },
        { action: 'PROMPT_PROPOSED', entityId: 'v3' },
        { action: 'PROMPT_CANARY_STARTED', entityId: 'v3' },
        { action: 'PROMPT_ROLLED_BACK', entityId: 'v3' },
      ],
      [run(), run({ identicalArms: true }), run({ completed: false })],
      [
        { userId: 'demo1', promptVersion: 'builtin-3', success: true },
        { userId: 'u1', promptVersion: 'builtin-3', success: false },
        { userId: 'u2', promptVersion: 'builtin-4', success: true },
      ],
      demoSet('demo1'),
    );

    expect(result.state).toBe('NOT_ENOUGH_EVIDENCE');
    expect(result.value).toEqual({
      drafts: { aiProposed: 1, engineer: 1, byStatus: { REJECTED: 2, DRAFT: 1 } },
      benchmarkRuns: { completed: 2, candidateRuns: 1, identicalArmsRuns: 1, decided: 0, verdicts: { offline_correctness: { PASS: 1 }, offline_safety: { FAIL: 1 } } },
      canariesStarted: 1,
      rollbacks: 1,
      strategyOutcomes: [
        { promptVersion: 'builtin-3', n: 2, successes: 1 },
        { promptVersion: 'builtin-4', n: 1, successes: 1 },
      ],
    });
    expect(result.organic).toEqual({ n: 2, learners: 2 });
    expect(result.demo).toEqual({ n: 1, learners: 1 });
  });

  it('is ready once a completed run carries a recorded human decision', () => {
    const result = promptEvidence([], [], [run({ decided: true })], [], demoSet());

    expect(result.state).toBe('OK');
    expect(result.value?.benchmarkRuns.decided).toBe(1);
  });
});
