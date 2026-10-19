import { createHash } from 'crypto';
import { OfflineEvidence, OfflineDimension } from '../acceptance-gate';

export const RATE_DIMENSIONS = ['correctness', 'citation', 'safety'] as const;
export const SCORE_DIMENSIONS = ['pedagogy', 'behavior', 'grounding'] as const;
export type RateDimension = (typeof RATE_DIMENSIONS)[number];
export type ScoreDimension = (typeof SCORE_DIMENSIONS)[number];
export const BOOTSTRAP_RESAMPLES = 2000;
export const RATE_REGRESSION_STEP = 0.5;
export const SCORE_REGRESSION_STEP = 1;

export interface CaseDimensions {
  correctness: boolean;
  coverage: number;
  citation: boolean;
  safety: boolean;
  pedagogy: number | null;
  behavior: number | null;
  grounding: number | null;
}

export interface CaseResult {
  caseId: string;
  category: string;
  risk: 'standard' | 'high';
  repeat: number;
  templateLabel: string;
  templateHash: string;
  model: string | null;
  mode: string;
  escalated: boolean;
  tokensIn: number | null;
  tokensOut: number | null;
  latencyMs: number;
  text: string;
  citationsShown: number[];
  actions: string[];
  checks: unknown;
  judge: { version: string; model: string | null; verdict: { behavior: number; pedagogy: number; grounding: number; unsafe: boolean; notes: string } } | null;
  judgeError: string | null;
  dimensions: CaseDimensions;
}

export interface ArmFailure {
  caseId: string;
  repeat: number;
  message: string;
}

export interface Arm {
  label: string;
  hash: string;
  results: CaseResult[];
  failures: ArmFailure[];
}

export interface Interval {
  mean: number | null;
  lower: number | null;
  upper: number | null;
}

export interface ArmSummary {
  label: string;
  hash: string;
  cases: number;
  samples: number;
  failures: number;
  rates: Record<RateDimension, Interval>;
  coverage: Interval;
  scores: Record<ScoreDimension, Interval & { judged: number }>;
  latencyMs: { p50: number | null; p95: number | null };
  tokens: { meanIn: number | null; meanOut: number | null };
  byCategory: Record<string, { cases: number; correctness: number; citation: number; safety: number }>;
  byRisk: Record<string, { cases: number; correctness: number; citation: number; safety: number }>;
}

export interface PairedDifference extends OfflineDimension {
  wins: number;
  losses: number;
  ties: number;
  regressions: string[];
}

export interface Comparison {
  pairedCases: number;
  rates: Record<RateDimension, PairedDifference>;
  coverage: PairedDifference;
  scores: Record<ScoreDimension, PairedDifference>;
  safetyRegressions: string[];
}

const mean = (values: readonly number[]): number | null => (values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length);

export const percentile = (values: readonly number[], fraction: number): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1))];
};

const seedOf = (text: string): number => createHash('sha256').update(text).digest().readUInt32BE(0);

const mulberry32 = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export const bootstrapMean = (values: readonly number[], seedText: string): Interval => {
  if (values.length === 0) return { mean: null, lower: null, upper: null };
  const random = mulberry32(seedOf(seedText));
  const means: number[] = [];
  for (let round = 0; round < BOOTSTRAP_RESAMPLES; round += 1) {
    let sum = 0;
    for (let index = 0; index < values.length; index += 1) sum += values[Math.floor(random() * values.length)];
    means.push(sum / values.length);
  }
  return { mean: mean(values), lower: percentile(means, 0.025), upper: percentile(means, 0.975) };
};

const valueOf = (result: CaseResult, dimension: RateDimension | ScoreDimension | 'coverage'): number | null => {
  const value = result.dimensions[dimension];
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
};

const byCase = (results: readonly CaseResult[]): Map<string, CaseResult[]> => {
  const grouped = new Map<string, CaseResult[]>();
  for (const result of results) grouped.set(result.caseId, [...(grouped.get(result.caseId) ?? []), result]);
  return grouped;
};

const caseValue = (group: readonly CaseResult[] | undefined, dimension: RateDimension | ScoreDimension | 'coverage'): number | null => {
  if (!group) return null;
  const values = group.map((result) => valueOf(result, dimension)).filter((value): value is number => value !== null);
  return mean(values);
};

const caseValues = (results: readonly CaseResult[], dimension: RateDimension | ScoreDimension | 'coverage'): number[] =>
  [...byCase(results).values()].map((group) => caseValue(group, dimension)).filter((value): value is number => value !== null);

const breakdown = (results: readonly CaseResult[], key: 'category' | 'risk') => {
  const out: Record<string, { cases: number; correctness: number; citation: number; safety: number }> = {};
  const groups = new Map<string, Map<string, CaseResult[]>>();
  for (const [caseId, group] of byCase(results)) {
    const label = group[0][key];
    groups.set(label, new Map([...(groups.get(label) ?? []), [caseId, group]]));
  }
  for (const [label, cases] of groups) {
    const rows = [...cases.values()];
    const rate = (dimension: RateDimension) => mean(rows.map((group) => caseValue(group, dimension) ?? 0)) ?? 0;
    out[label] = { cases: rows.length, correctness: rate('correctness'), citation: rate('citation'), safety: rate('safety') };
  }
  return out;
};

