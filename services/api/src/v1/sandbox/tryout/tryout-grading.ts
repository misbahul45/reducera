import { SUBTEST_KEYS, SubtestKey, TryoutItem, TryoutItemView } from './tryout-types';

export const WEAK_CONCEPT_PERCENT = 60;
export const WEAK_CONCEPT_MIN_ITEMS = 2;
export const MIN_ANSWERED_FOR_EVIDENCE = 0.5;
export const MIN_ITEMS_FOR_EVIDENCE = 2;

export type AnswerMap = Record<string, number>;

export interface SubtestResult {
  key: SubtestKey;
  title: string;
  total: number;
  answered: number;
  correct: number;
  percent: number;
}

export interface ConceptResult {
  conceptId: string;
  title: string;
  total: number;
  correct: number;
  percent: number;
}

export interface ReviewItem extends TryoutItemView {
  chosen: number | null;
  answer: number;
  correct: boolean;
  explanation: string;
}

export interface TryoutResult {
  total: number;
  answered: number;
  correct: number;
  percent: number;
  usedSeconds: number;
  durationSeconds: number;
  timedOut: boolean;
  subtests: SubtestResult[];
  concepts: ConceptResult[];
  weakConceptIds: string[];
  review: ReviewItem[];
}

export const percentOf = (part: number, whole: number): number => (whole === 0 ? 0 : Math.round((part / whole) * 1000) / 10);

export const publicItem = (item: TryoutItem): TryoutItemView => {
  const { answer: _answer, explanation: _explanation, ...view } = item;
  return view;
};

export interface GradeInput {
  items: TryoutItem[];
  answers: AnswerMap;
  startedAt: Date;
  submittedAt: Date;
  durationSeconds: number;
  subtestTitles: Record<SubtestKey, string>;
  conceptTitles: Record<string, string>;
}

export const gradeSession = (input: GradeInput): TryoutResult => {
  const { items, answers } = input;
  const review: ReviewItem[] = items.map((item) => {
    const chosen = Number.isInteger(answers[item.id]) ? answers[item.id] : null;
    return { ...publicItem(item), chosen, answer: item.answer, correct: chosen === item.answer, explanation: item.explanation };
  });

  const subtests: SubtestResult[] = SUBTEST_KEYS.flatMap((key) => {
    const rows = review.filter((item) => item.subtest === key);
    if (rows.length === 0) return [];
    const correct = rows.filter((row) => row.correct).length;
    return [{ key, title: input.subtestTitles[key], total: rows.length, answered: rows.filter((row) => row.chosen !== null).length, correct, percent: percentOf(correct, rows.length) }];
  });

  const conceptIds = [...new Set(review.map((item) => item.conceptId))];
  const concepts: ConceptResult[] = conceptIds.map((conceptId) => {
    const rows = review.filter((item) => item.conceptId === conceptId);
    const correct = rows.filter((row) => row.correct).length;
    return { conceptId, title: input.conceptTitles[conceptId] ?? conceptId, total: rows.length, correct, percent: percentOf(correct, rows.length) };
  });

  const correct = review.filter((item) => item.correct).length;
  const elapsed = Math.max(0, Math.round((input.submittedAt.getTime() - input.startedAt.getTime()) / 1000));
  return {
    total: review.length,
    answered: review.filter((item) => item.chosen !== null).length,
    correct,
    percent: percentOf(correct, review.length),
    usedSeconds: Math.min(elapsed, input.durationSeconds),
    durationSeconds: input.durationSeconds,
    timedOut: elapsed > input.durationSeconds,
    subtests,
    concepts,
    weakConceptIds: concepts
      .filter((concept) => concept.total >= WEAK_CONCEPT_MIN_ITEMS && concept.percent < WEAK_CONCEPT_PERCENT)
      .sort((a, b) => a.percent - b.percent)
      .map((concept) => concept.conceptId),
    review,
  };
};
