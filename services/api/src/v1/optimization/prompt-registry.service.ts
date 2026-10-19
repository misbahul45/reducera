import { createHash } from 'crypto';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { Injectable } from '@nestjs/common';
import { OptimizationDecision, Prisma, PromptStatus, PromptVersion } from '@prisma/client';
import { Actor, PolicyService } from '@/common/authz/policy.service';
import { AuditService } from '@/common/authz/audit.service';
import { PrismaService } from '@/common/config/prisma/prisma.service';
import { AppError, AppErrorCode } from '@/common/lib/error';
import { GateResult, OfflineEvidence, PromptMetrics, evaluateGate, offlineBlockers } from './acceptance-gate';
import { BENCHMARK_OPTIMIZER, BenchmarkPlan } from './benchmark/benchmark.types';
import { ApprovePromptDtoType, BenchmarkDecisionDtoType, ProposePromptDtoType, StartCanaryDtoType } from './optimization.dto';
import { PROMPT_CONTRACTS, PromptName, labelOf, templateProblems } from './prompt-contracts';
import { PromptMetricsService } from './prompt-metrics.service';
import { assertPromptTransition } from './prompt-state';

export interface ResolvedPrompt {
  label: string;
  version: number;
  body: string;
  modelName: string;
  arm: 'active' | 'canary';
}

export interface PromptBaseline {
  label: string;
  body: string;
  parentVersionId: string | null;
  modelName: string;
}

export interface ProposalOrigin {
  kind: 'AI_PROPOSED';
  evidence: Prisma.InputJsonValue;
  changes: string[];
}

export const BUILTIN_MODEL_NAME = 'router-default';

export interface CanarySweep {
  inspected: number;
  validated: string[];
  rolledBack: string[];
  undecided: string[];
  failed: { label: string; message: string }[];
}

const toAuditState =(row: Pick<PromptVersion, 'status' | 'canaryPercent'>): Prisma.InputJsonValue => ({
  status: row.status,
  canaryPercent: row.canaryPercent,
});

export const bucketOf = (userId: string, name: string): number =>
  createHash('sha256').update(`${name}:${userId}`).digest().readUInt32BE(0) % 100;

