import type { ApiResponse } from '~/interfaces/api';
import type { PersonalityQuizQuestion, PersonalityQuizUserAttemptItem } from '~/interfaces/learning/personalityQuiz';
import { toApiError } from '~/lib/api-error';

export type SubmitOutcome = { kind: 'submitted' } | { kind: 'already-submitted' } | { kind: 'failed'; message: string };

const NOT_SENT = 'Jawabanmu belum terkirim. Coba kirim lagi.';

export function submitOutcome(res: ApiResponse<unknown> | null): SubmitOutcome {
  if (res === null) return { kind: 'failed', message: NOT_SENT };
  if (res.success) return { kind: 'submitted' };
  switch (toApiError(res).kind) {
    case 'conflict':
      return { kind: 'already-submitted' };
    case 'forbidden':
      return { kind: 'failed', message: 'Kamu belum terdaftar di course ini atau gaya belajarmu belum terisi.' };
    case 'validation':
      return { kind: 'failed', message: 'Ada pertanyaan yang belum terjawab. Periksa lagi jawabanmu.' };
    default:
      return { kind: 'failed', message: NOT_SENT };
  }
}

export function attemptFor(
  questions: PersonalityQuizQuestion[],
  answers: PersonalityQuizUserAttemptItem[],
): { question: string; userAnswer: string }[] {
  const given = questions.map((item) => answers.find((answer) => answer.question === item.question));
  if (given.some((answer) => !answer)) return [];
  return given.map((answer, index) => ({ question: questions[index]!.question, userAnswer: answer!.userAnswer }));
}
