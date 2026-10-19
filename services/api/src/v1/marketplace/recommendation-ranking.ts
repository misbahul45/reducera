import { ClassDifficulty } from '@prisma/client';

export const RECOMMENDATION_VERSION = 'reco-v1';

export const WEAK_BASE_PRIORITY = 0.6;
export const WEAK_SPAN = 0.4;
export const NEXT_PRIORITY = 0.9;
export const DUE_PRIORITY = 0.55;
export const READY_PRIORITY = 0.4;
export const EXTRA_CONCEPT_BONUS = 0.1;
export const EXTRA_CONCEPT_BONUS_CAP = 0.2;
export const FREE_TIE_BREAK = 0.02;
export const RECENCY_TIE_BREAK = 0.03;
export const RECENCY_WINDOW_DAYS = 90;
export const MAX_NEEDS = 12;

export type NeedKind = 'WEAK' | 'NEXT' | 'DUE' | 'READY';

export interface LearnerNeed {
  conceptId: string;
  title: string;
  kind: NeedKind;
  priority: number;
  score: number | null;
}

export interface ConceptMastery {
  conceptId: string;
  title: string;
  score: number;
  evidenceCount: number;
  passed: boolean;
}

export interface NeedInputs {
  mastery: readonly ConceptMastery[];
  nextConceptId: string | null;
  dueConceptIds: readonly string[];
  readyConcepts: ReadonlyArray<{ conceptId: string; title: string }>;
}

export interface ProductForRanking {
  kind: 'article' | 'class';
  id: string;
  conceptIds: readonly string[];
  difficulty: ClassDifficulty | null;
  free: boolean;
  publishedAt: Date | null;
}

export type DifficultyFit = 'MATCH' | 'NEAR' | 'FAR' | 'NOT_APPLICABLE';

export interface MatchedConcept {
  conceptId: string;
  title: string;
  kind: NeedKind;
  score: number | null;
}

