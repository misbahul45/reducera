import { MisconceptionService } from '../misconception.service';

describe('MisconceptionService.classify (deterministic)', () => {
  let service: MisconceptionService;

  beforeEach(() => {
    const repo = { upsert: jest.fn().mockResolvedValue({}), listActiveByUser: jest.fn() };
    service = new MisconceptionService(repo as any);
  });

  it('classifies debit-credit swap when wrong answer is the inverse', () => {
    const code = service.classifyPattern({
      questionId: 'q-journal-debit-credit',
      userAnswer: 'credit Cash 100 / debit Service Revenue 100',
      correctAnswer: 'debit Cash 100 / credit Service Revenue 100',
    });
    expect(code).toBe('debit_credit_swap');
  });

  it('classifies trial-balance imbalance when wrong answer omits an entry', () => {
    const code = service.classifyPattern({
      questionId: 'q-trial-balance',
      userAnswer: '',
      correctAnswer: 'debit Cash 100 / credit Service Revenue 100',
    });
    expect(code).toBe('trial_balance_imbalance');
  });

  it('returns null for an unrecognized pattern', () => {
    const code = service.classifyPattern({
      questionId: 'q-unknown',
      userAnswer: 'x',
      correctAnswer: 'y',
    });
    expect(code).toBeNull();
  });

  it('classifies missing_credit_side when only debit is in user answer', () => {
    const code = service.classifyPattern({
      questionId: 'q-journal-x',
      userAnswer: 'debit Cash 100',
      correctAnswer: 'debit Cash 100 / credit Service Revenue 100',
    });
    expect(code).toBe('missing_credit_side');
  });
});

describe('MisconceptionService.recordTagged', () => {
  it('stores a known code with the question and the answer as evidence', async () => {
    const repo = { upsert: jest.fn().mockResolvedValue({}), listActiveByUser: jest.fn() };
    const service = new MisconceptionService(repo as any);

    const result = await service.recordTagged({ userId: 'u-1', topicId: 't-1', code: 'debit_credit_swap', questionId: 'q-1', userAnswer: 'B' });

    expect(result).toEqual({ patternCode: 'debit_credit_swap' });
    expect(repo.upsert).toHaveBeenCalledWith({
      userId: 'u-1',
      conceptKey: 'debit_credit_swap',
      topicId: 't-1',
      evidence: { questionId: 'q-1', userAnswer: 'B' },
      confidence: 0.8,
    });
  });

  it('stores nothing for a code outside the closed list', async () => {
    const repo = { upsert: jest.fn(), listActiveByUser: jest.fn() };
    const service = new MisconceptionService(repo as any);

    const result = await service.recordTagged({ userId: 'u-1', code: 'invented', questionId: 'q-1', userAnswer: 'B' });

    expect(result).toEqual({ patternCode: null });
    expect(repo.upsert).not.toHaveBeenCalled();
  });
});
