import { PROMPT_EVALUATION_QUEUE, PromptEvaluationProcessor } from '../prompt-evaluation.processor';
import { PROMPT_EVALUATION_CRON, PromptEvaluationScheduler } from '../prompt-evaluation.scheduler';
import { CanarySweep } from '../prompt-registry.service';

const sweepOf = (overrides: Partial<CanarySweep> = {}): CanarySweep => ({
  inspected: 0,
  validated: [],
  rolledBack: [],
  undecided: [],
  failed: [],
  ...overrides,
});

describe('PromptEvaluationProcessor', () => {
  let registry: { evaluateRunningCanaries: jest.Mock };
  let processor: PromptEvaluationProcessor;

  beforeEach(() => {
    registry = { evaluateRunningCanaries: jest.fn().mockResolvedValue(sweepOf()) };
    processor = new PromptEvaluationProcessor(registry as any);
  });

  it('sweeps the running canaries with a trace id derived from the job and returns the result', async () => {
    const sweep = sweepOf({ inspected: 2, rolledBack: ['tutor-chat@3'], undecided: ['tutor-chat@4'] });
    registry.evaluateRunningCanaries.mockResolvedValue(sweep);

    const result = await processor.process({ id: '42' } as any);

    expect(registry.evaluateRunningCanaries).toHaveBeenCalledWith('prompt-evaluation:42');
    expect(result).toBe(sweep);
  });

  it('does not fail the job when one canary could not be evaluated', async () => {
    registry.evaluateRunningCanaries.mockResolvedValue(sweepOf({ inspected: 1, failed: [{ label: 'tutor-chat@5', message: 'The version changed while it was evaluated' }] }));

    await expect(processor.process({ id: '43' } as any)).resolves.toMatchObject({ inspected: 1 });
  });

  it('lets a failure of the sweep itself reach the queue so the job is recorded as failed', async () => {
    registry.evaluateRunningCanaries.mockRejectedValue(new Error('database unavailable'));

    await expect(processor.process({ id: '44' } as any)).rejects.toThrow('database unavailable');
  });
});

describe('PromptEvaluationScheduler', () => {
  it('registers one repeatable job on the evaluation queue', async () => {
    const queue = { add: jest.fn().mockResolvedValue(undefined) };

    await new PromptEvaluationScheduler(queue as any).onModuleInit();

    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledWith(
      'evaluate-canaries',
      { trigger: 'cron' },
      expect.objectContaining({ repeat: { pattern: PROMPT_EVALUATION_CRON, tz: 'Asia/Jakarta' }, removeOnComplete: true }),
    );
    expect(PROMPT_EVALUATION_QUEUE).toBe('prompt-evaluation');
  });

  it('keeps the application booting when the queue is unreachable', async () => {
    const queue = { add: jest.fn().mockRejectedValue(new Error('redis down')) };

    await expect(new PromptEvaluationScheduler(queue as any).onModuleInit()).resolves.toBeUndefined();
  });
});
