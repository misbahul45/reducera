import { createHash, randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { Prisma, PromptStatus } from '@prisma/client';
import { Actor, PolicyService } from '@/common/authz/policy.service';
import { AiServiceClient } from '@/common/ai-client/ai-service.client';
import { AiServiceError } from '@/common/ai-client/ai-service.error';
import { PrismaService } from '@/common/config/prisma/prisma.service';
import { AppError, AppErrorCode } from '@/common/lib/error';
import { GATE_THRESHOLDS } from './acceptance-gate';
import { BenchmarkService } from './benchmark/benchmark.service';
import { ProposeImprovementDtoType } from './optimization.dto';
import { PROMPT_CONTRACTS, PromptName, labelOf, proposalProblems } from './prompt-contracts';
import { PromptEvidenceService } from './prompt-evidence';
import { PromptMetricsService } from './prompt-metrics.service';
import { PromptRegistryService } from './prompt-registry.service';

export const MIN_EVIDENCE_EPISODES = GATE_THRESHOLDS.minEpisodes;
export const MAX_OPEN_AI_DRAFTS = 3;
export const PROPOSAL_TIMEOUT_MS = 180_000;
const PROPOSAL_PATH = '/prompt-proposals';

interface ProposalAnswer {
  template: string;
  rationale: string;
  changes: string[];
  similarity: number;
  model: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
}

const isAnswer = (value: unknown): value is ProposalAnswer => {
  if (typeof value !== 'object' || value === null) return false;
  const answer = value as Record<string, unknown>;
  return typeof answer.template === 'string' && typeof answer.rationale === 'string' && Array.isArray(answer.changes);
};

@Injectable()
export class PromptProposalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly ai: AiServiceClient,
    private readonly registry: PromptRegistryService,
    private readonly metrics: PromptMetricsService,
    private readonly evidence: PromptEvidenceService,
    private readonly benchmarks: BenchmarkService,
  ) {}

  private async assertRoomForDraft(name: PromptName): Promise<void> {
    const open = await this.prisma.promptVersion.count({
      where: { name, status: PromptStatus.DRAFT, metricsJson: { path: ['origin'], equals: 'AI_PROPOSED' } },
    });
    if (open >= MAX_OPEN_AI_DRAFTS) {
      throw new AppError(
        `There are already ${open} AI proposals waiting for this prompt. Reject or start one of them first.`,
        409,
        AppErrorCode.INVALID_STATE_TRANSITION,
      );
    }
  }

  async proposeFromBenchmark(actor: Actor, benchmarkRunId: string, traceId?: string) {
    this.policy.assertAdmin(actor);
    const { plan, evidence } = await this.benchmarks.proposalEvidence(actor, benchmarkRunId);
    const name = plan.name as PromptName;
    await this.assertRoomForDraft(name);

    const baseline = await this.registry.baseline(name);
    if (baseline.label !== plan.baseline.label || createHash('sha256').update(baseline.body).digest('hex') !== plan.baseline.hash) {
      throw new AppError('The prompt in use changed after this run; run the development set again before asking for a proposal', 409, AppErrorCode.INVALID_STATE_TRANSITION);
    }

    const answer = await this.ask(actor, { name, template: baseline.body, benchmark: evidence }, traceId);
    const problems = proposalProblems(name, baseline.body, answer.template);
    if (problems.length > 0) {
      throw new AppError(`The proposal failed the safety checks: ${problems.join('; ')}`, 422, AppErrorCode.VALIDATION_ERROR);
    }

    const origin = {
      source: 'DEVELOPMENT_BENCHMARK',
      benchmarkRunId,
      datasetName: evidence.datasetName,
      datasetDigest: evidence.datasetDigest,
      baselineLabel: baseline.label,
      rates: evidence.rates,
      judgeMeans: evidence.judgeMeans,
      weaknesses: evidence.weaknesses,
      sampleCount: evidence.samples.length,
      model: answer.model,
      tokensIn: answer.tokensIn,
      tokensOut: answer.tokensOut,
      similarity: answer.similarity,
    } as unknown as Prisma.InputJsonValue;

    const created = await this.registry.propose(
      actor,
      { name, body: answer.template, modelName: baseline.modelName, parentVersionId: baseline.parentVersionId ?? undefined, rationale: answer.rationale.slice(0, 1000) },
      traceId,
      { kind: 'AI_PROPOSED', evidence: origin, changes: answer.changes.map(String).slice(0, 6) },
    );
    return {
      message: 'Prompt improvement proposed from the development set',
      data: { ...created.data, rationale: answer.rationale, changes: answer.changes, similarity: answer.similarity, baselineLabel: baseline.label },
    };
  }

  async proposeImprovement(actor: Actor, dto: ProposeImprovementDtoType, traceId?: string) {
    this.policy.assertAdmin(actor);
    const name = dto.name as PromptName;

    await this.assertRoomForDraft(name);

    const baseline = await this.registry.baseline(name);
    const [metrics, themes, samples] = await Promise.all([
      this.metrics.forLabel(baseline.label),
      this.evidence.themes(baseline.label),
      this.evidence.samples(baseline.label),
    ]);
    if (metrics.episodes < MIN_EVIDENCE_EPISODES) {
      throw new AppError(
        `Only ${metrics.episodes} turns of ${baseline.label} are measured; an improvement needs at least ${MIN_EVIDENCE_EPISODES}.`,
        409,
        AppErrorCode.INVALID_STATE_TRANSITION,
      );
    }

    const answer = await this.ask(actor, { name, template: baseline.body, metrics, themes, samples }, traceId);
    const problems = proposalProblems(name, baseline.body, answer.template);
    if (problems.length > 0) {
      throw new AppError(`The proposal failed the safety checks: ${problems.join('; ')}`, 422, AppErrorCode.VALIDATION_ERROR);
    }

    const evidence = {
      baselineLabel: baseline.label,
      metrics,
      themes,
      sampleCount: samples.length,
      model: answer.model,
      tokensIn: answer.tokensIn,
      tokensOut: answer.tokensOut,
      similarity: answer.similarity,
    } as unknown as Prisma.InputJsonValue;

    const created = await this.registry.propose(
      actor,
      {
        name,
        body: answer.template,
        modelName: baseline.modelName,
        parentVersionId: baseline.parentVersionId ?? undefined,
        rationale: answer.rationale.slice(0, 1000),
      },
      traceId,
      { kind: 'AI_PROPOSED', evidence, changes: answer.changes.map(String).slice(0, 6) },
    );

    return {
      message: 'Prompt improvement proposed',
      data: { ...created.data, rationale: answer.rationale, changes: answer.changes, similarity: answer.similarity, baselineLabel: baseline.label },
    };
  }

  private async ask(actor: Actor, body: unknown, traceId?: string): Promise<ProposalAnswer> {
    try {
      const answer = await this.ai.post<unknown>({
        path: PROPOSAL_PATH,
        body,
        actingUserId: actor.id,
        idempotencyKey: randomUUID(),
        traceId,
        timeoutMs: PROPOSAL_TIMEOUT_MS,
      });
      if (!isAnswer(answer)) {
        throw new AppError('The AI service answered with an unexpected shape', 502, AppErrorCode.SERVICE_UNAVAILABLE);
      }
      return answer;
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (error instanceof AiServiceError && error.status === 422) {
        throw new AppError('The model proposed a template that failed the safety checks. Try again.', 422, AppErrorCode.VALIDATION_ERROR);
      }
      throw new AppError('The AI service could not produce a proposal right now. Try again later.', 503, AppErrorCode.SERVICE_UNAVAILABLE);
    }
  }
}

export { PROMPT_CONTRACTS, labelOf };
