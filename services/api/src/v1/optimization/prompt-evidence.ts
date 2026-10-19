import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/common/config/prisma/prisma.service';

export const THEME_LIMIT = 12;
export const SAMPLE_LIMIT = 6;
export const SAMPLE_REPLY_CHARS = 500;
const MIN_NAME_TOKEN = 3;

export interface FailureTheme {
  strategy: string;
  attempts: number;
  failures: number;
}

export interface FailureSample {
  strategy: string;
  grounded: boolean;
  scoreDelta: number | null;
  reply: string;
}

interface ThemeRow {
  strategy: string;
  attempts: bigint;
  failures: bigint;
}

interface SampleRow {
  strategy: string;
  scoreDelta: number | null;
  grounded: boolean;
  response: string;
  learnerName: string | null;
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function redactReply(reply: string, learnerName: string | null | undefined): string {
  let text = reply
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '[email]')
    .replace(/https?:\/\/\S+/g, '[tautan]');
  const tokens = (learnerName ?? '').split(/\s+/).filter((token) => token.length >= MIN_NAME_TOKEN);
  for (const token of tokens) {
    text = text.replace(new RegExp(`\\b${escapeRegExp(token)}\\b`, 'gi'), '[nama]');
  }
  text = text.replace(/\s+/g, ' ').trim();
  return text.length > SAMPLE_REPLY_CHARS ? `${text.slice(0, SAMPLE_REPLY_CHARS - 1)}…` : text;
}

@Injectable()
export class PromptEvidenceService {
  constructor(private readonly prisma: PrismaService) {}

  async themes(label: string): Promise<FailureTheme[]> {
    const rows = await this.prisma.$queryRaw<ThemeRow[]>`
      SELECT "strategy", COUNT(*) AS attempts, COUNT(*) FILTER (WHERE NOT success) AS failures
      FROM "StrategyOutcome"
      WHERE "promptVersion" = ${label}
      GROUP BY "strategy"
      HAVING COUNT(*) FILTER (WHERE NOT success) > 0
      ORDER BY failures DESC, "strategy" ASC
      LIMIT ${THEME_LIMIT}
    `;
    return rows.map((row) => ({ strategy: row.strategy, attempts: Number(row.attempts), failures: Number(row.failures) }));
  }

  async samples(label: string): Promise<FailureSample[]> {
    const rows = await this.prisma.$queryRaw<SampleRow[]>`
      SELECT
        so."strategy" AS strategy,
        so."scoreDelta" AS "scoreDelta",
        (jsonb_array_length(COALESCE(e."retrievedChunks"->'citations', '[]'::jsonb)) > 0) AS grounded,
        e."response" AS response,
        u."name" AS "learnerName"
      FROM "StrategyOutcome" so
      JOIN "Episode" e ON e."id" = so."episodeId"
      JOIN "User" u ON u."id" = so."userId"
      WHERE so."promptVersion" = ${label} AND NOT so."success" AND length(trim(e."response")) > 0
      ORDER BY so."createdAt" DESC
      LIMIT ${SAMPLE_LIMIT}
    `;
    return rows
      .map((row) => ({
        strategy: row.strategy,
        grounded: row.grounded,
        scoreDelta: row.scoreDelta === null ? null : Number(row.scoreDelta.toFixed(3)),
        reply: redactReply(row.response, row.learnerName),
      }))
      .filter((sample) => sample.reply.length > 0);
  }
}
