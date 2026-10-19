import { Arm, CaseDimensions, CaseResult, bootstrapMean, compareArms, percentile, summarizeArm, toOfflineEvidence } from '../benchmark-report';

const dims = (over: Partial<CaseDimensions> = {}): CaseDimensions => ({
  correctness: true,
  coverage: 1,
  citation: true,
  safety: true,
  pedagogy: 4,
  behavior: 4,
  grounding: 4,
  ...over,
});

const result = (caseId: string, over: Partial<CaseResult> & { dims?: Partial<CaseDimensions> } = {}): CaseResult => {
  const { dims: dimOver, ...rest } = over;
  return {
    caseId,
    category: 'concept',
    risk: 'standard',
    repeat: 0,
    templateLabel: 't',
    templateHash: 'h',
    model: 'm',
    mode: 'flash',
    escalated: false,
    tokensIn: 100,
    tokensOut: 50,
    latencyMs: 1000,
    text: 'jawaban',
    citationsShown: [],
    actions: [],
    checks: {},
    judge: null,
    judgeError: null,
    dimensions: dims(dimOver),
    ...rest,
  };
};

const arm = (hash: string, results: CaseResult[], failures: Arm['failures'] = []): Arm => ({ label: `arm-${hash}`, hash, results, failures });
const ids = (count: number) => Array.from({ length: count }, (_, index) => `TC-${String(index + 1).padStart(2, '0')}`);

describe('percentile', () => {
  it('uses the nearest rank and is null without data', () => {
    expect(percentile([5, 1, 3, 2, 4], 0.5)).toBe(3);
    expect(percentile([5, 1, 3, 2, 4], 0.95)).toBe(5);
    expect(percentile([], 0.5)).toBeNull();
  });
});

describe('bootstrapMean', () => {
  it('is reproducible for the same seed and differs for another', () => {
    const values = [1.5, 2.2, 3.9, 4.1, 2.8, 3.3, 1.1, 4.8, 2.5, 3.7, 4.4, 1.9];

    expect(bootstrapMean(values, 'a')).toEqual(bootstrapMean(values, 'a'));
    expect(bootstrapMean(values, 'a')).not.toEqual(bootstrapMean(values, 'b'));
  });

  it('brackets the mean and collapses to a point when every value is the same', () => {
    const spread = bootstrapMean([0, 1, 0, 1, 1, 0, 1, 1], 'x');
    const flat = bootstrapMean([1, 1, 1, 1], 'x');

    expect(spread.lower as number).toBeLessThanOrEqual(spread.mean as number);
    expect(spread.upper as number).toBeGreaterThanOrEqual(spread.mean as number);
    expect(flat).toEqual({ mean: 1, lower: 1, upper: 1 });
  });

  it('says nothing for an empty sample', () => {
    expect(bootstrapMean([], 'x')).toEqual({ mean: null, lower: null, upper: null });
  });
});

describe('summarizeArm', () => {
  it('reports per dimension rates, judge scores, latency, tokens and counts', () => {
    const results = ids(4).map((caseId, index) => result(caseId, { latencyMs: 1000 * (index + 1), tokensIn: 100 * (index + 1), dims: { correctness: index < 3, pedagogy: index + 1 } }));

    const summary = summarizeArm(arm('a', results, [{ caseId: 'TC-09', repeat: 0, message: 'boom' }]));

    expect(summary.cases).toBe(4);
    expect(summary.samples).toBe(4);
    expect(summary.failures).toBe(1);
    expect(summary.rates.correctness.mean).toBeCloseTo(0.75, 10);
    expect(summary.rates.safety.mean).toBe(1);
    expect(summary.scores.pedagogy.mean).toBeCloseTo(2.5, 10);
    expect(summary.scores.pedagogy.judged).toBe(4);
    expect(summary.latencyMs).toEqual({ p50: 2000, p95: 4000 });
    expect(summary.tokens.meanIn).toBe(250);
  });

  it('averages the repeats of a case before it averages the cases', () => {
    const results = [
      result('TC-01', { repeat: 0, dims: { correctness: true } }),
      result('TC-01', { repeat: 1, dims: { correctness: false } }),
      result('TC-02', { repeat: 0, dims: { correctness: true } }),
      result('TC-02', { repeat: 1, dims: { correctness: true } }),
    ];

    const summary = summarizeArm(arm('a', results));

    expect(summary.cases).toBe(2);
    expect(summary.samples).toBe(4);
    expect(summary.rates.correctness.mean).toBeCloseTo(0.75, 10);
  });

  it('leaves judge scores empty when no sample was judged', () => {
    const summary = summarizeArm(arm('a', ids(3).map((caseId) => result(caseId, { dims: { pedagogy: null, behavior: null, grounding: null } }))));

    expect(summary.scores.pedagogy).toEqual({ mean: null, lower: null, upper: null, judged: 0 });
  });

  it('breaks results down by category and by risk class', () => {
    const results = [
      result('TC-01', { category: 'concept' }),
      result('TC-02', { category: 'safety', risk: 'high', dims: { safety: false } }),
    ];

    const summary = summarizeArm(arm('a', results));

    expect(summary.byCategory.concept).toEqual({ cases: 1, correctness: 1, citation: 1, safety: 1 });
    expect(summary.byCategory.safety.safety).toBe(0);
    expect(summary.byRisk.high.cases).toBe(1);
    expect(summary.byRisk.standard.cases).toBe(1);
  });

  it('is empty rather than made up for an arm without results', () => {
    const summary = summarizeArm(arm('a', []));

    expect(summary.cases).toBe(0);
    expect(summary.rates.correctness.mean).toBeNull();
    expect(summary.latencyMs.p50).toBeNull();
  });
});

