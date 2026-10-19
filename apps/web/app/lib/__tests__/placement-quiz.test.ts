import { describe, expect, it } from 'vitest';
import type { ApiResponse } from '~/interfaces/api';
import { attemptFor, submitOutcome } from '../placement-quiz';

const failure = (statusCode: number): ApiResponse<unknown> => ({
  success: false,
  message: 'Request failed',
  data: null,
  meta: { statusCode, requestId: 'r-1' },
});

describe('submitOutcome', () => {
  it('reports a stored attempt as submitted', () => {
    expect(submitOutcome({ success: true, message: 'ok', data: { id: 'q' } })).toEqual({ kind: 'submitted' });
  });

  it('does not report a missing answer from the server as sent', () => {
    expect(submitOutcome(null)).toMatchObject({ kind: 'failed' });
  });

  it('treats a conflict as an attempt that was already stored', () => {
    expect(submitOutcome(failure(409))).toEqual({ kind: 'already-submitted' });
  });

  it.each([
    [403, 'terdaftar'],
    [400, 'belum terjawab'],
    [422, 'belum terjawab'],
    [404, 'belum terkirim'],
    [429, 'belum terkirim'],
    [500, 'belum terkirim'],
    [0, 'belum terkirim'],
  ])('turns a %s answer into a failure the learner can read', (status, fragment) => {
    const outcome = submitOutcome(failure(status));

    expect(outcome.kind).toBe('failed');
    expect(outcome).toHaveProperty('message', expect.stringContaining(fragment));
  });
});

describe('attemptFor', () => {
  const questions = [
    { question: 'Q1', type: 'multiple_choice' as const, difficulty: 'easy' as const, options: ['a', 'b'], answer: 'a' },
    { question: 'Q2', type: 'input' as const, difficulty: 'hard' as const, answer: 'rubrik' },
  ];

  it('sends the answer text in question order and never the key', () => {
    const attempt = attemptFor(questions, [
      { question: 'Q2', userAnswer: 'jawaban bebas' },
      { question: 'Q1', userAnswer: 'b' },
    ]);

    expect(attempt).toEqual([
      { question: 'Q1', userAnswer: 'b' },
      { question: 'Q2', userAnswer: 'jawaban bebas' },
    ]);
    expect(JSON.stringify(attempt)).not.toContain('rubrik');
  });

  it('drops a key that was carried on a stored item', () => {
    const attempt = attemptFor(questions.slice(0, 1), [{ question: 'Q1', userAnswer: 'b', answer: 'a' }]);

    expect(attempt[0]).not.toHaveProperty('answer');
  });

  it('is empty when a question has no answer yet', () => {
    expect(attemptFor(questions, [{ question: 'Q1', userAnswer: 'a' }])).toEqual([]);
  });
});
