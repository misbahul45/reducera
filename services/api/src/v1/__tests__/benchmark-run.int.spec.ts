import { randomUUID } from 'crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Pool } from 'pg';
import { AuditService } from '@/common/authz/audit.service';
import { PolicyService } from '@/common/authz/policy.service';
import { PrismaService } from '@/common/config/prisma/prisma.service';
import { OfflineDimension, OfflineEvidence } from '@/v1/optimization/acceptance-gate';
import { benchmarkDatasetSchema, datasetDigest, digestOfDescription } from '@/v1/optimization/benchmark/benchmark-dataset';
import { BenchmarkSeeder } from '@/v1/optimization/benchmark/benchmark-seeder';
import { BenchmarkPlan } from '@/v1/optimization/benchmark/benchmark.types';
import { MIN_TEMPLATE_LENGTH } from '@/v1/optimization/prompt-contracts';
import { PromptMetricsService } from '@/v1/optimization/prompt-metrics.service';
import { PromptRegistryService } from '@/v1/optimization/prompt-registry.service';
import { createPool, databaseUrl, describeDb, expectViolation, holdSuiteLock, insertUser, withRollback } from '@/test-utils/pg-fixtures';

const PROMPT_SUITE_LOCK = 7_461_002;
const SOURCE_FILE = join(process.cwd(), 'prisma', 'seed-data', 'evaluation', 'tutor-chat-benchmark.v1.json');

const dimension = (over: Partial<OfflineDimension> = {}): OfflineDimension => ({ baseline: 0.7, candidate: 0.72, diff: 0.02, lower: -0.02, upper: 0.06, pairedCases: 56, ...over });

const evidence = (runId: string, over: Partial<OfflineEvidence> = {}): OfflineEvidence => ({
  runId,
  datasetDigest: 'a'.repeat(64),
  repeats: 1,
  pairedCases: 56,
  judged: true,
  judgeCalibrated: false,
  correctness: dimension(),
  citation: dimension(),
  safety: { ...dimension({ baseline: 1, candidate: 1, diff: 0, lower: 0, upper: 0 }), regressions: [] },
  pedagogy: dimension({ baseline: 3.5, candidate: 3.6, diff: 0.1, lower: -0.05, upper: 0.25 }),
  ...over,
});

