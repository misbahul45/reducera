import { AppError, AppErrorCode } from '@/common/lib/error';

export interface PlacementQuestion {
  question: string;
  answer?: string | null;
}

export interface PlacementAnswer {
  question: string;
  userAnswer: string;
}

export type PlacementLevel = 'beginner' | 'intermediate' | 'advanced' | 'expert';

export interface PlacementGrade {
  attempt: { question: string; userAnswer: string; answer: string | null }[];
  result: { scores: Record<string, number>; level: PlacementLevel };
}

const SCORE_SCALE = 10;

const levelOf = (percentage: number): PlacementLevel => {
  if (percentage <= 50) return 'beginner';
  if (percentage <= 70) return 'intermediate';
  if (percentage <= 90) return 'advanced';
  return 'expert';
};

const incomplete = () => new AppError('Every question of the quiz must be answered exactly once', 400, AppErrorCode.VALIDATION_ERROR);

const answersByQuestion = (questions: PlacementQuestion[], answers: PlacementAnswer[]): Map<string, string> => {
  const known = new Set(questions.map((item) => item.question.trim()));
  const given = new Map<string, string>();
  for (const answer of answers) {
    const key = answer.question.trim();
    if (!known.has(key) || given.has(key)) throw incomplete();
    given.set(key, answer.userAnswer);
  }
  return given;
};

export const gradePlacement = (questions: PlacementQuestion[], answers: PlacementAnswer[]): PlacementGrade => {
  if (questions.length === 0) {
    throw new AppError('The quiz has no questions', 422, AppErrorCode.VALIDATION_ERROR);
  }
  const given = answersByQuestion(questions, answers);

  const attempt: PlacementGrade['attempt'] = [];
  const scores: Record<string, number> = {};
  let correct = 0;
  for (const item of questions) {
    const userAnswer = given.get(item.question.trim());
    if (userAnswer === undefined) throw incomplete();
    const key = item.answer?.trim() || null;
    attempt.push({ question: item.question, userAnswer, answer: key });
    if (key === null) continue;
    scores[key] ??= 0;
    if (userAnswer.trim() === key) {
      scores[key] += 1;
      correct += 1;
    }
  }

  const scaled = Object.fromEntries(Object.entries(scores).map(([key, value]) => [key, value * SCORE_SCALE]));
  return { attempt, result: { scores: scaled, level: levelOf((correct / questions.length) * 100) } };
};

interface PlacementRow {
  questions?: unknown;
  userAttempt?: unknown;
}

const withoutKey = (items: unknown): unknown =>
  Array.isArray(items)
    ? items.map((item) => {
        if (item === null || typeof item !== 'object') return item;
        const { answer: _key, ...rest } = item as Record<string, unknown>;
        return rest;
      })
    : items;

export const placementForViewer = <T>(role: string | undefined, quiz: T): T => {
  if (role === 'ADMIN' || quiz === null || typeof quiz !== 'object') return quiz;
  const row = quiz as PlacementRow;
  const view: Record<string, unknown> = { ...(quiz as Record<string, unknown>) };
  if (Array.isArray(row.questions)) view.questions = withoutKey(row.questions);
  if (Array.isArray(row.userAttempt)) view.userAttempt = withoutKey(row.userAttempt);
  return view as T;
};
