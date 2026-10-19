import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/common/config/prisma/prisma.service';
import { LearnerPolicyService } from '../policy/learner-policy.service';
import { TEACHING_STRATEGIES } from '../policy/policy.types';
import { ChunkClass, ChunkEvidence, emptyChunkEvidence, isChunkClass } from './microlearning';
import { StrategyEvidence, StrategySummary, emptyEvidence, isTeachingStrategy } from './strategy.types';

export const ATTRIBUTION_WINDOW_MS = 24 * 60 * 60 * 1000;
export const EVIDENCE_WINDOW = 200;
export const ACTION_TURN_TASK_TYPE = 'tutor_action';

export interface StrategyAttribution {
  userId: string;
  conceptId: string;
  eventKey: string;
  scoreBefore: number;
  scoreAfter: number;
  at?: Date;
}

interface EpisodeStrategy {
  metadata?: { teachingStrategy?: unknown; chunkClass?: unknown };
}

@Injectable()
export class StrategyOutcomeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: LearnerPolicyService,
  ) {}

  async attribute(tx: Prisma.TransactionClient, input: StrategyAttribution): Promise<boolean> {
    const since = new Date((input.at ?? new Date()).getTime() - ATTRIBUTION_WINDOW_MS);
    const episode = await tx.episode.findFirst({
      where: {
        userId: input.userId,
        createdAt: { gte: since },
        taskType: { not: ACTION_TURN_TASK_TYPE },
        strategyOutcome: null,
        strategy: { path: ['metadata', 'strategyConceptId'], equals: input.conceptId },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, promptVersion: true, strategy: true },
    });
    if (!episode) return false;

    const used = (episode.strategy as EpisodeStrategy | null)?.metadata?.teachingStrategy;
    if (!isTeachingStrategy(used)) return false;

    const chunkClass: ChunkClass | null = isChunkClass((episode.strategy as EpisodeStrategy | null)?.metadata?.chunkClass)
      ? ((episode.strategy as EpisodeStrategy).metadata?.chunkClass as ChunkClass)
      : null;
    const delta = input.scoreAfter - input.scoreBefore;
    const created = await tx.strategyOutcome.createMany({
      data: [
        {
          userId: input.userId,
          conceptId: input.conceptId,
          strategy: used,
          episodeId: episode.id,
          eventKey: input.eventKey,
          promptVersion: episode.promptVersion,
          chunkClass,
          scoreBefore: input.scoreBefore,
          scoreAfter: input.scoreAfter,
          scoreDelta: delta,
          success: delta > 0,
        },
      ],
      skipDuplicates: true,
    });
    return created.count === 1;
  }

  async evidence(userId: string): Promise<StrategyEvidence> {
    const rows = await this.prisma.strategyOutcome.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: EVIDENCE_WINDOW,
      select: { strategy: true, success: true, scoreDelta: true },
    });

    const totals = emptyEvidence();
    for (const row of rows) {
      if (!isTeachingStrategy(row.strategy)) continue;
      const stat = totals[row.strategy];
      stat.attempts += 1;
      stat.successes += row.success ? 1 : 0;
      stat.averageDelta += row.scoreDelta;
    }
    for (const strategy of TEACHING_STRATEGIES) {
      const stat = totals[strategy];
      stat.averageDelta = stat.attempts > 0 ? stat.averageDelta / stat.attempts : 0;
    }
    return totals;
  }

  async chunkEvidence(userId: string): Promise<ChunkEvidence> {
    const rows = await this.prisma.strategyOutcome.findMany({
      where: { userId, chunkClass: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: EVIDENCE_WINDOW,
      select: { chunkClass: true, success: true },
    });
    const totals = emptyChunkEvidence();
    for (const row of rows) {
      if (!isChunkClass(row.chunkClass)) continue;
      totals[row.chunkClass].attempts += 1;
      totals[row.chunkClass].successes += row.success ? 1 : 0;
    }
    return totals;
  }

  async summary(userId: string): Promise<StrategySummary> {
    const evidence = await this.evidence(userId);
    const strategies = TEACHING_STRATEGIES.map((strategy) => ({
      strategy,
      ...evidence[strategy],
      successRate: evidence[strategy].attempts > 0 ? evidence[strategy].successes / evidence[strategy].attempts : null,
    }));
    return {
      strategies,
      preferredStrategy: this.policy.preferredStrategy({ strategyEvidence: evidence }),
      totalAttempts: strategies.reduce((sum, row) => sum + row.attempts, 0),
    };
  }
}
