import {
  CHUNK_CLASSES,
  CHUNK_SPECS,
  ChunkEvidence,
  MIN_CHUNK_ATTEMPTS,
  MicrolearningInput,
  emptyChunkEvidence,
  isChunkClass,
  planMicrolearning,
} from '../microlearning';

const evidence = (overrides: Partial<ChunkEvidence> = {}): ChunkEvidence => ({ ...emptyChunkEvidence(), ...overrides });

const learner = (overrides: Partial<Omit<MicrolearningInput, 'evidence'>> = {}) => ({
  scaffoldLevel: 'MINIMAL' as const,
  mastery: 0.8,
  evidenceCount: 6,
  prerequisiteMasteryMet: true,
  ...overrides,
});

describe('planMicrolearning without personal evidence', () => {
  it.each([
    ['a learner with no evidence yet', learner({ evidenceCount: 0, mastery: 0.5 }), 'SHORT', 'NO_EVIDENCE_SHORT'],
    ['two open misconceptions', learner({ scaffoldLevel: 'HIGH' }), 'SHORT', 'HIGH_SCAFFOLD_SHORT'],
    ['a prerequisite that is not met', learner({ prerequisiteMasteryMet: false }), 'SHORT', 'PREREQUISITE_NOT_MET_SHORT'],
    ['low mastery without any misconception', learner({ mastery: 0.2 }), 'SHORT', 'LOW_MASTERY_SHORT'],
    ['one open misconception', learner({ scaffoldLevel: 'MEDIUM' }), 'MEDIUM', 'MEDIUM_SCAFFOLD_MEDIUM'],
    ['middle mastery', learner({ mastery: 0.55 }), 'MEDIUM', 'MID_MASTERY_MEDIUM'],
    ['stable high mastery and nothing in the way', learner(), 'LONG', 'STABLE_MASTERY_LONG'],
  ] as const)('chooses by %s', (_name, input, chunkClass, reason) => {
    const plan = planMicrolearning({ ...input, evidence: evidence() });

    expect(plan.chunkClass).toBe(chunkClass);
    expect(plan).toMatchObject({ ...CHUNK_SPECS[chunkClass], evidenceSufficient: false, policyVersion: 'microlearning-v1' });
    expect(plan.reasonCodes).toEqual([reason, 'INSUFFICIENT_CHUNK_EVIDENCE']);
  });

  it('takes the shortest class when several limits apply', () => {
    const plan = planMicrolearning({ ...learner({ scaffoldLevel: 'MEDIUM', mastery: 0.9, prerequisiteMasteryMet: false }), evidence: evidence() });

    expect(plan.chunkClass).toBe('SHORT');
  });

  it('keeps every spec inside the micro-learning range of 150 to 700 words and 3 to 5 exercises', () => {
    for (const chunk of CHUNK_CLASSES) {
      expect(CHUNK_SPECS[chunk].targetWords).toBeGreaterThanOrEqual(150);
      expect(CHUNK_SPECS[chunk].targetWords).toBeLessThanOrEqual(700);
      expect(CHUNK_SPECS[chunk].exerciseCount).toBeGreaterThanOrEqual(3);
      expect(CHUNK_SPECS[chunk].exerciseCount).toBeLessThanOrEqual(5);
    }
  });
});

describe('planMicrolearning with personal evidence', () => {
  it('stays on the base class while the evidence is too thin', () => {
    const plan = planMicrolearning({ ...learner({ scaffoldLevel: 'HIGH' }), evidence: evidence({ MEDIUM: { attempts: MIN_CHUNK_ATTEMPTS - 1, successes: MIN_CHUNK_ATTEMPTS - 1 } }) });

    expect(plan.chunkClass).toBe('SHORT');
  });

  it('moves to the neighbour that worked: at least three attempts and 70 percent success', () => {
    const plan = planMicrolearning({ ...learner({ scaffoldLevel: 'HIGH' }), evidence: evidence({ MEDIUM: { attempts: 3, successes: 3 } }) });

    expect(plan.chunkClass).toBe('MEDIUM');
    expect(plan.reasonCodes).toEqual(['HIGH_SCAFFOLD_SHORT', 'PERSONAL_CHUNK_PREFERRED']);
    expect(plan.evidenceSufficient).toBe(true);
  });

  it('does not move for a neighbour that works only sometimes', () => {
    const plan = planMicrolearning({ ...learner({ scaffoldLevel: 'HIGH' }), evidence: evidence({ MEDIUM: { attempts: 10, successes: 6 } }) });

    expect(plan.chunkClass).toBe('SHORT');
  });

  it('never jumps two classes away from the base, however well that class worked', () => {
    const plan = planMicrolearning({ ...learner({ scaffoldLevel: 'HIGH' }), evidence: evidence({ LONG: { attempts: 20, successes: 20 } }) });

    expect(plan.chunkClass).toBe('SHORT');
  });

  it('keeps the base when it works as well as a neighbour', () => {
    const plan = planMicrolearning({
      ...learner({ scaffoldLevel: 'MEDIUM' }),
      evidence: evidence({ SHORT: { attempts: 4, successes: 4 }, MEDIUM: { attempts: 4, successes: 4 } }),
    });

    expect(plan.chunkClass).toBe('MEDIUM');
    expect(plan.reasonCodes).not.toContain('PERSONAL_CHUNK_PREFERRED');
  });

  it('prefers the class with the best success rate among the proven ones', () => {
    const plan = planMicrolearning({
      ...learner({ scaffoldLevel: 'MEDIUM' }),
      evidence: evidence({ SHORT: { attempts: 5, successes: 5 }, MEDIUM: { attempts: 10, successes: 8 } }),
    });

    expect(plan.chunkClass).toBe('SHORT');
  });

  it('leaves the base class when it failed often and a neighbour is proven', () => {
    const plan = planMicrolearning({
      ...learner(),
      evidence: evidence({ LONG: { attempts: 8, successes: 2 }, MEDIUM: { attempts: 3, successes: 3 } }),
    });

    expect(plan.chunkClass).toBe('MEDIUM');
  });
});

describe('isChunkClass', () => {
  it('accepts the three classes and nothing else', () => {
    expect(CHUNK_CLASSES.every(isChunkClass)).toBe(true);
    expect(isChunkClass('short')).toBe(false);
    expect(isChunkClass(null)).toBe(false);
  });
});
