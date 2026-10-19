import { PASS_SCORE } from '../policy/learner-policy.service';

export const REVIEW_MODEL_VERSION = 'review-v1';

export const DUE_RETRIEVABILITY = 0.7;
export const MAX_INTERVAL_DAYS = 60;
export const UPCOMING_WINDOW_DAYS = 7;
export const SESSION_MAX_CONCEPTS = 3;
export const SESSION_QUESTIONS_PER_CONCEPT = 3;
export const SESSION_SECONDS_PER_QUESTION = 40;

const DAY_MS = 24 * 60 * 60 * 1000;
const BASE_STABILITY_DAYS = 1.5;
const EVIDENCE_PER_DOUBLING = 2;
const EVIDENCE_CAP = 12;
const SCORE_FACTOR_FLOOR = 0.5;

export type ReviewKind = 'REVIEW' | 'RELEARN';

export interface ReviewInput {
  conceptId: string;
  score: number;
  evidenceCount: number;
  lastEventAt: Date | null;
}

export interface ReviewItem {
  conceptId: string;
  kind: ReviewKind;
  score: number;
  evidenceCount: number;
  daysSince: number;
  stabilityDays: number;
  intervalDays: number;
  retrievability: number;
  dueAt: Date;
  overdueDays: number;
  due: boolean;
}

export interface ReviewQueue {
  due: ReviewItem[];
  upcoming: ReviewItem[];
}

export interface ReviewSessionPlan {
  conceptIds: string[];
  questionsPerConcept: number;
  totalQuestions: number;
  estimatedMinutes: number;
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

export const stabilityDays = (evidenceCount: number, score: number): number =>
  BASE_STABILITY_DAYS * 2 ** (Math.min(Math.max(evidenceCount, 0), EVIDENCE_CAP) / EVIDENCE_PER_DOUBLING) * (SCORE_FACTOR_FLOOR + clamp01(score));

export const retrievability = (daysSince: number, stability: number): number => Math.exp(-Math.max(0, daysSince) / stability);

export const intervalDays = (stability: number): number => Math.min(MAX_INTERVAL_DAYS, -stability * Math.log(DUE_RETRIEVABILITY));

export const scheduleReview = (input: ReviewInput, now: Date): ReviewItem | null => {
  if (input.evidenceCount <= 0 || input.lastEventAt === null) return null;

  const stability = stabilityDays(input.evidenceCount, input.score);
  const interval = intervalDays(stability);
  const daysSince = Math.max(0, (now.getTime() - input.lastEventAt.getTime()) / DAY_MS);
  const dueAt = new Date(input.lastEventAt.getTime() + interval * DAY_MS);

  return {
    conceptId: input.conceptId,
    kind: input.score >= PASS_SCORE ? 'REVIEW' : 'RELEARN',
    score: input.score,
    evidenceCount: input.evidenceCount,
    daysSince,
    stabilityDays: stability,
    intervalDays: interval,
    retrievability: retrievability(daysSince, stability),
    dueAt,
    overdueDays: Math.max(0, (now.getTime() - dueAt.getTime()) / DAY_MS),
    due: now.getTime() >= dueAt.getTime(),
  };
};

export const buildReviewQueue = (inputs: readonly ReviewInput[], now: Date): ReviewQueue => {
  const items = inputs.flatMap((input) => {
    const item = scheduleReview(input, now);
    return item === null ? [] : [item];
  });

  const due = items
    .filter((item) => item.due)
    .sort((a, b) => a.retrievability - b.retrievability || a.conceptId.localeCompare(b.conceptId));

  const windowEnd = now.getTime() + UPCOMING_WINDOW_DAYS * DAY_MS;
  const upcoming = items
    .filter((item) => !item.due && item.dueAt.getTime() <= windowEnd)
    .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime() || a.conceptId.localeCompare(b.conceptId));

  return { due, upcoming };
};

export const planReviewSession = (due: readonly ReviewItem[]): ReviewSessionPlan => {
  const conceptIds = due.slice(0, SESSION_MAX_CONCEPTS).map((item) => item.conceptId);
  const totalQuestions = conceptIds.length * SESSION_QUESTIONS_PER_CONCEPT;
  return {
    conceptIds,
    questionsPerConcept: SESSION_QUESTIONS_PER_CONCEPT,
    totalQuestions,
    estimatedMinutes: Math.ceil((totalQuestions * SESSION_SECONDS_PER_QUESTION) / 60),
  };
};
