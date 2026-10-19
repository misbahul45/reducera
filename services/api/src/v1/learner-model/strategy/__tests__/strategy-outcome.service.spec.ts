import { LearnerPolicyService } from '../../policy/learner-policy.service';
import { ACTION_TURN_TASK_TYPE, ATTRIBUTION_WINDOW_MS, EVIDENCE_WINDOW, StrategyOutcomeService } from '../strategy-outcome.service';

const NOW = new Date('2026-10-12T10:00:00.000Z');

const episode = (strategy: unknown = 'WORKED_EXAMPLE', promptVersion = 'tutor-chat-builtin-3', chunkClass?: unknown) => ({
  id: 'ep-1',
  promptVersion,
  strategy: { metadata: { teachingStrategy: strategy, strategyConceptId: 'c2', ...(chunkClass === undefined ? {} : { chunkClass }) } },
});

const build = (options: { episode?: unknown; created?: number; outcomes?: Array<Record<string, unknown>> } = {}) => {
  const tx = {
    episode: { findFirst: jest.fn().mockResolvedValue(options.episode === undefined ? episode() : options.episode) },
    strategyOutcome: { createMany: jest.fn().mockResolvedValue({ count: options.created ?? 1 }) },
  };
  const prisma = { strategyOutcome: { findMany: jest.fn().mockResolvedValue(options.outcomes ?? []) } };
  const service = new StrategyOutcomeService(prisma as never, new LearnerPolicyService());
  return { service, tx, prisma };
};

const input = { userId: 'u-1', conceptId: 'c2', eventKey: 'assessment:a-1:c2', scoreBefore: 0.5, scoreAfter: 0.62, at: NOW };

describe('StrategyOutcomeService.attribute', () => {
  it('looks for the latest teaching episode of this learner that chose a strategy for this concept and has no outcome yet, inside the window, never one that only built an assessment', async () => {
    const { service, tx } = build();

    await service.attribute(tx as never, input);

    expect(tx.episode.findFirst).toHaveBeenCalledWith({
      where: {
        userId: 'u-1',
        createdAt: { gte: new Date(NOW.getTime() - ATTRIBUTION_WINDOW_MS) },
        taskType: { not: ACTION_TURN_TASK_TYPE },
        strategyOutcome: null,
        strategy: { path: ['metadata', 'strategyConceptId'], equals: 'c2' },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, promptVersion: true, strategy: true },
    });
  });

  it('stores the strategy that was used, the prompt version of that turn and the change in mastery', async () => {
    const { service, tx } = build();

    const attributed = await service.attribute(tx as never, input);

    expect(attributed).toBe(true);
    expect(tx.strategyOutcome.createMany).toHaveBeenCalledWith({
      data: [
        {
          userId: 'u-1',
          conceptId: 'c2',
          strategy: 'WORKED_EXAMPLE',
          episodeId: 'ep-1',
          eventKey: 'assessment:a-1:c2',
          promptVersion: 'tutor-chat-builtin-3',
          chunkClass: null,
          scoreBefore: 0.5,
          scoreAfter: 0.62,
          scoreDelta: 0.62 - 0.5,
          success: true,
        },
      ],
      skipDuplicates: true,
    });
  });

  it('records a failure when mastery did not improve', async () => {
    const { service, tx } = build();

    await service.attribute(tx as never, { ...input, scoreBefore: 0.7, scoreAfter: 0.66 });

    expect(tx.strategyOutcome.createMany.mock.calls[0][0].data[0]).toMatchObject({ success: false });
  });

  it('records nothing when no episode chose a strategy for the concept', async () => {
    const { service, tx } = build({ episode: null });

    expect(await service.attribute(tx as never, input)).toBe(false);
    expect(tx.strategyOutcome.createMany).not.toHaveBeenCalled();
  });

  it('records nothing when the stored strategy is not one of the closed set', async () => {
    const { service, tx } = build({ episode: episode('SOMETHING_ELSE') });

    expect(await service.attribute(tx as never, input)).toBe(false);
    expect(tx.strategyOutcome.createMany).not.toHaveBeenCalled();
  });

  it('reports false when the outcome already existed', async () => {
    const { service, tx } = build({ created: 0 });

    expect(await service.attribute(tx as never, input)).toBe(false);
  });
});