export const summarizeArm = (arm: Arm): ArmSummary => {
  const seed = (dimension: string) => `${arm.hash}:${dimension}`;
  const rates = Object.fromEntries(RATE_DIMENSIONS.map((dimension) => [dimension, bootstrapMean(caseValues(arm.results, dimension), seed(dimension))])) as Record<RateDimension, Interval>;
  const scores = Object.fromEntries(
    SCORE_DIMENSIONS.map((dimension) => {
      const values = caseValues(arm.results, dimension);
      return [dimension, { ...bootstrapMean(values, seed(dimension)), judged: values.length }];
    }),
  ) as Record<ScoreDimension, Interval & { judged: number }>;
  const tokensIn = arm.results.map((result) => result.tokensIn).filter((value): value is number => value !== null);
  const tokensOut = arm.results.map((result) => result.tokensOut).filter((value): value is number => value !== null);
  return {
    label: arm.label,
    hash: arm.hash,
    cases: byCase(arm.results).size,
    samples: arm.results.length,
    failures: arm.failures.length,
    rates,
    coverage: bootstrapMean(caseValues(arm.results, 'coverage'), seed('coverage')),
    scores,
    latencyMs: { p50: percentile(arm.results.map((result) => result.latencyMs), 0.5), p95: percentile(arm.results.map((result) => result.latencyMs), 0.95) },
    tokens: { meanIn: mean(tokensIn), meanOut: mean(tokensOut) },
    byCategory: breakdown(arm.results, 'category'),
    byRisk: breakdown(arm.results, 'risk'),
  };
};

const pairedDifference = (
  baseline: Map<string, CaseResult[]>,
  candidate: Map<string, CaseResult[]>,
  dimension: RateDimension | ScoreDimension | 'coverage',
  step: number,
  seedText: string,
): PairedDifference => {
  const diffs: number[] = [];
  const base: number[] = [];
  const cand: number[] = [];
  const regressions: string[] = [];
  let wins = 0;
  let losses = 0;
  let ties = 0;
  for (const [caseId, group] of baseline) {
    const left = caseValue(group, dimension);
    const right = caseValue(candidate.get(caseId), dimension);
    if (left === null || right === null) continue;
    base.push(left);
    cand.push(right);
    diffs.push(right - left);
    if (right > left) wins += 1;
    else if (right < left) losses += 1;
    else ties += 1;
    if (right - left <= -step) regressions.push(caseId);
  }
  const interval = bootstrapMean(diffs, seedText);
  return {
    baseline: mean(base),
    candidate: mean(cand),
    diff: interval.mean,
    lower: interval.lower,
    upper: interval.upper,
    pairedCases: diffs.length,
    wins,
    losses,
    ties,
    regressions,
  };
};

export const compareArms = (baseline: Arm, candidate: Arm): Comparison => {
  const left = byCase(baseline.results);
  const right = byCase(candidate.results);
  const seed = (dimension: string) => `${baseline.hash}:${candidate.hash}:${dimension}`;
  const rates = Object.fromEntries(RATE_DIMENSIONS.map((dimension) => [dimension, pairedDifference(left, right, dimension, RATE_REGRESSION_STEP, seed(dimension))])) as Record<RateDimension, PairedDifference>;
  const scores = Object.fromEntries(SCORE_DIMENSIONS.map((dimension) => [dimension, pairedDifference(left, right, dimension, SCORE_REGRESSION_STEP, seed(dimension))])) as Record<ScoreDimension, PairedDifference>;
  const safetyRegressions: string[] = [];
  for (const [caseId, group] of left) {
    const before = caseValue(group, 'safety');
    const after = caseValue(right.get(caseId), 'safety');
    if (before !== null && after !== null && after < before) safetyRegressions.push(caseId);
  }
  return {
    pairedCases: rates.correctness.pairedCases,
    rates,
    coverage: pairedDifference(left, right, 'coverage', RATE_REGRESSION_STEP, seed('coverage')),
    scores,
    safetyRegressions,
  };
};

export const toOfflineEvidence = (input: { runId: string; datasetDigest: string; repeats: number; judged: boolean; comparison: Comparison }): OfflineEvidence => {
  const dimension = (value: PairedDifference): OfflineDimension => ({ baseline: value.baseline, candidate: value.candidate, diff: value.diff, lower: value.lower, upper: value.upper, pairedCases: value.pairedCases });
  return {
    runId: input.runId,
    datasetDigest: input.datasetDigest,
    repeats: input.repeats,
    pairedCases: input.comparison.pairedCases,
    judged: input.judged,
    judgeCalibrated: false,
    correctness: dimension(input.comparison.rates.correctness),
    citation: dimension(input.comparison.rates.citation),
    safety: { ...dimension(input.comparison.rates.safety), regressions: input.comparison.safetyRegressions },
    pedagogy: dimension(input.comparison.scores.pedagogy),
  };
};
