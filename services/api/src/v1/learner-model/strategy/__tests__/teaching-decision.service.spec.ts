import { ConceptView } from '../../concepts/concept.types';
import { LearnerPolicyService } from '../../policy/learner-policy.service';
import { TeachingDecisionService, conceptDifficulty } from '../teaching-decision.service';
import { emptyEvidence } from '../strategy.types';
import { emptyChunkEvidence } from '../microlearning';

const NOW = new Date('2026-10-12T10:00:00.000Z');

const concept = (id: string, level: number): ConceptView => ({
  id,
  title: id,
  description: null,
  level,
  sortOrder: 1,
  estimatedMinutes: null,
  prerequisiteIds: [],
});

const concepts = [concept('c1', 1), concept('c2', 2), concept('c3', 3)];

const conceptState = (overrides: { score?: number; evidenceCount?: number; lastEventAt?: Date | null; prerequisiteMasteryMet?: boolean } = {}) => ({
  conceptId: 'c2',
  title: 'c2',
  level: 2,
  mastery: {
    score: overrides.score ?? 0.3,
    confidence: 0.2,
    evidenceCount: overrides.evidenceCount ?? 4,
    lastEventAt: overrides.lastEventAt === undefined ? new Date('2026-10-09T10:00:00.000Z') : overrides.lastEventAt,
  },
  prerequisites: [],
  prerequisiteMasteryMet: overrides.prerequisiteMasteryMet ?? true,
});

const build = (
  options: { state?: ReturnType<typeof conceptState> | null; misconceptions?: number; evidence?: ReturnType<typeof emptyEvidence>; chunkEvidence?: ReturnType<typeof emptyChunkEvidence> } = {},
) => {
  const prisma = { misconception: { count: jest.fn().mockResolvedValue(options.misconceptions ?? 0) } };
  const state = { conceptState: jest.fn().mockResolvedValue(options.state === undefined ? conceptState() : options.state) };
  const registry = { listActive: jest.fn().mockResolvedValue(concepts) };
  const outcomes = {
    evidence: jest.fn().mockResolvedValue(options.evidence ?? emptyEvidence()),
    chunkEvidence: jest.fn().mockResolvedValue(options.chunkEvidence ?? emptyChunkEvidence()),
  };
  const service = new TeachingDecisionService(prisma as never, state as never, registry as never, new LearnerPolicyService(), outcomes as never);
  return { service, prisma, state, outcomes };
};

