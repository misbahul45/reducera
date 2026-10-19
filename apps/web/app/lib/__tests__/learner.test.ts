import { describe, expect, it } from 'vitest';
import { nextConceptCopy, strategyEvidenceCopy, strategyLabel, strategyReasons, type NextConceptView } from '~/lib/learner';

const view = (overrides: Partial<NextConceptView> = {}): NextConceptView => ({
  conceptId: 'c1',
  level: 1,
  reasonCodes: ['PREREQUISITES_MET'],
  concept: { id: 'c1', title: 'Persamaan Akuntansi', level: 1 },
  ...overrides,
});

describe('nextConceptCopy', () => {
  it('names the concept and explains why in plain Indonesian', () => {
    const copy = nextConceptCopy(view());

    expect(copy.title).toBe('Persamaan Akuntansi');
    expect(copy.reason).toBe('Prasyaratmu sudah terpenuhi, saatnya konsep ini.');
    expect(copy.done).toBe(false);
  });

  it('has a reason for every code the api can return', () => {
    for (const code of ['NO_CONCEPTS', 'NO_EVIDENCE_START', 'PREREQUISITES_MET', 'CONTINUE_PRACTICE', 'UNREACHABLE_PREREQUISITES', 'ALL_CONCEPTS_PASSED'] as const) {
      expect(nextConceptCopy(view({ reasonCodes: [code] })).reason.length).toBeGreaterThan(10);
    }
  });

  it('starts a new learner at the beginning', () => {
    expect(nextConceptCopy(view({ reasonCodes: ['NO_EVIDENCE_START'] })).reason).toBe('Mulai dari dasar, satu konsep dulu.');
  });

  it('celebrates when everything is passed and has no concept to continue with', () => {
    const copy = nextConceptCopy(view({ conceptId: null, level: null, concept: null, reasonCodes: ['ALL_CONCEPTS_PASSED'] }));

    expect(copy.done).toBe(true);
    expect(copy.title).toBe('Semua konsep sudah lulus');
  });

  it('is empty-safe when there are no concepts', () => {
    const copy = nextConceptCopy(view({ conceptId: null, level: null, concept: null, reasonCodes: ['NO_CONCEPTS'] }));

    expect(copy.done).toBe(false);
    expect(copy.title).toBe('Belum ada konsep');
  });

  it('uses the first reason code when there are several', () => {
    expect(nextConceptCopy(view({ reasonCodes: ['CONTINUE_PRACTICE', 'PREREQUISITES_MET'] })).reason).toBe('Kamu sedang di tengah konsep ini, lanjutkan latihannya.');
  });
});

describe('strategy copy', () => {
  it('names every strategy in Indonesian and falls back to the code', () => {
    expect(strategyLabel('GUIDED_EXAMPLE')).toBe('Contoh terpandu');
    expect(strategyLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW');
  });

  it('turns reason codes into sentences and drops the ones it does not know', () => {
    expect(strategyReasons(['MID_MASTERY', 'INSUFFICIENT_EVIDENCE', 'NOT_A_CODE'])).toEqual([
      'Penguasaanmu sedang, jadi kamu ikut mengerjakan sebagian.',
      'Bukti belajarmu masih sedikit, jadi keputusan ini masih awal.',
    ]);
  });

  it('explains how the learner can start generating evidence when there is none', () => {
    const copy = strategyEvidenceCopy({ strategies: [{ strategy: 'HINT', attempts: 0, successes: 0, averageDelta: 0, successRate: null }], preferredStrategy: null, totalAttempts: 0 });

    expect(copy.rows).toEqual([]);
    expect(copy.hint).toMatch(/kuis/);
  });

  it('lists only strategies with evidence, the preferred one first', () => {
    const copy = strategyEvidenceCopy({
      strategies: [
        { strategy: 'EXPLAIN', attempts: 4, successes: 1, averageDelta: -0.01, successRate: 0.25 },
        { strategy: 'SOCRATIC', attempts: 5, successes: 4, averageDelta: 0.07, successRate: 0.8 },
        { strategy: 'HINT', attempts: 0, successes: 0, averageDelta: 0, successRate: null },
      ],
      preferredStrategy: 'SOCRATIC',
      totalAttempts: 9,
    });

    expect(copy.rows.map((row) => [row.strategy, row.percent, row.preferred])).toEqual([
      ['SOCRATIC', 80, true],
      ['EXPLAIN', 25, false],
    ]);
    expect(copy.hint).toContain('Tanya jawab terarah');
  });

  it('says it is still collecting evidence before any strategy is preferred', () => {
    const copy = strategyEvidenceCopy({ strategies: [{ strategy: 'HINT', attempts: 1, successes: 1, averageDelta: 0.05, successRate: 1 }], preferredStrategy: null, totalAttempts: 1 });

    expect(copy.rows).toHaveLength(1);
    expect(copy.hint).toMatch(/mengumpulkan bukti/);
  });
});
