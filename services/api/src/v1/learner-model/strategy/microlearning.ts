import { ScaffoldLevel } from '../policy/policy.types';

export const CHUNK_CLASSES = ['SHORT', 'MEDIUM', 'LONG'] as const;
export type ChunkClass = (typeof CHUNK_CLASSES)[number];

export const MICROLEARNING_POLICY_VERSION = 'microlearning-v1';
export const MIN_CHUNK_ATTEMPTS = 3;
export const CHUNK_SUCCESS_RATE = 0.7;

export const CHUNK_SPECS: Readonly<Record<ChunkClass, { targetWords: number; exerciseCount: number }>> = {
  SHORT: { targetWords: 250, exerciseCount: 3 },
  MEDIUM: { targetWords: 400, exerciseCount: 4 },
  LONG: { targetWords: 550, exerciseCount: 5 },
};

export type MicrolearningReasonCode =
  | 'NO_EVIDENCE_SHORT'
  | 'HIGH_SCAFFOLD_SHORT'
  | 'PREREQUISITE_NOT_MET_SHORT'
  | 'LOW_MASTERY_SHORT'
  | 'MEDIUM_SCAFFOLD_MEDIUM'
  | 'MID_MASTERY_MEDIUM'
  | 'STABLE_MASTERY_LONG'
  | 'PERSONAL_CHUNK_PREFERRED'
  | 'INSUFFICIENT_CHUNK_EVIDENCE';

export interface MicrolearningInput {
  scaffoldLevel: ScaffoldLevel;
  mastery: number;
  evidenceCount: number;
  prerequisiteMasteryMet: boolean;
  evidence: ChunkEvidence;
}

export const LOW_MASTERY_BELOW = 0.4;
export const MID_MASTERY_BELOW = 0.7;

export interface ChunkEvidenceStat {
  attempts: number;
  successes: number;
}

export type ChunkEvidence = Record<ChunkClass, ChunkEvidenceStat>;

export interface MicrolearningPlan {
  chunkClass: ChunkClass;
  targetWords: number;
  exerciseCount: number;
  reasonCodes: MicrolearningReasonCode[];
  policyVersion: string;
  evidenceSufficient: boolean;
}

export const emptyChunkEvidence = (): ChunkEvidence => ({
  SHORT: { attempts: 0, successes: 0 },
  MEDIUM: { attempts: 0, successes: 0 },
  LONG: { attempts: 0, successes: 0 },
});

export const isChunkClass = (value: unknown): value is ChunkClass =>
  typeof value === 'string' && (CHUNK_CLASSES as readonly string[]).includes(value);

interface Base {
  chunk: ChunkClass;
  reason: MicrolearningReasonCode;
}

const baseChunk = (input: MicrolearningInput): Base => {
  if (input.evidenceCount === 0) return { chunk: 'SHORT', reason: 'NO_EVIDENCE_SHORT' };
  if (input.scaffoldLevel === 'HIGH') return { chunk: 'SHORT', reason: 'HIGH_SCAFFOLD_SHORT' };
  if (!input.prerequisiteMasteryMet) return { chunk: 'SHORT', reason: 'PREREQUISITE_NOT_MET_SHORT' };
  if (input.mastery < LOW_MASTERY_BELOW) return { chunk: 'SHORT', reason: 'LOW_MASTERY_SHORT' };
  if (input.scaffoldLevel === 'MEDIUM') return { chunk: 'MEDIUM', reason: 'MEDIUM_SCAFFOLD_MEDIUM' };
  if (input.mastery < MID_MASTERY_BELOW) return { chunk: 'MEDIUM', reason: 'MID_MASTERY_MEDIUM' };
  return { chunk: 'LONG', reason: 'STABLE_MASTERY_LONG' };
};

const rateOf = (stat: ChunkEvidenceStat): number => (stat.attempts > 0 ? stat.successes / stat.attempts : 0);
const qualifies = (stat: ChunkEvidenceStat): boolean => stat.attempts >= MIN_CHUNK_ATTEMPTS && rateOf(stat) >= CHUNK_SUCCESS_RATE;

export function planMicrolearning(input: MicrolearningInput): MicrolearningPlan {
  const base = baseChunk(input);
  const baseIndex = CHUNK_CLASSES.indexOf(base.chunk);
  const neighbourhood = CHUNK_CLASSES.filter((_, index) => Math.abs(index - baseIndex) <= 1);

  const proven = neighbourhood
    .filter((chunk) => qualifies(input.evidence[chunk]))
    .sort((left, right) => {
      const byRate = rateOf(input.evidence[right]) - rateOf(input.evidence[left]);
      if (byRate !== 0) return byRate;
      return Math.abs(CHUNK_CLASSES.indexOf(left) - baseIndex) - Math.abs(CHUNK_CLASSES.indexOf(right) - baseIndex);
    });

  const chosen = proven[0] ?? base.chunk;
  const evidenceSufficient = proven.length > 0;
  const reasonCodes: MicrolearningReasonCode[] = [base.reason];
  if (chosen !== base.chunk) reasonCodes.push('PERSONAL_CHUNK_PREFERRED');
  if (!evidenceSufficient) reasonCodes.push('INSUFFICIENT_CHUNK_EVIDENCE');

  return {
    chunkClass: chosen,
    ...CHUNK_SPECS[chosen],
    reasonCodes,
    policyVersion: MICROLEARNING_POLICY_VERSION,
    evidenceSufficient,
  };
}