@Injectable()
export class PromptRegistryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly metrics: PromptMetricsService,
  ) {}

  async list(actor: Actor, name?: PromptName) {
    this.policy.assertAdmin(actor);
    const versions = await this.prisma.promptVersion.findMany({
      where: name ? { name } : {},
      orderBy: [{ name: 'asc' }, { version: 'desc' }],
    });
    const builtinNames = (Object.keys(PROMPT_CONTRACTS) as PromptName[]).filter((candidate) => !name || candidate === name);
    const builtin = await Promise.all(
      builtinNames.map(async (candidate) => ({
        name: candidate,
        label: PROMPT_CONTRACTS[candidate].builtinLabel,
        metrics: await this.metrics.forLabel(PROMPT_CONTRACTS[candidate].builtinLabel),
      })),
    );
    const withMetrics = await Promise.all(
      versions.map(async (version) => {
        const label = labelOf(version.name, version.version);
        return {
          id: version.id,
          name: version.name,
          version: version.version,
          label,
          status: version.status,
          canaryPercent: version.canaryPercent,
          modelName: version.modelName,
          createdBy: version.createdBy,
          createdAt: version.createdAt,
          parentVersionId: version.parentVersionId,
          rationale: (version.metricsJson as { rationale?: string } | null)?.rationale ?? null,
          origin: (version.metricsJson as { origin?: string } | null)?.origin ?? 'HUMAN',
          changes: (version.metricsJson as { changes?: string[] } | null)?.changes ?? [],
          body: version.body,
          metrics: await this.metrics.forLabel(label),
        };
      }),
    );
    return { message: 'Successfully retrieved prompt versions', data: { versions: withMetrics, builtin } };
  }

  async builtin(actor: Actor, name: PromptName) {
    this.policy.assertAdmin(actor);
    const body = await readFile(join(process.cwd(), 'prisma', 'seed-data', 'prompt-templates', `${name}.txt`), 'utf8');
    return { message: 'Builtin prompt template', data: { name, label: PROMPT_CONTRACTS[name].builtinLabel, body } };
  }

  async runs(actor: Actor) {
    this.policy.assertAdmin(actor);
    const runs = await this.prisma.optimizationRun.findMany({ where: { optimizerName: { not: BENCHMARK_OPTIMIZER } }, orderBy: { createdAt: 'desc' }, take: 50 });
    return { message: 'Successfully retrieved optimization runs', data: runs };
  }

  async openBenchmarkRun(actor: Actor, plan: BenchmarkPlan, basePromptVersionId: string | null = null, traceId?: string): Promise<string> {
    this.policy.assertAdmin(actor);
    const created = await this.prisma.$transaction(async (tx) => {
      const run = await tx.optimizationRun.create({
        data: {
          optimizerName: BENCHMARK_OPTIMIZER,
          basePromptVersionId,
          candidateJson: plan as unknown as Prisma.InputJsonValue,
          baseMetricsJson: {},
          candidateMetricsJson: {},
          decision: OptimizationDecision.PENDING,
          rationale: 'The offline benchmark is queued; a person decides after it completes',
        },
      });
      await this.audit.record(
        {
          actorId: actor.id,
          actorRole: actor.role,
          action: 'BENCHMARK_STARTED',
          entityType: 'OptimizationRun',
          entityId: run.id,
          after: { baseline: plan.baseline.label, candidate: plan.candidate.label, datasetDigest: plan.datasetDigest, repeats: plan.repeats, judge: plan.judge },
          reason: `Offline benchmark of ${plan.candidate.label} against ${plan.baseline.label}`,
          traceId,
        },
        tx,
      );
      return run;
    });
    return created.id;
  }

  async updateBenchmarkRun(id: string, patch: { plan?: Partial<BenchmarkPlan>; baseResults?: unknown; candidateResults?: unknown }, traceId?: string): Promise<void> {
    const row = await this.prisma.optimizationRun.findUnique({ where: { id }, select: { optimizerName: true, candidateJson: true, decidedAt: true } });
    if (!row || row.optimizerName !== BENCHMARK_OPTIMIZER) throw new AppError('Benchmark run not found', 404, AppErrorCode.NOT_FOUND);
    if (row.decidedAt) throw new AppError('A benchmark run that a person decided on cannot change', 409, AppErrorCode.INVALID_STATE_TRANSITION);
    const before = row.candidateJson as unknown as BenchmarkPlan;
    const plan = { ...before, ...patch.plan };
    await this.prisma.$transaction(async (tx) => {
      await tx.optimizationRun.update({
        where: { id },
        data: {
          candidateJson: plan as unknown as Prisma.InputJsonValue,
          ...(patch.baseResults === undefined ? {} : { baseMetricsJson: patch.baseResults as Prisma.InputJsonValue }),
          ...(patch.candidateResults === undefined ? {} : { candidateMetricsJson: patch.candidateResults as Prisma.InputJsonValue }),
        },
      });
      if (before.status !== plan.status && (plan.status === 'COMPLETED' || plan.status === 'FAILED')) {
        await this.audit.record(
          {
            actorId: null,
            actorRole: null,
            action: plan.status === 'COMPLETED' ? 'BENCHMARK_COMPLETED' : 'BENCHMARK_FAILED',
            entityType: 'OptimizationRun',
            entityId: id,
            after: { status: plan.status, error: plan.error, evidenceRunId: plan.report?.evidence.runId ?? null },
            reason: plan.error ?? 'The offline benchmark finished',
            traceId,
          },
          tx,
        );
      }
    });
  }

  async decideBenchmarkRun(actor: Actor, id: string, dto: BenchmarkDecisionDtoType, traceId?: string) {
    this.policy.assertAdmin(actor);
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`benchmark:${id}`}))`;
      const row = await tx.optimizationRun.findUnique({ where: { id }, select: { optimizerName: true, candidateJson: true, decidedAt: true, decision: true } });
      if (!row || row.optimizerName !== BENCHMARK_OPTIMIZER) throw new AppError('Benchmark run not found', 404, AppErrorCode.NOT_FOUND);
      if ((row.candidateJson as unknown as BenchmarkPlan).status !== 'COMPLETED') {
        throw new AppError('Only a completed benchmark can be decided on', 409, AppErrorCode.INVALID_STATE_TRANSITION);
      }
      if (row.decidedAt) throw new AppError('This benchmark was already decided on', 409, AppErrorCode.INVALID_STATE_TRANSITION);
      const decided = await tx.optimizationRun.update({
        where: { id },
        data: { decision: dto.decision as OptimizationDecision, rationale: dto.rationale, decidedBy: actor.id, decidedAt: new Date() },
        select: { id: true, decision: true, decidedBy: true, decidedAt: true },
      });
      await this.audit.record(
        {
          actorId: actor.id,
          actorRole: actor.role,
          action: 'BENCHMARK_DECIDED',
          entityType: 'OptimizationRun',
          entityId: id,
          before: { decision: row.decision },
          after: { decision: decided.decision },
          reason: dto.rationale,
          traceId,
        },
        tx,
      );
      return { message: 'Benchmark decision recorded', data: decided };
    });
  }

  async offlineEvidenceFor(promptId: string): Promise<OfflineEvidence | null> {
    const rows = await this.prisma.optimizationRun.findMany({
      where: { optimizerName: BENCHMARK_OPTIMIZER, candidateJson: { path: ['candidate', 'promptId'], equals: promptId } },
      select: { candidateJson: true },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });
    for (const row of rows) {
      const plan = row.candidateJson as unknown as BenchmarkPlan;
      if (plan.status === 'COMPLETED' && plan.report && !plan.identicalArms) return plan.report.evidence;
    }
    return null;
  }

  async baseline(name: PromptName): Promise<PromptBaseline> {
    const active = await this.prisma.promptVersion.findFirst({ where: { name, status: PromptStatus.ACTIVE } });
    if (active) {
      return { label: labelOf(active.name, active.version), body: active.body, parentVersionId: active.id, modelName: active.modelName };
    }
    const body = await readFile(join(process.cwd(), 'prisma', 'seed-data', 'prompt-templates', `${name}.txt`), 'utf8');
    return { label: PROMPT_CONTRACTS[name].builtinLabel, body, parentVersionId: null, modelName: BUILTIN_MODEL_NAME };
  }

  async propose(actor: Actor, dto: ProposePromptDtoType, traceId?: string, origin?: ProposalOrigin) {
    this.policy.assertAdmin(actor);
    const problems = templateProblems(dto.name, dto.body);
    if (problems.length > 0) {
      throw new AppError(`The template is not valid: ${problems.join('; ')}`, 422, AppErrorCode.VALIDATION_ERROR);
    }

    const created = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`prompt:${dto.name}`}))`;
      if (dto.parentVersionId) {
        const parent = await tx.promptVersion.findUnique({ where: { id: dto.parentVersionId }, select: { name: true } });
        if (!parent || parent.name !== dto.name) {
          throw new AppError('The parent version is not a version of this prompt', 422, AppErrorCode.VALIDATION_ERROR);
        }
      }
      const latest = await tx.promptVersion.aggregate({ where: { name: dto.name }, _max: { version: true } });
      const row = await tx.promptVersion.create({
        data: {
          name: dto.name,
          version: (latest._max.version ?? 0) + 1,
          body: dto.body,
          modelName: dto.modelName,
          temperature: dto.temperature ?? null,
          status: PromptStatus.DRAFT,
          createdBy: actor.id,
          parentVersionId: dto.parentVersionId ?? null,
          metricsJson: origin
            ? { rationale: dto.rationale, origin: origin.kind, changes: origin.changes, evidence: origin.evidence }
            : { rationale: dto.rationale },
        },
      });
      await this.audit.record(
        {
          actorId: actor.id,
          actorRole: actor.role,
          action: origin ? 'PROMPT_PROPOSED_BY_AI' : 'PROMPT_PROPOSED',
          entityType: 'PromptVersion',
          entityId: row.id,
          after: { name: row.name, version: row.version, status: row.status },
          reason: dto.rationale,
          traceId,
        },
        tx,
      );
      return row;
    });
    return { message: 'Prompt version proposed', data: { id: created.id, label: labelOf(created.name, created.version), status: created.status } };
  }

  async startCanary(actor: Actor, id: string, dto: StartCanaryDtoType, traceId?: string) {
    this.policy.assertAdmin(actor);
    const blockers = offlineBlockers(await this.offlineEvidenceFor(id));
    if (blockers.length > 0) {
      throw new AppError(`The offline benchmark of this version failed (${blockers.join(', ')}); a canary would expose learners to it`, 409, AppErrorCode.INVALID_STATE_TRANSITION);
    }
    const result = await this.prisma.$transaction(async (tx) => {
      const row = await this.lock(tx, id);
      if (row.status === PromptStatus.EXPERIMENTAL && row.canaryPercent === dto.percent) return { row, changed: false };
      assertPromptTransition(row.status, PromptStatus.EXPERIMENTAL);

      const running = await tx.promptVersion.findFirst({ where: { name: row.name, status: PromptStatus.EXPERIMENTAL }, select: { version: true } });
      if (running) {
        throw new AppError(`Version ${running.version} is already running as the canary of this prompt`, 409, AppErrorCode.INVALID_STATE_TRANSITION);
      }

      const updated = await tx.promptVersion.update({ where: { id }, data: { status: PromptStatus.EXPERIMENTAL, canaryPercent: dto.percent } });
      await this.audit.record(
        {
          actorId: actor.id,
          actorRole: actor.role,
          action: 'PROMPT_CANARY_STARTED',
          entityType: 'PromptVersion',
          entityId: id,
          before: toAuditState(row),
          after: toAuditState(updated),
          reason: dto.reason,
          traceId,
        },
        tx,
      );
      return { row: updated, changed: true };
    });
    return { message: 'Canary started', data: { id, status: result.row.status, canaryPercent: result.row.canaryPercent, changed: result.changed } };
  }

  async evaluate(actor: Actor, id: string, traceId?: string) {
    this.policy.assertAdmin(actor);
    return this.evaluateCanary(id, { actor, traceId, recordInconclusive: true });
  }

  async evaluateRunningCanaries(traceId?: string): Promise<CanarySweep> {
    const canaries = await this.prisma.promptVersion.findMany({
      where: { status: PromptStatus.EXPERIMENTAL },
      select: { id: true, name: true, version: true },
      orderBy: [{ name: 'asc' }, { version: 'asc' }],
    });
    const sweep: CanarySweep = { inspected: canaries.length, validated: [], rolledBack: [], undecided: [], failed: [] };
    for (const canary of canaries) {
      const label = labelOf(canary.name, canary.version);
      try {
        const evaluated = await this.evaluateCanary(canary.id, { traceId, recordInconclusive: false });
        if (evaluated.data.status === PromptStatus.VALIDATED) sweep.validated.push(label);
        else if (evaluated.data.status === PromptStatus.ROLLED_BACK) sweep.rolledBack.push(label);
        else sweep.undecided.push(label);
      } catch (error) {
        sweep.failed.push({ label, message: (error as Error).message });
      }
    }
    return sweep;
  }

  private async evaluateCanary(id: string, context: { actor?: Actor; traceId?: string; recordInconclusive: boolean }) {
    const { actor, traceId, recordInconclusive } = context;
    const row = await this.prisma.promptVersion.findUnique({ where: { id } });
    if (!row) throw new AppError('Prompt version not found', 404, AppErrorCode.NOT_FOUND);
    if (row.status !== PromptStatus.EXPERIMENTAL) {
      throw new AppError('Only a version running as a canary can be evaluated', 409, AppErrorCode.INVALID_STATE_TRANSITION);
    }

    const active = await this.prisma.promptVersion.findFirst({ where: { name: row.name, status: PromptStatus.ACTIVE } });
    const baselineLabel = active ? labelOf(active.name, active.version) : PROMPT_CONTRACTS[row.name as PromptName].builtinLabel;
    const candidateLabel = labelOf(row.name, row.version);
    const [baseline, candidate, offline] = await Promise.all([this.metrics.forLabel(baselineLabel), this.metrics.forLabel(candidateLabel), this.offlineEvidenceFor(id)]);
    const gate = evaluateGate(baseline, candidate, offline);

    return this.prisma.$transaction(async (tx) => {
      const locked = await this.lock(tx, id);
      if (locked.status !== PromptStatus.EXPERIMENTAL) {
        throw new AppError('The version changed while it was evaluated', 409, AppErrorCode.INVALID_STATE_TRANSITION);
      }

      const target = gate.regression ? PromptStatus.ROLLED_BACK : gate.passed ? PromptStatus.VALIDATED : PromptStatus.EXPERIMENTAL;
      const decision = gate.regression ? OptimizationDecision.REJECTED : gate.passed ? OptimizationDecision.PENDING : OptimizationDecision.DEFERRED;
      const rationale = gate.regression ? 'Automatic rollback: the candidate regressed against the baseline' : gate.passed ? 'The gate passed; waiting for a human decision' : 'The gate has not passed yet';

      if (target === PromptStatus.EXPERIMENTAL && !recordInconclusive) {
        return {
          message: 'Prompt version evaluated',
          data: { status: locked.status, gate, baselineLabel, candidateLabel, runId: null as string | null, decision: null as OptimizationDecision | null },
        };
      }

      const updated =
        target === PromptStatus.EXPERIMENTAL
          ? locked
          : await tx.promptVersion.update({ where: { id }, data: { status: target, canaryPercent: 0 } });
      if (target !== PromptStatus.EXPERIMENTAL) assertPromptTransition(locked.status, target);

      const run = await tx.optimizationRun.create({
        data: {
          optimizerName: 'registry-evaluation',
          basePromptVersionId: active?.id ?? null,
          candidateJson: { promptVersionId: id, label: candidateLabel, baselineLabel, gate } as unknown as Prisma.InputJsonValue,
          baseMetricsJson: baseline as unknown as Prisma.InputJsonValue,
          candidateMetricsJson: candidate as unknown as Prisma.InputJsonValue,
          decision,
          rationale,
        },
      });

      await this.audit.record(
        {
          actorId: actor?.id ?? null,
          actorRole: actor?.role ?? null,
          action: gate.regression ? 'PROMPT_AUTO_ROLLED_BACK' : 'PROMPT_EVALUATED',
          entityType: 'PromptVersion',
          entityId: id,
          before: toAuditState(locked),
          after: toAuditState(updated),
          reason: rationale,
          traceId,
        },
        tx,
      );

      return {
        message: 'Prompt version evaluated',
        data: { status: updated.status, gate, baselineLabel, candidateLabel, runId: run.id as string | null, decision: run.decision as OptimizationDecision | null },
      };
    });
  }

  async approve(actor: Actor, id: string, dto: ApprovePromptDtoType, traceId?: string) {
    this.policy.assertAdmin(actor);
    const result = await this.prisma.$transaction(async (tx) => {
      const row = await this.lock(tx, id);
      if (row.status === PromptStatus.ACTIVE) return { row, changed: false };
      assertPromptTransition(row.status, PromptStatus.ACTIVE);

      const previous = await tx.promptVersion.findFirst({ where: { name: row.name, status: PromptStatus.ACTIVE } });
      if (previous) {
        assertPromptTransition(previous.status, PromptStatus.ARCHIVED);
        await tx.promptVersion.update({ where: { id: previous.id }, data: { status: PromptStatus.ARCHIVED } });
      }
      const updated = await tx.promptVersion.update({ where: { id }, data: { status: PromptStatus.ACTIVE, canaryPercent: 0 } });

      const runs = await tx.optimizationRun.findMany({
        where: { candidateJson: { path: ['promptVersionId'], equals: id }, decision: OptimizationDecision.PENDING },
        select: { id: true },
      });
      await tx.optimizationRun.updateMany({
        where: { id: { in: runs.map((run) => run.id) } },
        data: { decision: OptimizationDecision.ACCEPTED, decidedBy: actor.id, decidedAt: new Date(), rationale: dto.reason },
      });

      await this.audit.record(
        {
          actorId: actor.id,
          actorRole: actor.role,
          action: 'PROMPT_APPROVED',
          entityType: 'PromptVersion',
          entityId: id,
          before: toAuditState(row),
          after: { ...(toAuditState(updated) as object), replaced: previous?.id ?? null, unmeasuredAcknowledged: true },
          reason: dto.reason,
          traceId,
        },
        tx,
      );
      return { row: updated, changed: true };
    });
    return { message: 'Prompt version approved', data: { id, status: result.row.status, changed: result.changed } };
  }

  async reject(actor: Actor, id: string, reason: string, traceId?: string) {
    this.policy.assertAdmin(actor);
    const result = await this.prisma.$transaction(async (tx) => {
      const row = await this.lock(tx, id);
      if (row.status === PromptStatus.REJECTED) return { row, changed: false };
      assertPromptTransition(row.status, PromptStatus.REJECTED);

      const updated = await tx.promptVersion.update({ where: { id }, data: { status: PromptStatus.REJECTED, canaryPercent: 0 } });
      const runs = await tx.optimizationRun.findMany({
        where: { candidateJson: { path: ['promptVersionId'], equals: id }, decision: { in: [OptimizationDecision.PENDING, OptimizationDecision.DEFERRED] } },
        select: { id: true },
      });
      await tx.optimizationRun.updateMany({
        where: { id: { in: runs.map((run) => run.id) } },
        data: { decision: OptimizationDecision.REJECTED, decidedBy: actor.id, decidedAt: new Date(), rationale: reason },
      });
      await this.audit.record(
        { actorId: actor.id, actorRole: actor.role, action: 'PROMPT_REJECTED', entityType: 'PromptVersion', entityId: id, before: toAuditState(row), after: toAuditState(updated), reason, traceId },
        tx,
      );
      return { row: updated, changed: true };
    });
    return { message: 'Prompt version rejected', data: { id, status: result.row.status, changed: result.changed } };
  }

  async rollback(actor: Actor, id: string, reason: string, traceId?: string) {
    this.policy.assertAdmin(actor);
    const result = await this.prisma.$transaction(async (tx) => {
      const row = await this.lock(tx, id);
      if (row.status === PromptStatus.ROLLED_BACK) return { row, restored: null as string | null, changed: false };
      assertPromptTransition(row.status, PromptStatus.ROLLED_BACK);

      const updated = await tx.promptVersion.update({ where: { id }, data: { status: PromptStatus.ROLLED_BACK, canaryPercent: 0 } });
      const previous = await tx.promptVersion.findFirst({ where: { name: row.name, status: PromptStatus.ARCHIVED }, orderBy: { version: 'desc' } });
      if (previous) {
        assertPromptTransition(previous.status, PromptStatus.ACTIVE);
        await tx.promptVersion.update({ where: { id: previous.id }, data: { status: PromptStatus.ACTIVE } });
      }
      await this.audit.record(
        {
          actorId: actor.id,
          actorRole: actor.role,
          action: 'PROMPT_ROLLED_BACK',
          entityType: 'PromptVersion',
          entityId: id,
          before: toAuditState(row),
          after: { ...(toAuditState(updated) as object), restored: previous?.id ?? null },
          reason,
          traceId,
        },
        tx,
      );
      return { row: updated, restored: previous?.id ?? null, changed: true };
    });
    return { message: 'Prompt version rolled back', data: { id, status: result.row.status, restoredVersionId: result.restored, changed: result.changed } };
  }

  async resolve(userId: string, name: PromptName): Promise<ResolvedPrompt | null> {
    const [active, canary] = await Promise.all([
      this.prisma.promptVersion.findFirst({ where: { name, status: PromptStatus.ACTIVE } }),
      this.prisma.promptVersion.findFirst({ where: { name, status: PromptStatus.EXPERIMENTAL, canaryPercent: { gt: 0 } } }),
    ]);
    const chosen = canary && bucketOf(userId, name) < canary.canaryPercent ? { row: canary, arm: 'canary' as const } : active ? { row: active, arm: 'active' as const } : null;
    if (!chosen) return null;
    return {
      label: labelOf(chosen.row.name, chosen.row.version),
      version: chosen.row.version,
      body: chosen.row.body,
      modelName: chosen.row.modelName,
      arm: chosen.arm,
    };
  }

  private async lock(tx: Prisma.TransactionClient, id: string): Promise<PromptVersion> {
    await tx.$queryRaw`SELECT id FROM "PromptVersion" WHERE id = ${id} FOR UPDATE`;
    const row = await tx.promptVersion.findUnique({ where: { id } });
    if (!row) throw new AppError('Prompt version not found', 404, AppErrorCode.NOT_FOUND);
    return row;
  }
}

export type { GateResult, PromptMetrics };