describe('StrategyOutcomeService.evidence and summary', () => {
  const outcomes = [
    ...Array.from({ length: 4 }, () => ({ strategy: 'SOCRATIC', success: true, scoreDelta: 0.1 })),
    { strategy: 'SOCRATIC', success: false, scoreDelta: -0.05 },
    ...Array.from({ length: 3 }, () => ({ strategy: 'EXPLAIN', success: false, scoreDelta: -0.02 })),
    { strategy: 'NOT_A_STRATEGY', success: true, scoreDelta: 1 },
  ];

  it('reads only the most recent outcomes of the learner', async () => {
    const { service, prisma } = build({ outcomes });

    await service.evidence('u-1');

    expect(prisma.strategyOutcome.findMany).toHaveBeenCalledWith({
      where: { userId: 'u-1' },
      orderBy: { createdAt: 'desc' },
      take: EVIDENCE_WINDOW,
      select: { strategy: true, success: true, scoreDelta: true },
    });
  });

  it('counts attempts and successes per strategy and averages the change, ignoring unknown strategies', async () => {
    const { service } = build({ outcomes });

    const evidence = await service.evidence('u-1');

    expect(evidence.SOCRATIC).toEqual({ attempts: 5, successes: 4, averageDelta: expect.closeTo(0.07, 6) });
    expect(evidence.EXPLAIN).toEqual({ attempts: 3, successes: 0, averageDelta: expect.closeTo(-0.02, 6) });
    expect(evidence.HINT).toEqual({ attempts: 0, successes: 0, averageDelta: 0 });
  });

  it('names the strategy that works best for the learner once the policy thresholds are met', async () => {
    const { service } = build({ outcomes });

    const summary = await service.summary('u-1');

    expect(summary.preferredStrategy).toBe('SOCRATIC');
    expect(summary.totalAttempts).toBe(8);
    expect(summary.strategies.find((row) => row.strategy === 'SOCRATIC')?.successRate).toBeCloseTo(0.8, 6);
    expect(summary.strategies.find((row) => row.strategy === 'HINT')?.successRate).toBeNull();
  });

  it('names no preferred strategy without enough evidence', async () => {
    const { service } = build({ outcomes: [{ strategy: 'HINT', success: true, scoreDelta: 0.1 }] });

    expect((await service.summary('u-1')).preferredStrategy).toBeNull();
  });
});

describe('StrategyOutcomeService chunk class', () => {
  it('copies the chunk class of the turn onto the outcome', async () => {
    const { service, tx } = build({ episode: episode('WORKED_EXAMPLE', 'tutor-chat-builtin-3', 'SHORT') });

    await service.attribute(tx as never, input);

    expect(tx.strategyOutcome.createMany.mock.calls[0][0].data[0].chunkClass).toBe('SHORT');
  });

  it.each(['HUGE', 7, null, {}])('stores no class when the episode says %j', async (value) => {
    const { service, tx } = build({ episode: episode('WORKED_EXAMPLE', 'tutor-chat-builtin-3', value) });

    await service.attribute(tx as never, input);

    expect(tx.strategyOutcome.createMany.mock.calls[0][0].data[0].chunkClass).toBeNull();
  });

  it('adds up attempts and successes per class and ignores rows without a known class', async () => {
    const { service, prisma } = build({
      outcomes: [
        { chunkClass: 'SHORT', success: true },
        { chunkClass: 'SHORT', success: false },
        { chunkClass: 'LONG', success: true },
        { chunkClass: 'WEIRD', success: true },
      ],
    });

    const evidence = await service.chunkEvidence('u-1');

    expect(evidence).toEqual({ SHORT: { attempts: 2, successes: 1 }, MEDIUM: { attempts: 0, successes: 0 }, LONG: { attempts: 1, successes: 1 } });
    expect(prisma.strategyOutcome.findMany).toHaveBeenCalledWith({
      where: { userId: 'u-1', chunkClass: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: EVIDENCE_WINDOW,
      select: { chunkClass: true, success: true },
    });
  });
});
