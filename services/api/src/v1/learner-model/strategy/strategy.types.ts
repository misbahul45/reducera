import { z } from 'zod';
import { TEACHING_STRATEGIES, TeachingStrategy } from '../policy/policy.types';

export const POLICY_INTENTS = ['NEW_LEARNING', 'PRACTICE', 'DOUBT', 'CHALLENGE', 'TRANSFER'] as const;

export const StrategyQueryDto = z
  .object({
    conceptId: z.string().min(1).max(200).optional(),
    intent: z.enum(POLICY_INTENTS).default('DOUBT'),
  });

export type StrategyQuery = z.infer<typeof StrategyQueryDto>;

export interface StrategyEvidenceStat {
  attempts: number;
  successes: number;
  averageDelta: number;
}

export type StrategyEvidence = Record<TeachingStrategy, StrategyEvidenceStat>;

export interface StrategySummaryRow extends StrategyEvidenceStat {
  strategy: TeachingStrategy;
  successRate: number | null;
}

export interface StrategySummary {
  strategies: StrategySummaryRow[];
  preferredStrategy: TeachingStrategy | null;
  totalAttempts: number;
}

export const emptyEvidence = (): StrategyEvidence =>
  Object.fromEntries(TEACHING_STRATEGIES.map((strategy) => [strategy, { attempts: 0, successes: 0, averageDelta: 0 }])) as StrategyEvidence;

export const isTeachingStrategy = (value: unknown): value is TeachingStrategy =>
  typeof value === 'string' && (TEACHING_STRATEGIES as readonly string[]).includes(value);
