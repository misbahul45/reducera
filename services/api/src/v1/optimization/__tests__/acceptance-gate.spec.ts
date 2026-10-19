import { GATE_THRESHOLDS, OFFLINE_THRESHOLDS, OfflineDimension, OfflineEvidence, PromptMetrics, evaluateGate, offlineBlockers } from '../acceptance-gate';

const metrics = (over: Partial<PromptMetrics> = {}): PromptMetrics => ({
  episodes: 120,
  outcomes: 40,
  successRate: 0.6,
  groundedRate: 0.8,
  p50LatencyMs: 4000,
  p95LatencyMs: 9000,
  avgTokensIn: 2500,
  avgTokensOut: 800,
  ...over,
});

const status = (result: ReturnType<typeof evaluateGate>, id: string) => result.criteria.find((criterion) => criterion.id === id)?.status;

describe('evaluateGate', () => {
  it('passes a candidate that is not worse on any measured criterion and says what it could not measure', () => {
    const result = evaluateGate(metrics(), metrics({ successRate: 0.65 }));

    expect(result.passed).toBe(true);
    expect(result.notMeasured).toEqual(['correctness', 'pedagogy', 'hallucination_rate']);
    expect(result.regression).toBe(false);
  });

  it('never passes on too little data, whatever the numbers look like', () => {
    const result = evaluateGate(metrics(), metrics({ episodes: GATE_THRESHOLDS.minEpisodes - 1, successRate: 0.99 }));

    expect(result.passed).toBe(false);
    expect(result.sampleSufficient).toBe(false);
    expect(status(result, 'sample_size')).toBe('INSUFFICIENT_DATA');
  });

  it('needs enough learning outcomes as well as enough episodes', () => {
    expect(evaluateGate(metrics(), metrics({ outcomes: GATE_THRESHOLDS.minOutcomes - 1 })).sampleSufficient).toBe(false);
  });

  it.each([
    ['learning_outcome', { successRate: 0.55 }],
    ['grounding', { groundedRate: 0.7 }],
    ['latency_p95', { p95LatencyMs: 9000 * 1.1 + 1 }],
    ['token_cost', { avgTokensIn: 3000, avgTokensOut: 2000 }],
  ])('fails on %s when the candidate is worse than the baseline', (id, over) => {
    const result = evaluateGate(metrics(), metrics(over as Partial<PromptMetrics>));

    expect(status(result, id)).toBe('FAIL');
    expect(result.passed).toBe(false);
  });

  it('allows the latency and token budgets the plan gives and no more', () => {
    const result = evaluateGate(metrics(), metrics({ p95LatencyMs: 9900, avgTokensIn: 3960, avgTokensOut: 0 }));

    expect(status(result, 'latency_p95')).toBe('PASS');
    expect(status(result, 'token_cost')).toBe('PASS');
  });

  it('treats a missing measurement as insufficient data rather than a pass', () => {
    const result = evaluateGate(metrics({ groundedRate: null }), metrics());

    expect(status(result, 'grounding')).toBe('INSUFFICIENT_DATA');
    expect(result.passed).toBe(false);
  });

  it('flags a regression when the success rate falls by more than a tenth of the baseline with enough data', () => {
    expect(evaluateGate(metrics(), metrics({ successRate: 0.5 })).regression).toBe(true);
    expect(evaluateGate(metrics(), metrics({ successRate: 0.55 })).regression).toBe(false);
  });

  it('does not flag a regression from a thin sample', () => {
    expect(evaluateGate(metrics(), metrics({ episodes: 5, outcomes: 2, successRate: 0 })).regression).toBe(false);
  });

  it('exposes every component and never an aggregate score', () => {
    const result = evaluateGate(metrics(), metrics());

    expect(result.criteria.map((criterion) => criterion.id)).toEqual([
      'sample_size',
      'learning_outcome',
      'grounding',
      'latency_p95',
      'token_cost',
      'correctness',
      'pedagogy',
      'hallucination_rate',
    ]);
    expect(result).not.toHaveProperty('score');
  });
});

const dimension = (over: Partial<OfflineDimension> = {}): OfflineDimension => ({
  baseline: 0.7,
  candidate: 0.72,
  diff: 0.02,
  lower: -0.02,
  upper: 0.06,
  pairedCases: 56,
  ...over,
});

const offline = (over: Partial<OfflineEvidence> = {}): OfflineEvidence => ({
  runId: 'run-1',
  datasetDigest: 'a'.repeat(64),
  repeats: 3,
  pairedCases: 56,
  judged: true,
  judgeCalibrated: false,
  correctness: dimension(),
  citation: dimension(),
  safety: { ...dimension({ baseline: 1, candidate: 1, diff: 0, lower: 0, upper: 0 }), regressions: [] },
  pedagogy: dimension({ baseline: 3.5, candidate: 3.6, diff: 0.1, lower: -0.05, upper: 0.25 }),
  ...over,
});

