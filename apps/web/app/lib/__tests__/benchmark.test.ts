import { describe, expect, it } from 'vitest';
import type { BenchmarkPairedDifference, BenchmarkReportView } from '~/interfaces/admin';
import { gateLabel, statusMeta } from '~/lib/admin';
import {
  CAVEATS,
  DATASET_OPTIONS,
  DECISION_MAX,
  DECISION_MIN,
  canDecide,
  canProposeFrom,
  datasetRoleLabel,
  decisionProblem,
  differenceLabel,
  dimensionRows,
  hasActiveRun,
  intervalLabel,
  levelLabel,
  progressPercent,
  runTitle,
  verdictOf,
  worseCases,
} from '~/lib/benchmark';

const difference = (over: Partial<BenchmarkPairedDifference> = {}): BenchmarkPairedDifference => ({
  baseline: 0.7,
  candidate: 0.72,
  diff: 0.02,
  lower: -0.02,
  upper: 0.06,
  pairedCases: 56,
  wins: 5,
  losses: 3,
  ties: 48,
  regressions: [],
  ...over,
});

const report = (over: { judged?: boolean; rates?: Partial<Record<'correctness' | 'citation' | 'safety', BenchmarkPairedDifference>>; scores?: Partial<Record<'pedagogy' | 'behavior' | 'grounding', BenchmarkPairedDifference>>; safetyRegressions?: string[] } = {}): BenchmarkReportView =>
  ({
    baseline: {},
    candidate: {},
    comparison: {
      pairedCases: 56,
      rates: { correctness: difference(), citation: difference(), safety: difference(), ...over.rates },
      scores: { pedagogy: difference(), behavior: difference(), grounding: difference(), ...over.scores },
      safetyRegressions: over.safetyRegressions ?? [],
    },
    evidence: { judged: over.judged ?? true, judgeCalibrated: false, repeats: 2, pairedCases: 56 },
  }) as unknown as BenchmarkReportView;

describe('number labels', () => {
  it('writes rates as percent and scores as plain numbers, with a decimal comma', () => {
    expect(levelLabel(0.7439, 'rate')).toBe('74,4%');
    expect(levelLabel(4.2619, 'score')).toBe('4,26');
    expect(levelLabel(null, 'rate')).toBe('—');
  });

  it('shows a difference with its sign, in points for rates, and a real minus sign', () => {
    expect(differenceLabel(0.009, 'rate')).toBe('+0,9 poin');
    expect(differenceLabel(-0.0634, 'rate')).toBe('−6,3 poin');
    expect(differenceLabel(-0.143, 'score')).toBe('−0,14');
    expect(differenceLabel(null, 'score')).toBe('—');
  });

  it('shows no sign for a difference that rounds to zero', () => {
    expect(differenceLabel(0.0001, 'rate')).toBe('0,0 poin');
    expect(differenceLabel(-0.0001, 'score')).toBe('0,00');
  });

  it('writes the interval from its lower to its upper end', () => {
    expect(intervalLabel({ lower: -0.077, upper: 0.077 }, 'rate')).toBe('−7,7 sampai +7,7');
    expect(intervalLabel({ lower: -0.313, upper: 0.018 }, 'score')).toBe('−0,31 sampai +0,02');
    expect(intervalLabel({ lower: null, upper: null }, 'rate')).toBe('—');
  });
});

describe('verdictOf', () => {
  it('only says better or worse when the whole interval is on one side of zero', () => {
    expect(verdictOf(difference({ lower: 0.01, upper: 0.08 }))).toBe('BETTER');
    expect(verdictOf(difference({ lower: -0.2, upper: -0.01 }))).toBe('WORSE');
  });

  it('says the difference is unproven when the interval contains zero, however the mean leans', () => {
    expect(verdictOf(difference({ diff: 0.04, lower: -0.01, upper: 0.09 }))).toBe('UNPROVEN');
    expect(verdictOf(difference({ lower: 0, upper: 0.05 }))).toBe('UNPROVEN');
  });

  it('has no verdict without paired cases or an interval', () => {
    expect(verdictOf(difference({ pairedCases: 0 }))).toBe('NO_DATA');
    expect(verdictOf(difference({ lower: null, upper: null }))).toBe('NO_DATA');
  });
});

describe('dimensionRows', () => {
  it('lists the three measured rates and the three judge scores in a fixed order', () => {
    expect(dimensionRows(report()).map((row) => row.id)).toEqual(['correctness', 'citation', 'safety', 'pedagogy', 'behavior', 'grounding']);
  });

  it('leaves out the judge scores when the run had no judge', () => {
    expect(dimensionRows(report({ judged: false })).map((row) => row.id)).toEqual(['correctness', 'citation', 'safety']);
  });

  it('marks judge rows as such and gives rates and scores their own kind', () => {
    const rows = dimensionRows(report());

    expect(rows.filter((row) => row.judge).map((row) => row.kind)).toEqual(['score', 'score', 'score']);
    expect(rows.filter((row) => !row.judge).map((row) => row.kind)).toEqual(['rate', 'rate', 'rate']);
  });
});