describe('compareArms', () => {
  it('finds no difference between identical arms', () => {
    const results = ids(40).map((caseId, index) => result(caseId, { dims: { correctness: index % 3 !== 0 } }));

    const comparison = compareArms(arm('a', results), arm('b', results));

    expect(comparison.pairedCases).toBe(40);
    expect(comparison.rates.correctness.diff).toBe(0);
    expect(comparison.rates.correctness.ties).toBe(40);
    expect(comparison.rates.correctness.regressions).toEqual([]);
    expect(comparison.safetyRegressions).toEqual([]);
  });

  it('counts wins, losses and ties on the same cases and names the cases that got worse', () => {
    const base = ids(6).map((caseId, index) => result(caseId, { dims: { correctness: index < 3 } }));
    const candidate = ids(6).map((caseId, index) => result(caseId, { dims: { correctness: index === 0 || index === 4 || index === 5 } }));

    const rate = compareArms(arm('a', base), arm('b', candidate)).rates.correctness;

    expect({ wins: rate.wins, losses: rate.losses, ties: rate.ties }).toEqual({ wins: 2, losses: 2, ties: 2 });
    expect(rate.regressions).toEqual(['TC-02', 'TC-03']);
    expect(rate.diff).toBeCloseTo(0, 10);
  });

  it('compares only the cases both arms answered', () => {
    const base = ids(5).map((caseId) => result(caseId));
    const candidate = ids(5).slice(0, 3).map((caseId) => result(caseId));

    expect(compareArms(arm('a', base), arm('b', candidate)).pairedCases).toBe(3);
  });

  it('flags any case whose safety got worse, however small the drop', () => {
    const base = [result('TC-01'), result('TC-01', { repeat: 1 }), result('TC-02'), result('TC-02', { repeat: 1 })];
    const candidate = [result('TC-01'), result('TC-01', { repeat: 1, dims: { safety: false } }), result('TC-02'), result('TC-02', { repeat: 1 })];

    expect(compareArms(arm('a', base), arm('b', candidate)).safetyRegressions).toEqual(['TC-01']);
  });

  it('does not flag a case that was already unsafe under the baseline', () => {
    const base = [result('TC-01', { dims: { safety: false } })];
    const candidate = [result('TC-01', { dims: { safety: false } })];

    expect(compareArms(arm('a', base), arm('b', candidate)).safetyRegressions).toEqual([]);
  });

  it('measures judge scores as differences of means and ignores unjudged samples', () => {
    const base = ids(4).map((caseId) => result(caseId, { dims: { pedagogy: 3 } }));
    const candidate = ids(4).map((caseId, index) => result(caseId, { dims: { pedagogy: index === 3 ? null : 4 } }));

    const pedagogy = compareArms(arm('a', base), arm('b', candidate)).scores.pedagogy;

    expect(pedagogy.pairedCases).toBe(3);
    expect(pedagogy.diff).toBe(1);
    expect(pedagogy.wins).toBe(3);
  });

  it('reports a clear drop with an interval that excludes zero', () => {
    const base = ids(60).map((caseId) => result(caseId));
    const candidate = ids(60).map((caseId, index) => result(caseId, { dims: { correctness: index >= 30 } }));

    const rate = compareArms(arm('a', base), arm('b', candidate)).rates.correctness;

    expect(rate.diff).toBeCloseTo(-0.5, 10);
    expect(rate.upper as number).toBeLessThan(0);
  });
});

describe('toOfflineEvidence', () => {
  it('carries what the gate needs and never claims a calibrated judge', () => {
    const results = ids(3).map((caseId) => result(caseId));
    const comparison = compareArms(arm('a', results), arm('b', results));

    const evidence = toOfflineEvidence({ runId: 'run-1', datasetDigest: 'abc', repeats: 2, judged: true, comparison });

    expect(evidence).toMatchObject({ runId: 'run-1', datasetDigest: 'abc', repeats: 2, judged: true, judgeCalibrated: false, pairedCases: 3 });
    expect(evidence.safety.regressions).toEqual([]);
    expect(evidence.correctness.pairedCases).toBe(3);
  });
});
