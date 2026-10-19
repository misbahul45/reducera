import { PracticeQuizDto } from '../practice-quiz.dto';
import { PRACTICE_PASSING_SCORE, PracticeQuizService } from '../practice-quiz.service';

const question = (overrides: Record<string, unknown> = {}) => ({
  question: 'Akun apa yang bertambah di sisi debit?',
  options: ['Kas', 'Utang usaha', 'Modal', 'Pendapatan'],
  correctAnswer: 'Kas',
  distractors: { 'Utang usaha': 'normal_balance_confusion', Modal: 'made_up' },
  ...overrides,
});

const quiz = (count = 3) => ({ title: 'Latihan jurnal', questions: Array.from({ length: count }, () => question()) });

describe('PracticeQuizDto', () => {
  it('accepts three to ten questions of four options', () => {
    expect(PracticeQuizDto.safeParse(quiz(3)).success).toBe(true);
    expect(PracticeQuizDto.safeParse(quiz(10)).success).toBe(true);
  });

  it.each([
    ['two questions', quiz(2)],
    ['eleven questions', quiz(11)],
    ['three options', { ...quiz(), questions: [question({ options: ['a', 'b', 'c'] }), question(), question()] }],
    ['an answer outside the options', { ...quiz(), questions: [question({ correctAnswer: 'Giro' }), question(), question()] }],
    ['duplicate options', { ...quiz(), questions: [question({ options: ['Kas', 'kas', 'Modal', 'Utang'] }), question(), question()] }],
    ['an extra field', { ...quiz(), userId: 'someone' }],
    ['an empty title', { ...quiz(), title: '  ' }],
  ])('rejects %s', (_name, body) => {
    expect(PracticeQuizDto.safeParse(body).success).toBe(false);
  });
});

describe('PracticeQuizService', () => {
  let tx: any;
  let service: PracticeQuizService;

  beforeEach(() => {
    tx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      userStep: { findUnique: jest.fn().mockResolvedValue({ userId: 'user-1' }), update: jest.fn().mockResolvedValue({}) },
      quiz: { create: jest.fn().mockResolvedValue({ id: 'quiz-1' }) },
    };
    service = new PracticeQuizService({ $transaction: jest.fn(async (work: (client: typeof tx) => unknown) => work(tx)) } as never);
  });

  it('creates a multiple choice quiz, keeps only valid distractor tags and links it to the step', async () => {
    const result = await service.create('user-1', 'us-1', PracticeQuizDto.parse(quiz(3)));

    const data = tx.quiz.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ title: 'Latihan jurnal', passingScore: PRACTICE_PASSING_SCORE });
    expect(data.questions.create).toHaveLength(3);
    expect(data.questions.create[0]).toMatchObject({
      questionType: 'MULTIPLE_CHOICE',
      correctAnswer: 'Kas',
      distractors: { 'Utang usaha': 'normal_balance_confusion' },
      sortOrder: 0,
    });
    expect(tx.userStep.update).toHaveBeenCalledWith({ where: { id: 'us-1' }, data: { quizId: 'quiz-1' } });
    expect(result.data).toEqual({ quizId: 'quiz-1', questionCount: 3, taggedDistractors: 3 });
  });

  it('serialises concurrent creation for the same step with an advisory lock', async () => {
    await service.create('user-1', 'us-1', PracticeQuizDto.parse(quiz(3)));

    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it("refuses a step of another learner as if it did not exist", async () => {
    tx.userStep.findUnique.mockResolvedValue({ userId: 'someone-else' });

    await expect(service.create('user-1', 'us-1', PracticeQuizDto.parse(quiz(3)))).rejects.toMatchObject({ statusCode: 404 });
    expect(tx.quiz.create).not.toHaveBeenCalled();
  });
});