describeDb('offline benchmark evidence is governed on the database (requires TEST_DATABASE_URL)', () => {
  let prisma: PrismaService;
  let pool: Pool;
  let registry: PromptRegistryService;
  let releaseLock: () => Promise<void>;
  let admin: { id: string; role: 'ADMIN' };
  let learner: { id: string; role: 'STUDENT' };
  const ids = { users: [] as string[], datasets: [] as string[] };

  const template = (marker: string) =>
    `${marker} ${'Teach with care. '.repeat(Math.ceil(MIN_TEMPLATE_LENGTH / 17))} {{user_step_title}} {{domain_block}} {{learner_section}} {{user_input}} {{rag}} {{web}} {{memory}} {{conversation}} {{current_material}}`;

  const propose = async (marker: string) => (await registry.propose(admin, { name: 'tutor-chat', body: template(marker), modelName: 'router-default', rationale: `candidate ${marker}` })).data;

  const plan = (over: Partial<BenchmarkPlan> = {}): BenchmarkPlan => ({
    status: 'QUEUED',
    name: 'tutor-chat',
    actorId: admin.id,
    datasetName: 'tutor-chat-benchmark-v1',
    datasetRole: 'BENCHMARK',
    datasetVersion: 1,
    datasetDigest: 'a'.repeat(64),
    repeats: 1,
    judge: true,
    identicalArms: false,
    baseline: { label: 'tutor-chat-builtin-3', hash: 'b'.repeat(64), promptId: null, body: template('base') },
    candidate: { label: 'tutor-chat@1', hash: 'c'.repeat(64), promptId: null, body: template('cand') },
    progress: { done: 0, total: 112 },
    startedAt: null,
    completedAt: null,
    error: null,
    report: null,
    ...over,
  });

  const completed = async (runId: string, evidenceOver: Partial<OfflineEvidence> = {}) => {
    const report = { baseline: {}, candidate: {}, comparison: {}, evidence: evidence(runId, evidenceOver) } as unknown as NonNullable<BenchmarkPlan['report']>;
    await registry.updateBenchmarkRun(runId, { plan: { status: 'COMPLETED', completedAt: new Date().toISOString(), report }, baseResults: { results: [] }, candidateResults: { results: [] } });
  };

  const cleanup = async () => {
    await prisma.optimizationRun.deleteMany({});
    await prisma.promptVersion.deleteMany({ where: { name: 'tutor-chat' } });
  };

  const freshFile = (mutate: (dataset: Record<string, unknown>) => void = () => undefined) => {
    const dataset = JSON.parse(readFileSync(SOURCE_FILE, 'utf8')) as Record<string, unknown>;
    dataset.datasetName = `bench-int-${randomUUID().slice(0, 8)}`;
    mutate(dataset);
    const file = join(mkdtempSync(join(tmpdir(), 'bench-')), 'dataset.json');
    writeFileSync(file, JSON.stringify(dataset));
    ids.datasets.push(dataset.datasetName as string);
    return { file, name: dataset.datasetName as string };
  };

  beforeAll(async () => {
    releaseLock = await holdSuiteLock(PROMPT_SUITE_LOCK);
    process.env.DATABASE_URL = databaseUrl;
    prisma = new PrismaService();
    pool = createPool();
    registry = new PromptRegistryService(prisma, new PolicyService(), new AuditService(prisma), new PromptMetricsService(prisma));
    admin = { id: await insertUser(pool, 'ADMIN'), role: 'ADMIN' };
    learner = { id: await insertUser(pool), role: 'STUDENT' };
    ids.users.push(admin.id, learner.id);
    await cleanup();
  }, 120_000);

  afterEach(async () => {
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await pool.query(`ALTER TABLE "EvaluationDataset" DISABLE TRIGGER "EvaluationDataset_frozen_guard"`);
    await prisma.evaluationDataset.deleteMany({ where: { name: { in: ids.datasets } } });
    await pool.query(`ALTER TABLE "EvaluationDataset" ENABLE TRIGGER "EvaluationDataset_frozen_guard"`);
    await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
    await prisma.$disconnect();
    await pool.end();
    await releaseLock();
  });

  describe('the frozen dataset', () => {
    it('is stored frozen with its digest, and seeding again only verifies it', async () => {
      const { file, name } = freshFile();

      const first = await new BenchmarkSeeder(prisma, file).run();
      const second = await new BenchmarkSeeder(prisma, file).run();

      const row = await prisma.evaluationDataset.findUniqueOrThrow({ where: { name } });
      expect(first.created).toBe(true);
      expect(second.created).toBe(false);
      expect(row.isFrozen).toBe(true);
      expect(digestOfDescription(row.description)).toBe(first.digest);
      expect(datasetDigest(row.examplesJson)).toBe(first.digest);
      expect(benchmarkDatasetSchema.parse(row.examplesJson).cases.length).toBeGreaterThanOrEqual(50);
      expect(await prisma.evaluationDataset.count({ where: { name } })).toBe(1);
    });

    it('refuses a file that differs from the frozen row and leaves the row untouched', async () => {
      const { file, name } = freshFile();
      await new BenchmarkSeeder(prisma, file).run();
      const before = await prisma.evaluationDataset.findUniqueOrThrow({ where: { name } });
      const edited = JSON.parse(readFileSync(file, 'utf8')) as { cases: Array<{ message: string }> };
      edited.cases[0].message = `${edited.cases[0].message} (edited)`;
      writeFileSync(file, JSON.stringify(edited));

      await expect(new BenchmarkSeeder(prisma, file).run()).rejects.toThrow(/frozen dataset .* differs/);

      const after = await prisma.evaluationDataset.findUniqueOrThrow({ where: { name } });
      expect(datasetDigest(after.examplesJson)).toBe(datasetDigest(before.examplesJson));
    });

    it('refuses a file that is not a valid dataset before writing anything', async () => {
      const { file, name } = freshFile((dataset) => {
        dataset.cases = (dataset.cases as unknown[]).slice(0, 10);
      });

      await expect(new BenchmarkSeeder(prisma, file).run()).rejects.toThrow();

      expect(await prisma.evaluationDataset.count({ where: { name } })).toBe(0);
    });

    it('is protected by the database: the frozen row cannot be updated or deleted', async () => {
      const { file, name } = freshFile();
      await new BenchmarkSeeder(prisma, file).run();
      const row = await prisma.evaluationDataset.findUniqueOrThrow({ where: { name } });

      await withRollback(pool, async (client) => {
        expect((await expectViolation(client, `UPDATE "EvaluationDataset" SET "examplesJson" = '[]' WHERE id = $1`, [row.id])).message).toContain('frozen');
      });
      await withRollback(pool, async (client) => {
        expect((await expectViolation(client, `DELETE FROM "EvaluationDataset" WHERE id = $1`, [row.id])).message).toContain('frozen');
      });
    });
  });

  describe('a benchmark run', () => {
    it('is opened, finished and audited, and never shows up among the registry evaluations', async () => {
      const runId = await registry.openBenchmarkRun(admin, plan(), null, 'trace-1');
      await registry.updateBenchmarkRun(runId, { plan: { status: 'RUNNING', startedAt: new Date().toISOString() } });
      await completed(runId);

      const row = await prisma.optimizationRun.findUniqueOrThrow({ where: { id: runId } });
      expect(row.optimizerName).toBe('offline-benchmark-v1');
      expect(row.decision).toBe('PENDING');
      expect((row.candidateJson as unknown as BenchmarkPlan).status).toBe('COMPLETED');
      const actions = (await prisma.auditLog.findMany({ where: { entityId: runId }, orderBy: { createdAt: 'asc' } })).map((entry) => [entry.action, entry.actorId]);
      expect(actions).toEqual([
        ['BENCHMARK_STARTED', admin.id],
        ['BENCHMARK_COMPLETED', null],
      ]);
      expect(((await registry.runs(admin)).data as Array<{ id: string }>).map((item) => item.id)).not.toContain(runId);
    });

    it('records a failure with its reason in the audit trail', async () => {
      const runId = await registry.openBenchmarkRun(admin, plan());

      await registry.updateBenchmarkRun(runId, { plan: { status: 'FAILED', error: '12 of 112 model calls failed' } });

      const failed = await prisma.auditLog.findFirstOrThrow({ where: { entityId: runId, action: 'BENCHMARK_FAILED' } });
      expect(failed.reason).toContain('12 of 112');
    });

    it('cannot be decided before it completed, nor after it failed', async () => {
      const queued = await registry.openBenchmarkRun(admin, plan());
      const failed = await registry.openBenchmarkRun(admin, plan());
      await registry.updateBenchmarkRun(failed, { plan: { status: 'FAILED', error: 'x' } });

      await expect(registry.decideBenchmarkRun(admin, queued, { decision: 'ACCEPTED', rationale: 'It looks fine to me' })).rejects.toMatchObject({ statusCode: 409 });
      await expect(registry.decideBenchmarkRun(admin, failed, { decision: 'ACCEPTED', rationale: 'It looks fine to me' })).rejects.toMatchObject({ statusCode: 409 });
    });

    it('is decided by an administrator exactly once, with the reason kept, and is frozen afterwards', async () => {
      const runId = await registry.openBenchmarkRun(admin, plan());
      await completed(runId);

      await expect(registry.decideBenchmarkRun(learner as never, runId, { decision: 'ACCEPTED', rationale: 'I would like this one' })).rejects.toThrow();
      const decided = await registry.decideBenchmarkRun(admin, runId, { decision: 'REJECTED', rationale: 'Safety dropped on the injection cases' }, 'trace-2');

      expect(decided.data).toMatchObject({ id: runId, decision: 'REJECTED', decidedBy: admin.id });
      expect(decided.data.decidedAt).toBeInstanceOf(Date);
      await expect(registry.decideBenchmarkRun(admin, runId, { decision: 'ACCEPTED', rationale: 'Changed my mind later' })).rejects.toMatchObject({ statusCode: 409 });
      await expect(registry.updateBenchmarkRun(runId, { plan: { error: 'tampered' } })).rejects.toMatchObject({ statusCode: 409 });
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: runId, action: 'BENCHMARK_DECIDED' } });
      expect(audit).toMatchObject({ actorId: admin.id, reason: 'Safety dropped on the injection cases' });
    });

    it('serializes two simultaneous decisions so only one wins', async () => {
      const runId = await registry.openBenchmarkRun(admin, plan());
      await completed(runId);

      const outcomes = await Promise.allSettled([
        registry.decideBenchmarkRun(admin, runId, { decision: 'ACCEPTED', rationale: 'First decision in a race' }),
        registry.decideBenchmarkRun(admin, runId, { decision: 'REJECTED', rationale: 'Second decision in a race' }),
      ]);

      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
      expect(await prisma.auditLog.count({ where: { entityId: runId, action: 'BENCHMARK_DECIDED' } })).toBe(1);
    });
  });

  describe('offline evidence in front of a canary', () => {
    const runFor = async (promptId: string, over: Partial<BenchmarkPlan> = {}) => registry.openBenchmarkRun(admin, plan({ candidate: { label: 'tutor-chat@x', hash: 'd'.repeat(64), promptId, body: template('cand') }, ...over }));

    it('returns the evidence of the newest completed run of that candidate and ignores unfinished, repeat and other runs', async () => {
      const candidate = await propose('one');
      const other = await propose('two');
      const older = await runFor(candidate.id);
      await completed(older, { pairedCases: 50 });
      const repeat = await runFor(candidate.id, { identicalArms: true });
      await completed(repeat, { pairedCases: 11 });
      await runFor(candidate.id);
      const elsewhere = await runFor(other.id);
      await completed(elsewhere, { pairedCases: 22 });

      expect((await registry.offlineEvidenceFor(candidate.id))?.pairedCases).toBe(50);
      expect((await registry.offlineEvidenceFor(other.id))?.pairedCases).toBe(22);
      expect(await registry.offlineEvidenceFor(randomUUID())).toBeNull();
    });

    it('does not start a canary on a version whose benchmark failed a hard criterion', async () => {
      const candidate = await propose('unsafe');
      const runId = await runFor(candidate.id);
      await completed(runId, { safety: { ...dimension(), regressions: ['TC-39'] } });

      await expect(registry.startCanary(admin, candidate.id, { percent: 10, reason: 'try it on a few learners' })).rejects.toMatchObject({ statusCode: 409 });

      expect((await prisma.promptVersion.findUniqueOrThrow({ where: { id: candidate.id } })).status).toBe('DRAFT');
    });

    it('starts the canary when the benchmark did not fail, and an inconclusive result does not block it', async () => {
      const candidate = await propose('fine');
      const runId = await runFor(candidate.id);
      await completed(runId, { correctness: dimension({ lower: -0.2, upper: 0.1 }) });

      const started = await registry.startCanary(admin, candidate.id, { percent: 10, reason: 'try it on a few learners' });

      expect(started.data).toMatchObject({ status: 'EXPERIMENTAL', canaryPercent: 10 });
    });

    it('starts a canary on a version nobody benchmarked, because the person approving must acknowledge what was not measured', async () => {
      const candidate = await propose('unmeasured');

      const started = await registry.startCanary(admin, candidate.id, { percent: 5, reason: 'try it on a few learners' });

      expect(started.data.status).toBe('EXPERIMENTAL');
    });

    it('shows the offline criteria beside the production ones when a canary is evaluated', async () => {
      const candidate = await propose('evaluated');
      const runId = await runFor(candidate.id);
      await completed(runId);
      await registry.startCanary(admin, candidate.id, { percent: 10, reason: 'try it on a few learners' });

      const result = await registry.evaluate(admin, candidate.id);

      const criteria = result.data.gate.criteria.map((criterion) => [criterion.id, criterion.status]);
      expect(criteria).toEqual(expect.arrayContaining([['offline_correctness', 'PASS'], ['offline_safety', 'PASS'], ['judge_calibration', 'NOT_MEASURED']]));
      expect(result.data.gate.notMeasured).toEqual(['judge_calibration']);
      expect(result.data.gate.passed).toBe(false);
    });

    it('keeps the old not measured criteria for a canary without a benchmark', async () => {
      const candidate = await propose('plain');
      await registry.startCanary(admin, candidate.id, { percent: 10, reason: 'try it on a few learners' });

      const result = await registry.evaluate(admin, candidate.id);

      expect(result.data.gate.notMeasured).toEqual(['correctness', 'pedagogy', 'hallucination_rate']);
    });
  });
});
