import { describe, expect, it } from 'vitest';
import type { CircularityMetric } from '~/interfaces/admin';
import {
  DEFAULT_WINDOW_DAYS,
  METRIC_DEFINITIONS,
  METRIC_ORDER,
  WINDOW_OPTIONS,
  formatShare,
  formatSigned,
  progressOf,
  requirements,
  stateMeta,
  valueRows,
  windowQuery,
} from '~/lib/circularity';

const metric = <T extends CircularityMetric['id']>(id: T, patch: Partial<CircularityMetric<T>> = {}): CircularityMetric<T> => ({
  id,
  state: 'NOT_ENOUGH_EVIDENCE',
  organic: { n: 0, learners: 0 },
  demo: { n: 0, learners: 0 },
  minimum: {},
  value: null,
  demoValue: null,
  ...patch,
});

describe('metric definitions', () => {
  it('cover the five metrics in a fixed order, each with a formula, its sources and its limits', () => {
    expect(METRIC_ORDER).toEqual(['MASTERY_CHANGE', 'REVIEW_OUTCOME', 'KNOWLEDGE_REUSE', 'CREATOR_CONVERSION', 'PROMPT_EVIDENCE']);
    for (const id of METRIC_ORDER) {
      const definition = METRIC_DEFINITIONS[id];
      expect(definition.title.length).toBeGreaterThan(10);
      expect(definition.formula.length).toBeGreaterThan(40);
      expect(definition.sources.length).toBeGreaterThan(10);
      expect(definition.limits.length).toBeGreaterThan(40);
    }
  });

  it('never presents the formulas as proof of cause or of retention', () => {
    expect(METRIC_DEFINITIONS.MASTERY_CHANGE.limits).toContain('bukan peningkatan belajar');
    expect(METRIC_DEFINITIONS.REVIEW_OUTCOME.limits).toContain('bukan bukti retensi');
    expect(METRIC_DEFINITIONS.KNOWLEDGE_REUSE.limits).toContain('tidak membuktikan');
  });
});

describe('formatting', () => {
  it('prints shares and signed changes with a decimal comma', () => {
    expect(formatShare(0.97)).toBe('97,0%');
    expect(formatShare(null)).toBe('—');
    expect(formatSigned(0.0315)).toBe('+0,032');
    expect(formatSigned(-0.02)).toBe('−0,020');
    expect(formatSigned(0)).toBe('0,000');
  });

  it('labels the two evidence states', () => {
    expect(stateMeta('OK')).toEqual({ label: 'Cukup bukti', tone: 'success' });
    expect(stateMeta('NOT_ENOUGH_EVIDENCE')).toEqual({ label: 'Belum cukup bukti', tone: 'warning' });
  });
});

describe('window', () => {
  it('offers 30, 90 and 365 days and starts from 30', () => {
    expect(WINDOW_OPTIONS.map((option) => option.days)).toEqual([30, 90, 365]);
    expect(DEFAULT_WINDOW_DAYS).toBe(30);
  });

  it('ends at the given instant and starts that many days earlier', () => {
    const now = new Date('2026-10-17T12:00:00.000Z');

    expect(windowQuery(30, now)).toEqual({ from: '2026-09-17T12:00:00.000Z', to: '2026-10-17T12:00:00.000Z' });
  });
});

describe('requirements', () => {
  it('compare organic evidence with the minimum of each metric', () => {
    const change = metric('MASTERY_CHANGE', { organic: { n: 12, learners: 4 }, minimum: { events: 30, learners: 10 } });
    const reuse = metric('KNOWLEDGE_REUSE', { organic: { n: 1, learners: 2 }, minimum: { products: 5 } });
    const conversion = metric('CREATOR_CONVERSION', { organic: { n: 3, learners: 3 }, minimum: { eligible: 20 } });

    expect(requirements(change).map((item) => [item.have, item.need])).toEqual([[12, 30], [4, 10]]);
    expect(requirements(reuse).map((item) => [item.have, item.need])).toEqual([[1, 5]]);
    expect(requirements(conversion).map((item) => [item.have, item.need])).toEqual([[3, 20]]);
  });

  it('reads the prompt requirement from the decided runs', () => {
    const prompt = metric('PROMPT_EVIDENCE', {
      minimum: { decidedRuns: 1 },
      value: {
        drafts: { aiProposed: 0, engineer: 0, byStatus: {} },
        benchmarkRuns: { completed: 6, candidateRuns: 4, identicalArmsRuns: 2, decided: 0, verdicts: {} },
        canariesStarted: 0,
        rollbacks: 0,
        strategyOutcomes: [],
      },
    });

    expect(requirements(prompt)).toEqual([{ label: 'Run dengan keputusan manusia', have: 0, need: 1 }]);
  });

  it('keeps progress between zero and one', () => {
    expect(progressOf({ label: 'a', have: 5, need: 20 })).toBe(0.25);
    expect(progressOf({ label: 'a', have: 40, need: 20 })).toBe(1);
    expect(progressOf({ label: 'a', have: 0, need: 0 })).toBe(1);
  });
});

describe('valueRows', () => {
  it('describes each value without inventing a figure', () => {
    expect(valueRows('MASTERY_CHANGE', { meanDelta: 0.032, medianDelta: 0.022, shareImproved: 0.97 }).map((row) => row.text)).toEqual(['+0,032', '+0,022', '97,0%']);

    const review = valueRows('REVIEW_OUTCOME', { dueEvents: 14, passed: 12, passRate: 0.8571, notDueEvents: 0, notDuePassRate: null });
    expect(review[1].text).toBe('12 dari 14 (85,7%)');
    expect(review[2].text).toBe('tidak ada kejadian');

    const reuse = valueRows('KNOWLEDGE_REUSE', {
      denominator: 1,
      numerator: 0,
      reuseRate: 0,
      products: [{ kind: 'class', id: 'p', title: 'Akuntansi Dasar untuk Pemula', holders: 1, qualifyingLearners: 1 }],
    });
    expect(reuse.at(-1)).toEqual({ label: 'Akuntansi Dasar untuk Pemula', text: '1 pemilik akses, 1 memenuhi syarat' });

    const conversion = valueRows('CREATOR_CONVERSION', {
      eligible: 1,
      converted: 1,
      conversion: 1,
      topics: [{ topicId: 't', title: 'Akuntansi Dasar — Golden Graph', concepts: 10, eligible: 1, converted: 1 }],
    });
    expect(conversion.at(-1)?.text).toBe('1 dari 1 (10 konsep)');
  });

  it('lists the prompt evidence as counts', () => {
    const rows = valueRows('PROMPT_EVIDENCE', {
      drafts: { aiProposed: 2, engineer: 2, byStatus: { REJECTED: 3, DRAFT: 1 } },
      benchmarkRuns: { completed: 6, candidateRuns: 4, identicalArmsRuns: 2, decided: 0, verdicts: {} },
      canariesStarted: 0,
      rollbacks: 0,
      strategyOutcomes: [{ promptVersion: 'tutor-chat-builtin-4', n: 1, successes: 1 }],
    });

    expect(rows.map((row) => row.text)).toEqual([
      '2 dari AI, 2 dari insinyur',
      '3 ditolak, 1 draf',
      '6 (4 kandidat, 2 dasar melawan dirinya)',
      '0',
      '0, 0',
      '1 naik dari 1',
    ]);
  });
});
