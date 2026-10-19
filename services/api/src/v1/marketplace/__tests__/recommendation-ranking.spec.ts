import { ClassDifficulty } from '@prisma/client';
import {
  EXTRA_CONCEPT_BONUS,
  EXTRA_CONCEPT_BONUS_CAP,
  FREE_TIE_BREAK,
  LearnerNeed,
  MAX_NEEDS,
  NEXT_PRIORITY,
  NeedInputs,
  ProductForRanking,
  READY_PRIORITY,
  WEAK_BASE_PRIORITY,
  difficultyForScore,
  learnerNeeds,
  rankProducts,
  reasonFor,
} from '../recommendation-ranking';

const NOW = new Date('2026-10-16T00:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

const mastery = (conceptId: string, score: number, evidenceCount = 3, passed = score >= 0.7) => ({
  conceptId,
  title: `Judul ${conceptId}`,
  score,
  evidenceCount,
  passed,
});

const inputs = (overrides: Partial<NeedInputs> = {}): NeedInputs => ({ mastery: [], nextConceptId: null, dueConceptIds: [], readyConcepts: [], ...overrides });

const product = (id: string, conceptIds: string[], overrides: Partial<ProductForRanking> = {}): ProductForRanking => ({
  kind: 'article',
  id,
  conceptIds,
  difficulty: null,
  free: false,
  publishedAt: null,
  ...overrides,
});

describe('difficultyForScore', () => {
  it.each([
    [null, ClassDifficulty.BEGINNER],
    [0, ClassDifficulty.BEGINNER],
    [0.39, ClassDifficulty.BEGINNER],
    [0.4, ClassDifficulty.INTERMEDIATE],
    [0.74, ClassDifficulty.INTERMEDIATE],
    [0.75, ClassDifficulty.ADVANCED],
    [1, ClassDifficulty.ADVANCED],
  ])('maps %s to %s', (score, expected) => {
    expect(difficultyForScore(score)).toBe(expected);
  });
});

describe('learnerNeeds', () => {
  it('has no needs for a learner without a path', () => {
    expect(learnerNeeds(inputs())).toEqual([]);
  });

  it('treats a started concept that is not passed as weak and scales priority with how weak it is', () => {
    const needs = learnerNeeds(inputs({ mastery: [mastery('a', 0.2), mastery('b', 0.6)] }));

    expect(needs.map((need) => [need.conceptId, need.kind])).toEqual([
      ['a', 'WEAK'],
      ['b', 'WEAK'],
    ]);
    expect(needs[0].priority).toBeCloseTo(WEAK_BASE_PRIORITY + 0.4 * 0.8, 10);
    expect(needs[0].priority).toBeGreaterThan(needs[1].priority);
    expect(needs[0]).toMatchObject({ title: 'Judul a', score: 0.2 });
  });

  it('does not call a passed concept weak and ignores a concept without evidence', () => {
    const needs = learnerNeeds(inputs({ mastery: [mastery('passed', 0.9), mastery('unseen', 0.5, 0, false)] }));

    expect(needs).toEqual([]);
  });

  it('puts the next concept above a mildly weak one', () => {
    const needs = learnerNeeds(inputs({ mastery: [mastery('weak', 0.6)], nextConceptId: 'next' , readyConcepts: [{ conceptId: 'next', title: 'Berikutnya' }] }));

    expect(needs[0]).toMatchObject({ conceptId: 'next', kind: 'NEXT', priority: NEXT_PRIORITY, title: 'Berikutnya' });
  });

  it('lets a very weak concept beat the next concept', () => {
    const needs = learnerNeeds(inputs({ mastery: [mastery('weak', 0.05)], nextConceptId: 'next', readyConcepts: [{ conceptId: 'next', title: 'N' }] }));

    expect(needs[0].conceptId).toBe('weak');
  });

  it('explains the concept being practised by its score while ranking it as the next concept', () => {
    const needs = learnerNeeds(inputs({ mastery: [mastery('x', 0.5)], nextConceptId: 'x' }));

    expect(needs).toHaveLength(1);
    expect(needs[0]).toMatchObject({ conceptId: 'x', kind: 'WEAK', score: 0.5, priority: NEXT_PRIORITY });
  });

  it('keeps a weak concept above the next-concept priority when it is weaker than that', () => {
    const needs = learnerNeeds(inputs({ mastery: [mastery('x', 0.05)], nextConceptId: 'x' }));

    expect(needs[0].priority).toBeCloseTo(WEAK_BASE_PRIORITY + 0.4 * 0.95, 10);
  });

  it('keeps the strongest reason when one concept is both weak and due', () => {
    const needs = learnerNeeds(inputs({ mastery: [mastery('x', 0.3)], dueConceptIds: ['x'] }));

    expect(needs).toHaveLength(1);
    expect(needs[0].kind).toBe('WEAK');
  });

  it('flags a passed concept that is due for review', () => {
    const needs = learnerNeeds(inputs({ mastery: [mastery('old', 0.85)], dueConceptIds: ['old'] }));

    expect(needs[0]).toMatchObject({ conceptId: 'old', kind: 'DUE', score: 0.85 });
  });

  it('offers concepts that are ready to start at the lowest priority', () => {
    const needs = learnerNeeds(inputs({ readyConcepts: [{ conceptId: 'r', title: 'Siap' }] }));

    expect(needs[0]).toMatchObject({ conceptId: 'r', kind: 'READY', priority: READY_PRIORITY, score: null });
  });

  it('is capped and ordered by priority, ties broken by id', () => {
    const ready = Array.from({ length: MAX_NEEDS + 5 }, (_, index) => ({ conceptId: `r${String(index).padStart(2, '0')}`, title: 'R' }));

    const needs = learnerNeeds(inputs({ readyConcepts: ready }));

    expect(needs).toHaveLength(MAX_NEEDS);
    expect(needs.map((need) => need.conceptId)).toEqual([...needs.map((need) => need.conceptId)].sort());
  });
});

describe('rankProducts', () => {
  const needs: LearnerNeed[] = [
    { conceptId: 'weak', title: 'Jurnal penyesuaian', kind: 'WEAK', priority: 0.9, score: 0.25 },
    { conceptId: 'next', title: 'Neraca saldo', kind: 'NEXT', priority: NEXT_PRIORITY, score: null },
    { conceptId: 'ready', title: 'Laporan laba rugi', kind: 'READY', priority: READY_PRIORITY, score: null },
  ];

  it('leaves out a product that covers none of the needs, however cheap or new', () => {
    const ranked = rankProducts(needs, [product('off-topic', ['other'], { free: true, publishedAt: NOW })], NOW);

    expect(ranked).toEqual([]);
  });

  it('puts a product that covers the neediest concept first', () => {
    const ranked = rankProducts(needs, [product('a', ['ready']), product('b', ['weak']), product('c', ['next'])], NOW);

    expect(ranked.map((item) => item.id)).toEqual(['b', 'c', 'a']);
  });

  it('lets learning relevance win over price and recency (a paid, relevant product beats a free, new, less relevant one)', () => {
    const ranked = rankProducts(
      needs,
      [product('free-new', ['ready'], { free: true, publishedAt: NOW }), product('paid-old', ['weak'], { free: false, publishedAt: new Date(NOW.getTime() - 400 * DAY_MS) })],
      NOW,
    );

    expect(ranked[0].id).toBe('paid-old');
  });

  it('adds a small bonus for every extra need a product covers, up to a cap', () => {
    const evenNeeds: LearnerNeed[] = ['r1', 'r2', 'r3', 'r4'].map((conceptId) => ({ conceptId, title: conceptId, kind: 'READY', priority: READY_PRIORITY, score: null }));

    const score = (conceptIds: string[]) => rankProducts(evenNeeds, [product('p', conceptIds)], NOW)[0].score;

    expect(score(['r1'])).toBeCloseTo(READY_PRIORITY, 10);
    expect(score(['r1', 'r2'])).toBeCloseTo(READY_PRIORITY + EXTRA_CONCEPT_BONUS, 10);
    expect(score(['r1', 'r2', 'r3'])).toBeCloseTo(READY_PRIORITY + EXTRA_CONCEPT_BONUS_CAP, 10);
    expect(score(['r1', 'r2', 'r3', 'r4'])).toBeCloseTo(READY_PRIORITY + EXTRA_CONCEPT_BONUS_CAP, 10);
  });

  it('exposes the matched concepts, strongest need first, with the title and score of the learner', () => {
    const [item] = rankProducts(needs, [product('p', ['ready', 'weak'])], NOW);

    expect(item.matched.map((concept) => [concept.conceptId, concept.kind, concept.title, concept.score])).toEqual([
      ['weak', 'WEAK', 'Jurnal penyesuaian', 0.25],
      ['ready', 'READY', 'Laporan laba rugi', null],
    ]);
  });

  it('does not count the same concept twice', () => {
    const [item] = rankProducts(needs, [product('p', ['weak', 'weak'])], NOW);

    expect(item.matched.map((concept) => concept.conceptId)).toEqual(['weak']);
  });

  it('prefers a class at the level the learner is ready for', () => {
    const ranked = rankProducts(
      needs,
      [
        product('too-hard', ['weak'], { kind: 'class', difficulty: ClassDifficulty.ADVANCED }),
        product('fits', ['weak'], { kind: 'class', difficulty: ClassDifficulty.BEGINNER }),
        product('near', ['weak'], { kind: 'class', difficulty: ClassDifficulty.INTERMEDIATE }),
      ],
      NOW,
    );

    expect(ranked.map((item) => [item.id, item.difficultyFit])).toEqual([
      ['fits', 'MATCH'],
      ['near', 'NEAR'],
      ['too-hard', 'FAR'],
    ]);
  });

  it('does not judge the level of an article', () => {
    const [item] = rankProducts(needs, [product('a', ['weak'])], NOW);

    expect(item.difficultyFit).toBe('NOT_APPLICABLE');
  });

  it('breaks an exact tie toward the free product and then by id', () => {
    const ranked = rankProducts(needs, [product('b-paid', ['next']), product('a-paid', ['next']), product('c-free', ['next'], { free: true })], NOW);

    expect(ranked.map((item) => item.id)).toEqual(['c-free', 'a-paid', 'b-paid']);
    expect(ranked[0].score - ranked[1].score).toBeCloseTo(FREE_TIE_BREAK, 10);
  });

  it('prefers the newer product only as a small tie breaker', () => {
    const ranked = rankProducts(needs, [product('old', ['next'], { publishedAt: new Date(NOW.getTime() - 120 * DAY_MS) }), product('new', ['next'], { publishedAt: NOW })], NOW);

    expect(ranked.map((item) => item.id)).toEqual(['new', 'old']);
    expect(ranked[0].score - ranked[1].score).toBeLessThanOrEqual(0.03 + 1e-9);
  });

  it('caps relevance at one however many needs a product covers', () => {
    const [item] = rankProducts(needs, [product('p', ['weak', 'next', 'ready'])], NOW);

    expect(item.score).toBeCloseTo(1, 10);
  });

  it('is deterministic for the same input', () => {
    const products = [product('b', ['weak']), product('a', ['weak'])];

    expect(rankProducts(needs, products, NOW)).toEqual(rankProducts(needs, [...products].reverse(), NOW));
  });
});

describe('reasonFor', () => {
  const matched = (kind: 'WEAK' | 'NEXT' | 'DUE' | 'READY', score: number | null = null) => [{ conceptId: 'c', title: 'Jurnal penyesuaian', kind, score }];

  it('quotes the weak concept and the learner own score', () => {
    expect(reasonFor({ matched: matched('WEAK', 0.384) })).toBe('Membahas "Jurnal penyesuaian", penguasaanmu baru 38%.');
  });

  it.each([
    ['NEXT', 'Membahas "Jurnal penyesuaian", konsep berikutnya di jalur belajarmu.'],
    ['DUE', 'Membahas "Jurnal penyesuaian", waktunya kamu mengulang.'],
    ['READY', 'Membahas "Jurnal penyesuaian", siap kamu pelajari.'],
  ] as const)('explains a %s match', (kind, expected) => {
    expect(reasonFor({ matched: matched(kind) })).toBe(expected);
  });

  it('mentions how many more needs the product covers', () => {
    const reason = reasonFor({ matched: [...matched('WEAK', 0.2), { conceptId: 'd', title: 'Lain', kind: 'NEXT', score: null }, { conceptId: 'e', title: 'Lagi', kind: 'READY', score: null }] });

    expect(reason).toBe('Membahas "Jurnal penyesuaian", penguasaanmu baru 20% dan 2 konsep lain yang kamu butuhkan.');
  });

  it('never claims anything the data does not show', () => {
    const reason = reasonFor({ matched: matched('NEXT') });

    expect(reason).not.toMatch(/\bAI\b|populer|magic/i);
  });
});