export interface RankedProduct {
  kind: 'article' | 'class';
  id: string;
  score: number;
  matched: MatchedConcept[];
  difficultyFit: DifficultyFit;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DIFFICULTY_RANK: Record<ClassDifficulty, number> = { BEGINNER: 0, INTERMEDIATE: 1, ADVANCED: 2 };
const FIT_FACTOR: Record<DifficultyFit, number> = { MATCH: 1, NEAR: 0.8, FAR: 0.5, NOT_APPLICABLE: 1 };

export const difficultyForScore = (score: number | null): ClassDifficulty => {
  if (score === null || score < 0.4) return ClassDifficulty.BEGINNER;
  if (score < 0.75) return ClassDifficulty.INTERMEDIATE;
  return ClassDifficulty.ADVANCED;
};

export function learnerNeeds(inputs: NeedInputs): LearnerNeed[] {
  const needs = new Map<string, LearnerNeed>();
  const offer = (need: LearnerNeed) => {
    const known = needs.get(need.conceptId);
    if (!known || need.priority > known.priority) needs.set(need.conceptId, need);
  };
  const titleOf = new Map(inputs.mastery.map((entry) => [entry.conceptId, entry.title]));
  const scoreOf = new Map(inputs.mastery.map((entry) => [entry.conceptId, entry.score]));

  for (const entry of inputs.mastery) {
    if (entry.evidenceCount > 0 && !entry.passed) {
      offer({ conceptId: entry.conceptId, title: entry.title, kind: 'WEAK', score: entry.score, priority: WEAK_BASE_PRIORITY + WEAK_SPAN * (1 - entry.score) });
    }
  }

  for (const conceptId of inputs.dueConceptIds) {
    offer({ conceptId, title: titleOf.get(conceptId) ?? conceptId, kind: 'DUE', score: scoreOf.get(conceptId) ?? null, priority: DUE_PRIORITY });
  }

  if (inputs.nextConceptId !== null) {
    const practised = needs.get(inputs.nextConceptId);
    if (practised?.kind === 'WEAK') {
      needs.set(practised.conceptId, { ...practised, priority: Math.max(practised.priority, NEXT_PRIORITY) });
    } else {
      const title = titleOf.get(inputs.nextConceptId) ?? inputs.readyConcepts.find((ready) => ready.conceptId === inputs.nextConceptId)?.title ?? inputs.nextConceptId;
      offer({ conceptId: inputs.nextConceptId, title, kind: 'NEXT', score: scoreOf.get(inputs.nextConceptId) ?? null, priority: NEXT_PRIORITY });
    }
  }

  for (const ready of inputs.readyConcepts) {
    offer({ conceptId: ready.conceptId, title: ready.title, kind: 'READY', score: null, priority: READY_PRIORITY });
  }

  return [...needs.values()].sort((a, b) => b.priority - a.priority || a.conceptId.localeCompare(b.conceptId)).slice(0, MAX_NEEDS);
}

const fitOf = (product: ProductForRanking, matched: readonly MatchedConcept[]): DifficultyFit => {
  if (product.difficulty === null || matched.length === 0) return 'NOT_APPLICABLE';
  const lead = matched[0];
  const gap = Math.abs(DIFFICULTY_RANK[product.difficulty] - DIFFICULTY_RANK[difficultyForScore(lead.score)]);
  return gap === 0 ? 'MATCH' : gap === 1 ? 'NEAR' : 'FAR';
};

const recency = (publishedAt: Date | null, now: Date): number => {
  if (publishedAt === null) return 0;
  const days = (now.getTime() - publishedAt.getTime()) / DAY_MS;
  return RECENCY_TIE_BREAK * Math.max(0, Math.min(1, 1 - days / RECENCY_WINDOW_DAYS));
};

export function rankProducts(needs: readonly LearnerNeed[], products: readonly ProductForRanking[], now: Date): RankedProduct[] {
  const byConcept = new Map(needs.map((need) => [need.conceptId, need]));

  const ranked = products.flatMap((product): RankedProduct[] => {
    const matched = [...new Set(product.conceptIds)]
      .flatMap((conceptId) => {
        const need = byConcept.get(conceptId);
        return need ? [{ conceptId, title: need.title, kind: need.kind, score: need.score, priority: need.priority }] : [];
      })
      .sort((a, b) => b.priority - a.priority || a.conceptId.localeCompare(b.conceptId));
    if (matched.length === 0) return [];

    const relevance = Math.min(1, matched[0].priority + Math.min(EXTRA_CONCEPT_BONUS_CAP, EXTRA_CONCEPT_BONUS * (matched.length - 1)));
    const exposed = matched.map(({ conceptId, title, kind, score }) => ({ conceptId, title, kind, score }));
    const difficultyFit = fitOf(product, exposed);
    const score = relevance * FIT_FACTOR[difficultyFit] + (product.free ? FREE_TIE_BREAK : 0) + recency(product.publishedAt, now);

    return [{ kind: product.kind, id: product.id, score, matched: exposed, difficultyFit }];
  });

  return ranked.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

const percent = (score: number): number => Math.round(score * 100);

export function reasonFor(ranked: Pick<RankedProduct, 'matched'>): string {
  const lead = ranked.matched[0];
  const extra = ranked.matched.length - 1;
  const tail = extra > 0 ? ` dan ${extra} konsep lain yang kamu butuhkan` : '';
  switch (lead.kind) {
    case 'WEAK':
      return `Membahas "${lead.title}", penguasaanmu baru ${percent(lead.score ?? 0)}%${tail}.`;
    case 'NEXT':
      return `Membahas "${lead.title}", konsep berikutnya di jalur belajarmu${tail}.`;
    case 'DUE':
      return `Membahas "${lead.title}", waktunya kamu mengulang${tail}.`;
    case 'READY':
      return `Membahas "${lead.title}", siap kamu pelajari${tail}.`;
  }
}
