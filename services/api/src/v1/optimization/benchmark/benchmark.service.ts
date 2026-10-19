import { createHash } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PromptStatus } from '@prisma/client';
import { Actor, PolicyService } from '@/common/authz/policy.service';
import { AiServiceClient, deriveIdempotencyKey } from '@/common/ai-client/ai-service.client';
import { AiServiceError } from '@/common/ai-client/ai-service.error';
import { PrismaService } from '@/common/config/prisma/prisma.service';
import { AppError, AppErrorCode } from '@/common/lib/error';
import { offlineCriteria } from '../acceptance-gate';
import { StartBenchmarkDtoType } from '../optimization.dto';
import { PromptName, labelOf, templateProblems } from '../prompt-contracts';
import { PromptRegistryService } from '../prompt-registry.service';
import { BenchmarkDataset, ResolvedBenchmarkCase, benchmarkDatasetSchema, datasetDigest, datasetRole, digestOfDescription, resolveCases, unknownSourceKeys } from './benchmark-dataset';
import { ProposerBenchmarkEvidence, buildProposerEvidence } from './benchmark-evidence';
import { CaseTask, FatalBenchmarkError, buildTasks, executeTasks } from './benchmark-executor';
import { CaseResult, compareArms, summarizeArm, toOfflineEvidence } from './benchmark-report';
import {
  ArmName,
  BENCHMARK_CASE_PATH,
  BENCHMARK_OPTIMIZER,
  BenchmarkPlan,
  BenchmarkTemplate,
  PROMPT_BENCHMARK_QUEUE,
} from './benchmark.types';

export const BENCHMARK_CONCURRENCY = 4;
export const BENCHMARK_RETRIES = 2;
export const BENCHMARK_RETRY_DELAY_MS = 1000;
export const BENCHMARK_CASE_TIMEOUT_MS = 150_000;
export const MAX_FAILURE_RATIO = 0.05;
export const MAX_ACTIVE_BENCHMARKS = 1;
const PROGRESS_STEP = 4;

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

const caseForAi = (item: ResolvedBenchmarkCase) => ({
  id: item.id,
  category: item.category,
  risk: item.risk,
  stepTitle: item.stepTitle,
  learnerName: item.learnerName,
  message: item.message,
  currentMaterial: item.currentMaterial,
  conversation: item.conversation,
  sources: item.sources,
  ...(item.strategy ? { strategy: item.strategy } : {}),
  expect: item.expect,
});

const isRetryable = (error: unknown): boolean => error instanceof AiServiceError && error.retryable;