describe('worseCases', () => {
  it('collects the cases that got worse, once each, with the dimensions they got worse in', () => {
    const result = worseCases(
      report({
        rates: { correctness: difference({ regressions: ['TC-07', 'TC-02'] }), citation: difference({ regressions: ['TC-02'] }) },
        scores: { pedagogy: difference({ regressions: ['TC-31'] }) },
        safetyRegressions: ['TC-39'],
      }),
    );

    expect(result).toEqual([
      { caseId: 'TC-02', dimensions: ['Ketepatan isi', 'Sitasi benar dan relevan'] },
      { caseId: 'TC-07', dimensions: ['Ketepatan isi'] },
      { caseId: 'TC-31', dimensions: ['Mutu pengajaran (juri AI)'] },
      { caseId: 'TC-39', dimensions: ['Keamanan'] },
    ]);
  });

  it('does not repeat the safety label for a case the rates already named', () => {
    expect(worseCases(report({ rates: { safety: difference({ regressions: ['TC-39'] }) }, safetyRegressions: ['TC-39'] }))).toEqual([{ caseId: 'TC-39', dimensions: ['Keamanan'] }]);
  });

  it('is empty when nothing got worse', () => {
    expect(worseCases(report())).toEqual([]);
  });
});

describe('run state', () => {
  it('computes progress from calls done and stays inside 0 to 100', () => {
    expect(progressPercent({ done: 56, total: 224 })).toBe(25);
    expect(progressPercent({ done: 0, total: 0 })).toBe(0);
    expect(progressPercent({ done: 300, total: 224 })).toBe(100);
  });

  it('knows a run is still working while it is queued or running', () => {
    expect(hasActiveRun([{ status: 'COMPLETED' }, { status: 'QUEUED' }])).toBe(true);
    expect(hasActiveRun([{ status: 'RUNNING' }])).toBe(true);
    expect(hasActiveRun([{ status: 'COMPLETED' }, { status: 'FAILED' }])).toBe(false);
    expect(hasActiveRun([])).toBe(false);
  });

  it('allows a decision only once, on a completed run', () => {
    expect(canDecide({ status: 'COMPLETED', decision: 'PENDING' })).toBe(true);
    expect(canDecide({ status: 'COMPLETED', decision: 'ACCEPTED' })).toBe(false);
    expect(canDecide({ status: 'RUNNING', decision: 'PENDING' })).toBe(false);
    expect(canDecide({ status: 'FAILED', decision: 'PENDING' })).toBe(false);
  });

  it('offers a proposal only from a completed run on the development set', () => {
    expect(canProposeFrom({ status: 'COMPLETED', datasetRole: 'DEVELOPMENT' })).toBe(true);
    expect(canProposeFrom({ status: 'COMPLETED', datasetRole: 'BENCHMARK' })).toBe(false);
    expect(canProposeFrom({ status: 'RUNNING', datasetRole: 'DEVELOPMENT' })).toBe(false);
  });

  it('titles a run by its candidate, or says the baseline ran against itself', () => {
    expect(runTitle({ baseline: 'tutor-chat-builtin-3', candidate: 'tutor-chat@2', identicalArms: false })).toBe('tutor-chat@2 melawan tutor-chat-builtin-3');
    expect(runTitle({ baseline: 'tutor-chat-builtin-3', candidate: 'tutor-chat-builtin-3 (repeat)', identicalArms: true })).toBe('tutor-chat-builtin-3 melawan dirinya sendiri');
  });
});

describe('decisionProblem', () => {
  it('matches the length rules of the API', () => {
    expect(decisionProblem('')).toMatch(/wajib diisi/);
    expect(decisionProblem('x'.repeat(DECISION_MIN - 1))).toMatch(/terlalu pendek/);
    expect(decisionProblem('x'.repeat(DECISION_MIN))).toBeNull();
    expect(decisionProblem('x'.repeat(DECISION_MAX))).toBeNull();
    expect(decisionProblem('x'.repeat(DECISION_MAX + 1))).toMatch(/terlalu panjang/);
  });

  it('counts the trimmed text', () => {
    expect(decisionProblem(`   ${'x'.repeat(DECISION_MIN - 1)}   `)).toMatch(/terlalu pendek/);
  });
});

describe('labels', () => {
  it('names both datasets and says which one the proposer may read', () => {
    expect(DATASET_OPTIONS.map((option) => option.value)).toEqual(['tutor-chat-benchmark-v1', 'tutor-chat-dev-v1']);
    expect(DATASET_OPTIONS[0].hint).toMatch(/tidak pernah dilihat AI/);
    expect(datasetRoleLabel('DEVELOPMENT')).toBe('Set pengembangan');
    expect(datasetRoleLabel('BENCHMARK')).toBe('Benchmark penilai');
  });

  it('names the new gate criteria and the states of a run in Indonesian', () => {
    for (const id of ['offline_correctness', 'offline_citation_faithfulness', 'offline_safety', 'offline_pedagogy_judge', 'judge_calibration']) {
      expect(gateLabel(id)).not.toBe(id);
    }
    expect(statusMeta('benchmark', 'RUNNING')).toEqual({ label: 'Berjalan', tone: 'info' });
    expect(statusMeta('benchmark', 'FAILED').tone).toBe('error');
  });

  it('keeps the caveats the owner must read: noise, the development set, the uncalibrated judge, the single author', () => {
    expect(Object.keys(CAVEATS)).toEqual(['identical', 'development', 'judge', 'authorDraft']);
    expect(CAVEATS.judge).toMatch(/belum dikalibrasi/);
  });
});