describe('TeachingDecisionService', () => {
  it('decides nothing when no concept is known', async () => {
    const { service } = build();

    expect(await service.decide('u-1', { conceptIds: [], intent: 'DOUBT' }, NOW)).toBeNull();
  });

  it('decides nothing when the concept is not in the registry', async () => {
    const { service } = build({ state: null });

    expect(await service.decide('u-1', { conceptIds: ['ghost'], intent: 'DOUBT' }, NOW)).toBeNull();
  });

  it('uses the first concept as the one the strategy is chosen for and reads the mastery of that concept', async () => {
    const { service, state } = build();

    const decision = await service.decide('u-1', { conceptIds: ['c2', 'c3'], intent: 'DOUBT' }, NOW);

    expect(state.conceptState).toHaveBeenCalledWith('u-1', 'c2');
    expect(decision?.conceptId).toBe('c2');
  });

  it('gives a worked example to a learner with low mastery who asks a question', async () => {
    const { service } = build({ state: conceptState({ score: 0.2 }) });

    const decision = await service.decide('u-1', { conceptIds: ['c2'], intent: 'DOUBT' }, NOW);

    expect(decision).toMatchObject({ strategy: 'WORKED_EXAMPLE', reasonCodes: ['LOW_MASTERY'], hintLevel: 0, intent: 'DOUBT' });
  });

  it('remediates and raises the scaffold when two misconceptions are open', async () => {
    const { service, prisma } = build({ misconceptions: 2 });

    const decision = await service.decide('u-1', { conceptIds: ['c2'], intent: 'NEW_LEARNING' }, NOW);

    expect(prisma.misconception.count).toHaveBeenCalledWith({ where: { userId: 'u-1', status: 'OPEN' } });
    expect(decision).toMatchObject({ strategy: 'REMEDIATE', scaffoldLevel: 'HIGH', reasonCodes: ['OPEN_MISCONCEPTIONS'] });
  });

  it('asks for a review of a concept not seen for more than a week during practice', async () => {
    const { service } = build({ state: conceptState({ score: 0.6, lastEventAt: new Date('2026-10-01T10:00:00.000Z') }) });

    const decision = await service.decide('u-1', { conceptIds: ['c2'], intent: 'PRACTICE' }, NOW);

    expect(decision).toMatchObject({ strategy: 'REVIEW', reasonCodes: ['REVIEW_DUE'] });
  });

  it('prefers the strategy that has worked for this learner once the evidence is there', async () => {
    const evidence = emptyEvidence();
    evidence.SOCRATIC = { attempts: 5, successes: 4, averageDelta: 0.07 };
    const { service } = build({ evidence, state: conceptState({ score: 0.6 }) });

    const decision = await service.decide('u-1', { conceptIds: ['c2'], intent: 'PRACTICE' }, NOW);

    expect(decision).toMatchObject({ strategy: 'SOCRATIC', reasonCodes: ['PERSONAL_STRATEGY_PREFERRED'], personalEvidenceAttempts: 5, evidenceSufficient: true });
  });

  it('does not let a thin history override the default strategy', async () => {
    const evidence = emptyEvidence();
    evidence.SOCRATIC = { attempts: 2, successes: 2, averageDelta: 0.1 };
    const { service } = build({ evidence, state: conceptState({ score: 0.6 }) });

    const decision = await service.decide('u-1', { conceptIds: ['c2'], intent: 'PRACTICE' }, NOW);

    expect(decision?.strategy).toBe('PRACTICE');
    expect(decision?.evidenceSufficient).toBe(false);
  });
});

describe('conceptDifficulty', () => {
  it('places a concept between the easiest and the hardest level of the registry', () => {
    expect(conceptDifficulty(1, concepts)).toBe(0);
    expect(conceptDifficulty(2, concepts)).toBe(0.5);
    expect(conceptDifficulty(3, concepts)).toBe(1);
  });

  it('falls back to the middle when every concept has the same level or the registry is empty', () => {
    expect(conceptDifficulty(1, [concept('a', 1), concept('b', 1)])).toBe(0.5);
    expect(conceptDifficulty(1, [])).toBe(0.5);
  });

  describe('micro-learning plan', () => {
    it('is part of every decision and follows the open misconceptions through the scaffold', async () => {
      const { service } = build({ state: conceptState({ score: 0.9 }), misconceptions: 2 });

      const decision = await service.decide('u-1', { conceptIds: ['c2'], intent: 'DOUBT' }, NOW);

      expect(decision?.scaffoldLevel).toBe('HIGH');
      expect(decision?.microlearning).toMatchObject({ chunkClass: 'SHORT', targetWords: 250, exerciseCount: 3, policyVersion: 'microlearning-v1' });
    });

    it('gives low mastery a short chunk even when no misconception is open', async () => {
      const { service } = build({ state: conceptState({ score: 0.15 }) });

      const decision = await service.decide('u-1', { conceptIds: ['c2'], intent: 'DOUBT' }, NOW);

      expect(decision?.scaffoldLevel).toBe('MINIMAL');
      expect(decision?.microlearning.chunkClass).toBe('SHORT');
      expect(decision?.microlearning.reasonCodes[0]).toBe('LOW_MASTERY_SHORT');
    });

    it('moves to a chunk size that worked for this learner when the evidence is enough', async () => {
      const { service, outcomes } = build({ state: conceptState({ score: 0.15 }) });
      outcomes.chunkEvidence.mockResolvedValue({ SHORT: { attempts: 5, successes: 1 }, MEDIUM: { attempts: 4, successes: 4 }, LONG: { attempts: 0, successes: 0 } });

      const decision = await service.decide('u-1', { conceptIds: ['c2'], intent: 'DOUBT' }, NOW);

      expect(decision?.microlearning.chunkClass).toBe('MEDIUM');
      expect(decision?.microlearning.reasonCodes).toContain('PERSONAL_CHUNK_PREFERRED');
    });
  });
});