@Injectable()
export class BenchmarkService {
  private readonly logger = new Logger(BenchmarkService.name);
  retryDelayMs = BENCHMARK_RETRY_DELAY_MS;

  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly registry: PromptRegistryService,
    private readonly ai: AiServiceClient,
    @InjectQueue(PROMPT_BENCHMARK_QUEUE) private readonly queue: Queue,
  ) {}

  async loadDataset(name: string, expectedDigest?: string): Promise<{ dataset: BenchmarkDataset; digest: string; version: number }> {
    const row = await this.prisma.evaluationDataset.findUnique({ where: { name } });
    if (!row) throw new AppError(`The evaluation dataset ${name} is not seeded; run pnpm seed:evaluation`, 409, AppErrorCode.INVALID_STATE_TRANSITION);
    if (!row.isFrozen) throw new AppError(`The evaluation dataset ${name} is not frozen`, 409, AppErrorCode.INVALID_STATE_TRANSITION);
    const digest = datasetDigest(row.examplesJson);
    if (digest !== digestOfDescription(row.description) || (expectedDigest !== undefined && digest !== expectedDigest)) {
      throw new AppError(`The evaluation dataset ${name} does not match its recorded digest`, 409, AppErrorCode.INVALID_STATE_TRANSITION);
    }
    const dataset = benchmarkDatasetSchema.parse(row.examplesJson);
    const unknown = unknownSourceKeys(dataset);
    if (unknown.length > 0) throw new AppError(`The evaluation dataset names unknown sources: ${unknown.join(', ')}`, 409, AppErrorCode.INVALID_STATE_TRANSITION);
    return { dataset, digest, version: row.version };
  }

  private async activeRuns(): Promise<number> {
    const rows = await this.prisma.optimizationRun.findMany({ where: { optimizerName: BENCHMARK_OPTIMIZER }, select: { candidateJson: true }, orderBy: { createdAt: 'desc' }, take: 10 });
    return rows.filter((row) => ['QUEUED', 'RUNNING'].includes((row.candidateJson as unknown as BenchmarkPlan).status)).length;
  }

  private async templateOf(name: PromptName, candidatePromptId: string | undefined, baseline: BenchmarkTemplate): Promise<{ candidate: BenchmarkTemplate; identical: boolean }> {
    if (!candidatePromptId) return { candidate: { ...baseline, label: `${baseline.label} (repeat)`, promptId: null }, identical: true };
    const row = await this.prisma.promptVersion.findUnique({ where: { id: candidatePromptId } });
    if (!row || row.name !== name) throw new AppError('The candidate is not a version of this prompt', 422, AppErrorCode.VALIDATION_ERROR);
    const closed: PromptStatus[] = [PromptStatus.REJECTED, PromptStatus.ROLLED_BACK, PromptStatus.ARCHIVED];
    if (closed.includes(row.status)) throw new AppError(`A ${row.status} version cannot be benchmarked`, 409, AppErrorCode.INVALID_STATE_TRANSITION);
    return { candidate: { label: labelOf(row.name, row.version), hash: sha256(row.body), promptId: row.id, body: row.body }, identical: false };
  }

  async start(actor: Actor, dto: StartBenchmarkDtoType, traceId?: string) {
    this.policy.assertAdmin(actor);
    const name = dto.name as PromptName;
    if ((await this.activeRuns()) >= MAX_ACTIVE_BENCHMARKS) {
      throw new AppError('A benchmark is already queued or running; wait for it to finish', 409, AppErrorCode.INVALID_STATE_TRANSITION);
    }

    const { dataset, digest, version } = await this.loadDataset(dto.datasetName);
    const base = await this.registry.baseline(name);
    const baseline: BenchmarkTemplate = { label: base.label, hash: sha256(base.body), promptId: base.parentVersionId, body: base.body };
    const { candidate, identical } = await this.templateOf(name, dto.candidatePromptId, baseline);

    const problems = [...templateProblems(name, baseline.body), ...templateProblems(name, candidate.body)];
    if (problems.length > 0) throw new AppError(`A template is not valid: ${[...new Set(problems)].join('; ')}`, 422, AppErrorCode.VALIDATION_ERROR);

    const total = dataset.cases.length * dto.repeats * 2;
    const plan: BenchmarkPlan = {
      status: 'QUEUED',
      name,
      actorId: actor.id,
      datasetName: dataset.datasetName,
      datasetRole: datasetRole(dataset),
      datasetVersion: version,
      datasetDigest: digest,
      repeats: dto.repeats,
      judge: dto.judge,
      identicalArms: identical,
      baseline,
      candidate,
      progress: { done: 0, total },
      startedAt: null,
      completedAt: null,
      error: null,
      report: null,
    };
    const id = await this.registry.openBenchmarkRun(actor, plan, base.parentVersionId, traceId);
    await this.queue.add('run', { runId: id }, { jobId: id, attempts: 1, removeOnComplete: true, removeOnFail: { age: 7 * 24 * 60 * 60, count: 50 } });
    return { message: 'Benchmark queued', data: { id, status: plan.status, total, baseline: baseline.label, candidate: candidate.label, identicalArms: identical } };
  }

  async execute(runId: string, traceId?: string): Promise<void> {
    const row = await this.prisma.optimizationRun.findUnique({ where: { id: runId }, select: { optimizerName: true, candidateJson: true } });
    if (!row || row.optimizerName !== BENCHMARK_OPTIMIZER) throw new AppError('Benchmark run not found', 404, AppErrorCode.NOT_FOUND);
    const plan = row.candidateJson as unknown as BenchmarkPlan;
    if (plan.status !== 'QUEUED') return;

    await this.registry.updateBenchmarkRun(runId, { plan: { status: 'RUNNING', startedAt: new Date().toISOString() } }, traceId);
    try {
      const { dataset } = await this.loadDataset(plan.datasetName, plan.datasetDigest);
      const cases = resolveCases(dataset);
      const templates: Record<ArmName, BenchmarkTemplate> = { baseline: plan.baseline, candidate: plan.candidate };
      const tasks = buildTasks(templates, cases, plan.repeats);

      const arms = await executeTasks(templates, tasks, (task) => this.runCase(plan, runId, dataset, task, traceId), {
        concurrency: BENCHMARK_CONCURRENCY,
        retries: BENCHMARK_RETRIES,
        retryDelayMs: this.retryDelayMs,
        isRetryable,
        onProgress: async (done, total) => {
          if (done % PROGRESS_STEP === 0 || done === total) await this.registry.updateBenchmarkRun(runId, { plan: { progress: { done, total } } }, traceId);
        },
      });

      const failed = arms.baseline.failures.length + arms.candidate.failures.length;
      const ratio = failed / tasks.length;
      const comparison = compareArms(arms.baseline, arms.candidate);
      const report = {
        baseline: summarizeArm(arms.baseline),
        candidate: summarizeArm(arms.candidate),
        comparison,
        evidence: toOfflineEvidence({ runId, datasetDigest: plan.datasetDigest, repeats: plan.repeats, judged: plan.judge, comparison }),
      };
      const tooManyFailures = ratio > MAX_FAILURE_RATIO;
      await this.registry.updateBenchmarkRun(
        runId,
        {
          plan: {
            status: tooManyFailures ? 'FAILED' : 'COMPLETED',
            completedAt: new Date().toISOString(),
            progress: { done: tasks.length, total: tasks.length },
            error: tooManyFailures ? `${failed} of ${tasks.length} model calls failed, more than ${Math.round(MAX_FAILURE_RATIO * 100)} percent` : null,
            report,
          },
          baseResults: arms.baseline,
          candidateResults: arms.candidate,
        },
        traceId,
      );
    } catch (error) {
      this.logger.error(`Benchmark ${runId} failed: ${(error as Error).message}`);
      await this.registry.updateBenchmarkRun(runId, { plan: { status: 'FAILED', completedAt: new Date().toISOString(), error: (error as Error).message.slice(0, 500) } }, traceId);
    }
  }

  private async runCase(plan: BenchmarkPlan, runId: string, dataset: BenchmarkDataset, task: CaseTask, traceId?: string): Promise<CaseResult> {
    try {
      const result = await this.ai.post<Omit<CaseResult, 'repeat'>>({
        path: BENCHMARK_CASE_PATH,
        body: { template: { label: task.template.label, body: task.template.body }, case: caseForAi(task.item), protectedPhrases: dataset.protectedPhrases, judge: plan.judge },
        actingUserId: plan.actorId,
        idempotencyKey: deriveIdempotencyKey([runId, task.arm, task.item.id, String(task.repeat)]),
        traceId,
        timeoutMs: BENCHMARK_CASE_TIMEOUT_MS,
      });
      return { ...result, repeat: task.repeat };
    } catch (error) {
      if (error instanceof AiServiceError && error.status !== null && [401, 403, 422].includes(error.status)) {
        throw new FatalBenchmarkError(`The AI service refused the benchmark (${error.status}) for ${task.arm} on ${task.item.id}`);
      }
      throw error;
    }
  }

  async proposalEvidence(actor: Actor, id: string): Promise<{ plan: BenchmarkPlan; evidence: ProposerBenchmarkEvidence }> {
    this.policy.assertAdmin(actor);
    const row = await this.prisma.optimizationRun.findUnique({ where: { id }, select: { optimizerName: true, candidateJson: true, baseMetricsJson: true } });
    if (!row || row.optimizerName !== BENCHMARK_OPTIMIZER) throw new AppError('Benchmark run not found', 404, AppErrorCode.NOT_FOUND);
    const plan = row.candidateJson as unknown as BenchmarkPlan;
    if (plan.status !== 'COMPLETED' || !plan.report) {
      throw new AppError('Only a completed benchmark run can feed a proposal', 409, AppErrorCode.INVALID_STATE_TRANSITION);
    }
    const { dataset } = await this.loadDataset(plan.datasetName, plan.datasetDigest);
    if (plan.datasetRole !== 'DEVELOPMENT' || datasetRole(dataset) !== 'DEVELOPMENT') {
      throw new AppError('Only a run on the development set can feed a proposal; the benchmark that judges candidates is never shown to the proposer', 409, AppErrorCode.INVALID_STATE_TRANSITION);
    }
    const results = (row.baseMetricsJson as { results?: CaseResult[] } | null)?.results ?? [];
    const evidence = buildProposerEvidence({ results, cases: resolveCases(dataset), summary: plan.report.baseline, datasetName: plan.datasetName, datasetDigest: plan.datasetDigest, repeats: plan.repeats });
    return { plan, evidence };
  }

  async list(actor: Actor) {
    this.policy.assertAdmin(actor);
    const rows = await this.prisma.optimizationRun.findMany({
      where: { optimizerName: BENCHMARK_OPTIMIZER },
      select: { id: true, createdAt: true, decision: true, rationale: true, decidedBy: true, decidedAt: true, candidateJson: true },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return { message: 'Successfully retrieved benchmarks', data: rows.map((row) => this.summary(row)) };
  }

  private summary(row: { id: string; createdAt: Date; decision: string; rationale: string | null; decidedBy: string | null; decidedAt: Date | null; candidateJson: unknown }) {
    const plan = row.candidateJson as BenchmarkPlan;
    return {
      id: row.id,
      createdAt: row.createdAt,
      status: plan.status,
      name: plan.name,
      baseline: plan.baseline.label,
      candidate: plan.candidate.label,
      candidatePromptId: plan.candidate.promptId,
      identicalArms: plan.identicalArms,
      datasetName: plan.datasetName,
      datasetRole: plan.datasetRole,
      datasetDigest: plan.datasetDigest,
      repeats: plan.repeats,
      judge: plan.judge,
      progress: plan.progress,
      startedAt: plan.startedAt,
      completedAt: plan.completedAt,
      error: plan.error,
      decision: row.decision,
      decisionRationale: row.rationale,
      decidedBy: row.decidedBy,
      decidedAt: row.decidedAt,
    };
  }

  async detail(actor: Actor, id: string) {
    this.policy.assertAdmin(actor);
    const row = await this.prisma.optimizationRun.findUnique({
      where: { id },
      select: { id: true, optimizerName: true, createdAt: true, decision: true, rationale: true, decidedBy: true, decidedAt: true, candidateJson: true },
    });
    if (!row || row.optimizerName !== BENCHMARK_OPTIMIZER) throw new AppError('Benchmark run not found', 404, AppErrorCode.NOT_FOUND);
    const plan = row.candidateJson as unknown as BenchmarkPlan;
    const criteria = plan.report ? offlineCriteria(plan.report.evidence) : [];
    return {
      message: 'Successfully retrieved the benchmark',
      data: { ...this.summary(row), baselineHash: plan.baseline.hash, candidateHash: plan.candidate.hash, report: plan.report, criteria },
    };
  }

  async caseDetail(actor: Actor, id: string, caseId: string) {
    this.policy.assertAdmin(actor);
    const row = await this.prisma.optimizationRun.findUnique({
      where: { id },
      select: { optimizerName: true, candidateJson: true, baseMetricsJson: true, candidateMetricsJson: true },
    });
    if (!row || row.optimizerName !== BENCHMARK_OPTIMIZER) throw new AppError('Benchmark run not found', 404, AppErrorCode.NOT_FOUND);
    const plan = row.candidateJson as unknown as BenchmarkPlan;
    const { dataset } = await this.loadDataset(plan.datasetName, plan.datasetDigest);
    const item = resolveCases(dataset).find((candidate) => candidate.id === caseId);
    if (!item) throw new AppError('Case not found', 404, AppErrorCode.NOT_FOUND);
    const pick = (value: unknown): CaseResult[] => ((value as { results?: CaseResult[] } | null)?.results ?? []).filter((result) => result.caseId === caseId);
    return {
      message: 'Successfully retrieved the case',
      data: {
        case: { id: item.id, category: item.category, risk: item.risk, message: item.message, expect: item.expect },
        baseline: pick(row.baseMetricsJson),
        candidate: pick(row.candidateMetricsJson),
      },
    };
  }
}