describe('evaluateGate with offline benchmark evidence', () => {
  it('replaces the criteria that were not measured with the ones the benchmark measured', () => {
    const result = evaluateGate(metrics(), metrics(), offline());

    expect(result.criteria.map((criterion) => criterion.id)).toEqual([
      'sample_size',
      'learning_outcome',
      'grounding',
      'latency_p95',
      'token_cost',
      'offline_correctness',
      'offline_citation_faithfulness',
      'offline_safety',
      'offline_pedagogy_judge',
      'judge_calibration',
    ]);
    expect(result.notMeasured).toEqual(['judge_calibration']);
    expect(result.passed).toBe(true);
  });

  it('never claims the judge is calibrated', () => {
    expect(status(evaluateGate(metrics(), metrics(), offline()), 'judge_calibration')).toBe('NOT_MEASURED');
  });

  it('fails closed when one case that was safe under the baseline is unsafe under the candidate', () => {
    const result = evaluateGate(metrics(), metrics(), offline({ safety: { ...dimension(), regressions: ['TC-39'] } }));

    expect(status(result, 'offline_safety')).toBe('FAIL');
    expect(result.passed).toBe(false);
  });

  it('passes correctness only when the lower end of the interval stays inside the margin', () => {
    expect(status(evaluateGate(metrics(), metrics(), offline({ correctness: dimension({ lower: -0.05 }) })), 'offline_correctness')).toBe('PASS');
    expect(status(evaluateGate(metrics(), metrics(), offline({ correctness: dimension({ lower: -0.06, upper: 0.02 }) })), 'offline_correctness')).toBe('INSUFFICIENT_DATA');
  });

  it('fails correctness when even the upper end of the interval is below the margin', () => {
    const result = evaluateGate(metrics(), metrics(), offline({ correctness: dimension({ diff: -0.2, lower: -0.3, upper: -0.08 }) }));

    expect(status(result, 'offline_correctness')).toBe('FAIL');
    expect(result.passed).toBe(false);
  });

  it('does not pass on too few paired cases however good the numbers are', () => {
    const result = evaluateGate(metrics(), metrics(), offline({ correctness: dimension({ pairedCases: OFFLINE_THRESHOLDS.minPairedCases - 1, lower: 0.1, upper: 0.2 }) }));

    expect(status(result, 'offline_correctness')).toBe('INSUFFICIENT_DATA');
    expect(result.passed).toBe(false);
  });

  it('does not pass safety on too few cases either', () => {
    const safety = { ...dimension({ pairedCases: 10 }), regressions: [] };

    expect(status(evaluateGate(metrics(), metrics(), offline({ safety })), 'offline_safety')).toBe('INSUFFICIENT_DATA');
  });

  it('marks the pedagogy score as not measured when the benchmark ran without the judge', () => {
    const result = evaluateGate(metrics(), metrics(), offline({ judged: false }));

    expect(status(result, 'offline_pedagogy_judge')).toBe('NOT_MEASURED');
    expect(result.notMeasured).toEqual(['offline_pedagogy_judge', 'judge_calibration']);
  });

  it('applies the judge margin on the one to five scale', () => {
    expect(status(evaluateGate(metrics(), metrics(), offline({ pedagogy: dimension({ diff: -0.1, lower: -0.15, upper: 0.0 }) })), 'offline_pedagogy_judge')).toBe('PASS');
    expect(status(evaluateGate(metrics(), metrics(), offline({ pedagogy: dimension({ diff: -0.3, lower: -0.5, upper: -0.2 }) })), 'offline_pedagogy_judge')).toBe('FAIL');
  });

  it('does not turn an offline failure into an automatic rollback of a running canary', () => {
    const result = evaluateGate(metrics(), metrics(), offline({ safety: { ...dimension(), regressions: ['TC-39'] } }));

    expect(result.regression).toBe(false);
  });
});

describe('offlineBlockers', () => {
  it('names the criteria that failed and nothing else', () => {
    expect(offlineBlockers(offline({ safety: { ...dimension(), regressions: ['TC-39'] }, correctness: dimension({ diff: -0.2, lower: -0.3, upper: -0.08 }) }))).toEqual(['offline_correctness', 'offline_safety']);
  });

  it('blocks nothing for inconclusive or missing evidence', () => {
    expect(offlineBlockers(null)).toEqual([]);
    expect(offlineBlockers(offline({ correctness: dimension({ lower: -0.2, upper: 0.1 }) }))).toEqual([]);
  });
});
