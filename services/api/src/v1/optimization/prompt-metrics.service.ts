import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/common/config/prisma/prisma.service';
import { PromptMetrics } from './acceptance-gate';

interface EpisodeAggregate {
  episodes: bigint;
  grounded: bigint;
  p50: number | null;
  p95: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
}

interface OutcomeAggregate {
  outcomes: bigint;
  successes: bigint;
}

const EMPTY: PromptMetrics = {
  episodes: 0,
  outcomes: 0,
  successRate: null,
  groundedRate: null,
  p50LatencyMs: null,
  p95LatencyMs: null,
  avgTokensIn: null,
  avgTokensOut: null,
};

const round = (value: number | null, places = 3): number | null => (value === null ? null : Number(value.toFixed(places)));

@Injectable()
export class PromptMetricsService {
  constructor(private readonly prisma: PrismaService) {}

  async forLabels(labels: readonly string[]): Promise<Map<string, PromptMetrics>> {
    const result = new Map<string, PromptMetrics>();
    for (const label of labels) result.set(label, await this.forLabel(label));
    return result;
  }

  async forLabel(label: string): Promise<PromptMetrics> {
    const [episodeRows, outcomeRows] = await Promise.all([
      this.prisma.$queryRaw<EpisodeAggregate[]>`
        SELECT
          COUNT(*) AS episodes,
          COUNT(*) FILTER (WHERE jsonb_array_length(COALESCE("retrievedChunks"->'citations', '[]'::jsonb)) > 0) AS grounded,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY "latencyMs") FILTER (WHERE "latencyMs" IS NOT NULL) AS p50,
          percentile_cont(0.95) WITHIN GROUP (ORDER BY "latencyMs") FILTER (WHERE "latencyMs" IS NOT NULL) AS p95,
          AVG("inputTokens") AS "tokensIn",
          AVG("outputTokens") AS "tokensOut"
        FROM "Episode"
        WHERE "promptVersion" = ${label} AND "taskType" = 'tutor_agent'
      `,
      this.prisma.$queryRaw<OutcomeAggregate[]>`
        SELECT COUNT(*) AS outcomes, COUNT(*) FILTER (WHERE success) AS successes
        FROM "StrategyOutcome"
        WHERE "promptVersion" = ${label}
      `,
    ]);

    const episodes = Number(episodeRows[0]?.episodes ?? 0);
    const outcomes = Number(outcomeRows[0]?.outcomes ?? 0);
    if (episodes === 0 && outcomes === 0) return { ...EMPTY };

    return {
      episodes,
      outcomes,
      successRate: outcomes > 0 ? round(Number(outcomeRows[0].successes) / outcomes) : null,
      groundedRate: episodes > 0 ? round(Number(episodeRows[0].grounded) / episodes) : null,
      p50LatencyMs: round(episodeRows[0]?.p50 ?? null, 0),
      p95LatencyMs: round(episodeRows[0]?.p95 ?? null, 0),
      avgTokensIn: round(episodeRows[0]?.tokensIn ?? null, 0),
      avgTokensOut: round(episodeRows[0]?.tokensOut ?? null, 0),
    };
  }
}
