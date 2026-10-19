import { readFileSync } from 'fs';
import { join } from 'path';
import { AiServiceError } from '@/common/ai-client/ai-service.error';
import { ADMIN_A } from '@/test-utils/http-harness';
import { BUILTIN_PROMPT_BODY } from './fixtures';
import { BENCHMARK_DATASET, DEVELOPMENT_DATASET, benchmarkDatasetSchema, datasetDigest, describeDataset } from '../benchmark-dataset';
import { BenchmarkService, MAX_FAILURE_RATIO } from '../benchmark.service';
import { BenchmarkPlan } from '../benchmark.types';

const RAW: unknown = JSON.parse(readFileSync(join(process.cwd(), 'prisma', 'seed-data', 'evaluation', 'tutor-chat-benchmark.v1.json'), 'utf8'));
const DATASET = benchmarkDatasetSchema.parse(RAW);
const DIGEST = datasetDigest(RAW);
const CASES = DATASET.cases.length;
const RUN_ID = '88888888-8888-4888-8888-888888888888';
const CANDIDATE_ID = '99999999-9999-4999-8999-999999999999';

const datasetRow = (over: Record<string, unknown> = {}) => ({
  name: DATASET.datasetName,
  version: 1,
  isFrozen: true,
  examplesJson: RAW,
  description: describeDataset(DIGEST, DATASET),
  ...over,
});

const aiResult = (body: { template: { label: string; body: string }; case: { id: string; category: string; risk: string }; judge: boolean }, over: Record<string, unknown> = {}) => ({
  caseId: body.case.id,
  category: body.case.category,
  risk: body.case.risk,
  templateLabel: body.template.label,
  templateHash: 'h',
  model: 'm',
  mode: 'flash',
  escalated: false,
  tokensIn: 100,
  tokensOut: 50,
  latencyMs: 900,
  text: 'jawaban',
  citationsShown: [],
  actions: [],
  checks: {},
  judge: null,
  judgeError: null,
  dimensions: { correctness: true, coverage: 1, citation: true, safety: true, pedagogy: body.judge ? 4 : null, behavior: null, grounding: null },
  ...over,
});

const build = (options: { dataset?: unknown; runs?: unknown[]; candidate?: unknown; post?: jest.Mock; plan?: Partial<BenchmarkPlan>; planRow?: boolean } = {}) => {
  const prisma = {
    evaluationDataset: { findUnique: jest.fn().mockResolvedValue(options.dataset === undefined ? datasetRow() : options.dataset) },
    optimizationRun: {
      findMany: jest.fn().mockResolvedValue(options.runs ?? []),
      findUnique: jest.fn(),
    },
    promptVersion: { findUnique: jest.fn().mockResolvedValue(options.candidate ?? null) },
  };
  const policy = { assertAdmin: jest.fn() };
  const registry = {
    baseline: jest.fn().mockResolvedValue({ label: 'tutor-chat-builtin-3', body: BUILTIN_PROMPT_BODY, parentVersionId: null, modelName: 'router-default' }),
    openBenchmarkRun: jest.fn().mockResolvedValue(RUN_ID),
    updateBenchmarkRun: jest.fn().mockResolvedValue(undefined),
  };
  const ai = { post: options.post ?? jest.fn(async ({ body }) => aiResult(body)) };
  const queue = { add: jest.fn().mockResolvedValue(undefined) };
  const service = new BenchmarkService(prisma as never, policy as never, registry as never, ai as never, queue as never);
  service.retryDelayMs = 0;
  return { service, prisma, policy, registry, ai, queue };
};

const queuedPlan = (over: Partial<BenchmarkPlan> = {}): BenchmarkPlan => ({
  status: 'QUEUED',
  name: 'tutor-chat',
  actorId: ADMIN_A.id,
  datasetName: DATASET.datasetName,
  datasetRole: 'BENCHMARK',
  datasetVersion: 1,
  datasetDigest: DIGEST,
  repeats: 1,
  judge: true,
  identicalArms: false,
  baseline: { label: 'tutor-chat-builtin-3', hash: 'b'.repeat(64), promptId: null, body: BUILTIN_PROMPT_BODY },
  candidate: { label: 'tutor-chat@2', hash: 'c'.repeat(64), promptId: CANDIDATE_ID, body: BUILTIN_PROMPT_BODY + ' ' },
  progress: { done: 0, total: CASES * 2 },
  startedAt: null,
  completedAt: null,
  error: null,
  report: null,
  ...over,
});

const withPlan = (ctx: ReturnType<typeof build>, plan: BenchmarkPlan) =>
  ctx.prisma.optimizationRun.findUnique.mockResolvedValue({ optimizerName: 'offline-benchmark-v1', candidateJson: plan, baseMetricsJson: {}, candidateMetricsJson: {} });

describe('BenchmarkService.start', () => {
  it('opens a run and queues one job for it, with the exact plan a person can audit later', async () => {
    const ctx = build();

    const result = await ctx.service.start(ADMIN_A, { name: 'tutor-chat', datasetName: BENCHMARK_DATASET, repeats: 2, judge: true }, 'trace-1');

    const [actor, plan, baseId, traceId] = ctx.registry.openBenchmarkRun.mock.calls[0];
    expect(actor).toBe(ADMIN_A);
    expect(traceId).toBe('trace-1');
    expect(baseId).toBeNull();
    expect(plan).toMatchObject({
      status: 'QUEUED',
      name: 'tutor-chat',
      actorId: ADMIN_A.id,
      datasetName: 'tutor-chat-benchmark-v1',
      datasetDigest: DIGEST,
      repeats: 2,
      judge: true,
      progress: { done: 0, total: CASES * 2 * 2 },
      report: null,
    });
    expect(plan.baseline).toMatchObject({ label: 'tutor-chat-builtin-3', promptId: null });
    expect(plan.baseline.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(ctx.queue.add).toHaveBeenCalledWith('run', { runId: RUN_ID }, expect.objectContaining({ jobId: RUN_ID, attempts: 1 }));
    expect(result.data).toMatchObject({ id: RUN_ID, status: 'QUEUED', total: CASES * 4 });
  });

  it('runs the baseline against itself when no candidate is named, so run to run noise can be measured', async () => {
    const ctx = build();

    await ctx.service.start(ADMIN_A, { name: 'tutor-chat', datasetName: BENCHMARK_DATASET, repeats: 1, judge: true });

    const plan = ctx.registry.openBenchmarkRun.mock.calls[0][1] as BenchmarkPlan;
    expect(plan.identicalArms).toBe(true);
    expect(plan.candidate.promptId).toBeNull();
    expect(plan.candidate.hash).toBe(plan.baseline.hash);
    expect(plan.candidate.label).toBe('tutor-chat-builtin-3 (repeat)');
  });

  it('benchmarks the named version as the candidate against the active baseline', async () => {
    const ctx = build({ candidate: { id: CANDIDATE_ID, name: 'tutor-chat', version: 2, status: 'DRAFT', body: BUILTIN_PROMPT_BODY + '\n' } });

    await ctx.service.start(ADMIN_A, { name: 'tutor-chat', datasetName: BENCHMARK_DATASET, candidatePromptId: CANDIDATE_ID, repeats: 1, judge: false });

    const plan = ctx.registry.openBenchmarkRun.mock.calls[0][1] as BenchmarkPlan;
    expect(plan.identicalArms).toBe(false);
    expect(plan.candidate).toMatchObject({ label: 'tutor-chat@2', promptId: CANDIDATE_ID });
    expect(plan.candidate.hash).not.toBe(plan.baseline.hash);
    expect(plan.judge).toBe(false);
  });

  it.each(['REJECTED', 'ROLLED_BACK', 'ARCHIVED'])('refuses to benchmark a %s version', async (status) => {
    const ctx = build({ candidate: { id: CANDIDATE_ID, name: 'tutor-chat', version: 2, status, body: BUILTIN_PROMPT_BODY } });

    await expect(ctx.service.start(ADMIN_A, { name: 'tutor-chat', datasetName: BENCHMARK_DATASET, candidatePromptId: CANDIDATE_ID, repeats: 1, judge: true })).rejects.toMatchObject({ statusCode: 409 });
    expect(ctx.registry.openBenchmarkRun).not.toHaveBeenCalled();
  });

  it('refuses a candidate that is unknown or belongs to another prompt', async () => {
    await expect(build().service.start(ADMIN_A, { name: 'tutor-chat', datasetName: BENCHMARK_DATASET, candidatePromptId: CANDIDATE_ID, repeats: 1, judge: true })).rejects.toMatchObject({ statusCode: 422 });
    const other = build({ candidate: { id: CANDIDATE_ID, name: 'someone-else', version: 1, status: 'DRAFT', body: BUILTIN_PROMPT_BODY } });

    await expect(other.service.start(ADMIN_A, { name: 'tutor-chat', datasetName: BENCHMARK_DATASET, candidatePromptId: CANDIDATE_ID, repeats: 1, judge: true })).rejects.toMatchObject({ statusCode: 422 });
  });

  it('refuses a candidate that breaks the placeholder contract before spending any model call', async () => {
    const ctx = build({ candidate: { id: CANDIDATE_ID, name: 'tutor-chat', version: 2, status: 'DRAFT', body: BUILTIN_PROMPT_BODY.replace('{{rag}}', '') } });

    await expect(ctx.service.start(ADMIN_A, { name: 'tutor-chat', datasetName: BENCHMARK_DATASET, candidatePromptId: CANDIDATE_ID, repeats: 1, judge: true })).rejects.toMatchObject({ statusCode: 422 });
    expect(ctx.ai.post).not.toHaveBeenCalled();
    expect(ctx.queue.add).not.toHaveBeenCalled();
  });

  it('needs a seeded and frozen dataset whose content still matches its recorded digest', async () => {
    const missing = build({ dataset: null });
    const unfrozen = build({ dataset: datasetRow({ isFrozen: false }) });
    const tampered = build({ dataset: datasetRow({ description: describeDataset('f'.repeat(64), DATASET) }) });

    for (const ctx of [missing, unfrozen, tampered]) {
      await expect(ctx.service.start(ADMIN_A, { name: 'tutor-chat', datasetName: BENCHMARK_DATASET, repeats: 1, judge: true })).rejects.toMatchObject({ statusCode: 409 });
      expect(ctx.registry.openBenchmarkRun).not.toHaveBeenCalled();
    }
  });

  it('allows one benchmark at a time so a double click cannot double the model spend', async () => {
    const ctx = build({ runs: [{ candidateJson: queuedPlan({ status: 'RUNNING' }) }] });

    await expect(ctx.service.start(ADMIN_A, { name: 'tutor-chat', datasetName: BENCHMARK_DATASET, repeats: 1, judge: true })).rejects.toMatchObject({ statusCode: 409 });
    expect(ctx.queue.add).not.toHaveBeenCalled();
  });

  it('does not count finished runs against that limit', async () => {
    const ctx = build({ runs: [{ candidateJson: queuedPlan({ status: 'COMPLETED' }) }, { candidateJson: queuedPlan({ status: 'FAILED' }) }] });

    await ctx.service.start(ADMIN_A, { name: 'tutor-chat', datasetName: BENCHMARK_DATASET, repeats: 1, judge: true });

    expect(ctx.queue.add).toHaveBeenCalledTimes(1);
  });

  it('is for administrators only', async () => {
    const ctx = build();
    ctx.policy.assertAdmin.mockImplementation(() => {
      throw new Error('forbidden');
    });

    await expect(ctx.service.start({ id: 'u', role: 'STUDENT' } as never, { name: 'tutor-chat', datasetName: BENCHMARK_DATASET, repeats: 1, judge: true })).rejects.toThrow('forbidden');
    expect(ctx.registry.openBenchmarkRun).not.toHaveBeenCalled();
  });
});

describe('BenchmarkService.execute', () => {
  it('does nothing for a run that is not waiting, so a redelivered job cannot run it twice', async () => {
    const ctx = build();
    withPlan(ctx, queuedPlan({ status: 'COMPLETED' }));

    await ctx.service.execute(RUN_ID);

    expect(ctx.ai.post).not.toHaveBeenCalled();
    expect(ctx.registry.updateBenchmarkRun).not.toHaveBeenCalled();
  });

  it('answers 404 for an id that is not a benchmark run', async () => {
    const ctx = build();
    ctx.prisma.optimizationRun.findUnique.mockResolvedValue({ optimizerName: 'registry-evaluation', candidateJson: {} });

    await expect(ctx.service.execute(RUN_ID)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('calls the AI service once per case, arm and repeat with a signed identity of the administrator and a distinct idempotency key', async () => {
    const ctx = build();
    withPlan(ctx, queuedPlan({ repeats: 2 }));

    await ctx.service.execute(RUN_ID, 'trace-9');

    const calls = ctx.ai.post.mock.calls.map(([request]) => request);
    expect(calls).toHaveLength(CASES * 2 * 2);
    expect(new Set(calls.map((request) => request.idempotencyKey)).size).toBe(calls.length);
    for (const request of calls) {
      expect(request).toMatchObject({ path: '/benchmark/run-case', actingUserId: ADMIN_A.id, traceId: 'trace-9' });
      expect(request.body.judge).toBe(true);
      expect(request.body.protectedPhrases).toEqual(DATASET.protectedPhrases);
      expect(Object.keys(request.body.case).sort()).toEqual(expect.arrayContaining(['id', 'message', 'expect', 'sources', 'conversation']));
      expect(request.body.case.sources.every((source: unknown) => typeof source === 'object')).toBe(true);
    }
    expect(calls.filter((request) => request.body.template.label === 'tutor-chat-builtin-3')).toHaveLength(CASES * 2);
  });

  it('derives the same idempotency key for the same call so a retried request is not run twice', async () => {
    const first = build();
    const second = build();
    withPlan(first, queuedPlan());
    withPlan(second, queuedPlan());

    await first.service.execute(RUN_ID);
    await second.service.execute(RUN_ID);

    const keys = (ctx: typeof first) => ctx.ai.post.mock.calls.map(([request]) => request.idempotencyKey).sort();
    expect(keys(first)).toEqual(keys(second));
  });

  it('marks the run as running, then completed with a report, the evidence for the gate and every result', async () => {
    const ctx = build();
    withPlan(ctx, queuedPlan({ repeats: 1 }));

    await ctx.service.execute(RUN_ID);

    const updates = ctx.registry.updateBenchmarkRun.mock.calls.map(([, patch]) => patch);
    expect(updates[0].plan).toMatchObject({ status: 'RUNNING' });
    const last = updates[updates.length - 1];
    expect(last.plan.status).toBe('COMPLETED');
    expect(last.plan.error).toBeNull();
    expect(last.plan.progress).toEqual({ done: CASES * 2, total: CASES * 2 });
    expect(last.plan.report.evidence).toMatchObject({ runId: RUN_ID, datasetDigest: DIGEST, repeats: 1, judged: true, judgeCalibrated: false, pairedCases: CASES });
    expect(last.plan.report.baseline.cases).toBe(CASES);
    expect(last.baseResults.results).toHaveLength(CASES);
    expect(last.candidateResults.results).toHaveLength(CASES);
    expect(last.baseResults.results[0].repeat).toBe(0);
  });

  it('records progress while it works', async () => {
    const ctx = build();
    withPlan(ctx, queuedPlan());

    await ctx.service.execute(RUN_ID);

    const progress = ctx.registry.updateBenchmarkRun.mock.calls.map(([, patch]) => patch.plan?.progress).filter(Boolean);
    expect(progress.length).toBeGreaterThan(2);
    expect(progress[0].done).toBeLessThan(progress[progress.length - 1].done);
  });

  it('retries a call the AI service says is worth retrying and keeps the result', async () => {
    let first = true;
    const post = jest.fn(async ({ body }) => {
      if (first) {
        first = false;
        throw new AiServiceError('AI service answered 503', 503, true);
      }
      return aiResult(body);
    });
    const ctx = build({ post });
    withPlan(ctx, queuedPlan());

    await ctx.service.execute(RUN_ID);

    const last = ctx.registry.updateBenchmarkRun.mock.calls.map(([, patch]) => patch).pop();
    expect(last.plan.status).toBe('COMPLETED');
    expect(post).toHaveBeenCalledTimes(CASES * 2 + 1);
  });

  it('fails the run instead of trusting a comparison when too many calls failed, and still stores what it has', async () => {
    const post = jest.fn(async ({ body }) => {
      if (body.case.id <= 'TC-08') throw new AiServiceError('AI service answered 503', 503, true);
      return aiResult(body);
    });
    const ctx = build({ post });
    withPlan(ctx, queuedPlan());

    await ctx.service.execute(RUN_ID);

    const last = ctx.registry.updateBenchmarkRun.mock.calls.map(([, patch]) => patch).pop();
    expect(last.plan.status).toBe('FAILED');
    expect(last.plan.error).toMatch(/model calls failed/);
    expect(last.baseResults.failures.length).toBeGreaterThan(0);
    expect(last.baseResults.failures.length / CASES).toBeGreaterThan(MAX_FAILURE_RATIO);
  });

  it('completes the run when only a few calls failed and reports them', async () => {
    const post = jest.fn(async ({ body, idempotencyKey }) => {
      if (body.case.id === 'TC-01' && body.template.label === 'tutor-chat@2') throw new AiServiceError('AI service answered 400', 400, false);
      return aiResult(body, { templateHash: idempotencyKey });
    });
    const ctx = build({ post });
    withPlan(ctx, queuedPlan());

    await ctx.service.execute(RUN_ID);

    const last = ctx.registry.updateBenchmarkRun.mock.calls.map(([, patch]) => patch).pop();
    expect(last.plan.status).toBe('COMPLETED');
    expect(last.candidateResults.failures).toEqual([{ caseId: 'TC-01', repeat: 0, message: 'AI service answered 400' }]);
    expect(last.plan.report.evidence.pairedCases).toBe(CASES - 1);
  });

  it.each([401, 403, 422])('stops at once and fails the run when the AI service answers %s', async (status) => {
    const post = jest.fn(async () => {
      throw new AiServiceError(`AI service answered ${status}`, status, false);
    });
    const ctx = build({ post });
    withPlan(ctx, queuedPlan());

    await ctx.service.execute(RUN_ID);

    const last = ctx.registry.updateBenchmarkRun.mock.calls.map(([, patch]) => patch).pop();
    expect(last.plan.status).toBe('FAILED');
    expect(last.plan.error).toMatch(new RegExp(String(status)));
    expect(last.baseResults).toBeUndefined();
    expect(post.mock.calls.length).toBeLessThan(CASES * 2);
  });

  it('fails the run when the dataset no longer matches the digest the run was planned with', async () => {
    const ctx = build({ dataset: datasetRow({ description: describeDataset('e'.repeat(64), DATASET) }) });
    withPlan(ctx, queuedPlan());

    await ctx.service.execute(RUN_ID);

    const last = ctx.registry.updateBenchmarkRun.mock.calls.map(([, patch]) => patch).pop();
    expect(last.plan.status).toBe('FAILED');
    expect(ctx.ai.post).not.toHaveBeenCalled();
  });

  it('runs without the judge when the plan says so', async () => {
    const ctx = build();
    withPlan(ctx, queuedPlan({ judge: false }));

    await ctx.service.execute(RUN_ID);

    expect(ctx.ai.post.mock.calls.every(([request]) => request.body.judge === false)).toBe(true);
    const last = ctx.registry.updateBenchmarkRun.mock.calls.map(([, patch]) => patch).pop();
    expect(last.plan.report.evidence.judged).toBe(false);
  });
});

describe('BenchmarkService reads', () => {
  const row = (plan: BenchmarkPlan) => ({
    id: RUN_ID,
    optimizerName: 'offline-benchmark-v1',
    createdAt: new Date('2026-10-18T01:00:00Z'),
    decision: 'PENDING',
    rationale: null,
    decidedBy: null,
    decidedAt: null,
    candidateJson: plan,
    baseMetricsJson: { results: [{ caseId: 'TC-01', text: 'a' }, { caseId: 'TC-02', text: 'b' }] },
    candidateMetricsJson: { results: [{ caseId: 'TC-01', text: 'c' }] },
  });

  it('lists benchmarks as summaries without template bodies or results', async () => {
    const ctx = build();
    ctx.prisma.optimizationRun.findMany.mockResolvedValue([row(queuedPlan({ status: 'COMPLETED' }))]);

    const { data } = await ctx.service.list(ADMIN_A);

    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({ id: RUN_ID, status: 'COMPLETED', baseline: 'tutor-chat-builtin-3', candidate: 'tutor-chat@2', decision: 'PENDING' });
    expect(JSON.stringify(data)).not.toContain(BUILTIN_PROMPT_BODY.slice(0, 40));
  });

  it('shows one benchmark with its report and the hashes but never the template bodies', async () => {
    const ctx = build();
    ctx.prisma.optimizationRun.findUnique.mockResolvedValue(row(queuedPlan({ status: 'COMPLETED' })));

    const { data } = await ctx.service.detail(ADMIN_A, RUN_ID);

    expect(data).toMatchObject({ id: RUN_ID, baselineHash: 'b'.repeat(64), candidateHash: 'c'.repeat(64) });
    expect(JSON.stringify(data)).not.toContain(BUILTIN_PROMPT_BODY.slice(0, 40));
  });

  it('shows the gate criteria the report would give, computed by the gate itself, and none before a report exists', async () => {
    const ctx = build();
    const evidence = {
      runId: RUN_ID,
      datasetDigest: DIGEST,
      repeats: 2,
      pairedCases: 56,
      judged: true,
      judgeCalibrated: false,
      correctness: { baseline: 0.7, candidate: 0.72, diff: 0.02, lower: -0.02, upper: 0.06, pairedCases: 56 },
      citation: { baseline: 0.8, candidate: 0.8, diff: 0, lower: -0.03, upper: 0.03, pairedCases: 56 },
      safety: { baseline: 1, candidate: 1, diff: 0, lower: 0, upper: 0, pairedCases: 56, regressions: [] },
      pedagogy: { baseline: 4, candidate: 4, diff: 0, lower: -0.1, upper: 0.1, pairedCases: 56 },
    };
    ctx.prisma.optimizationRun.findUnique.mockResolvedValue(row(queuedPlan({ status: 'COMPLETED', report: { baseline: {}, candidate: {}, comparison: {}, evidence } as never })));

    const finished = await ctx.service.detail(ADMIN_A, RUN_ID);

    expect(finished.data.criteria.map((criterion) => [criterion.id, criterion.status])).toEqual([
      ['offline_correctness', 'PASS'],
      ['offline_citation_faithfulness', 'PASS'],
      ['offline_safety', 'PASS'],
      ['offline_pedagogy_judge', 'PASS'],
      ['judge_calibration', 'NOT_MEASURED'],
    ]);
    ctx.prisma.optimizationRun.findUnique.mockResolvedValue(row(queuedPlan({ status: 'RUNNING' })));
    expect((await ctx.service.detail(ADMIN_A, RUN_ID)).data.criteria).toEqual([]);
  });

  it('shows both arms of one case next to the expectation a person should judge them by', async () => {
    const ctx = build();
    ctx.prisma.optimizationRun.findUnique.mockResolvedValue(row(queuedPlan({ status: 'COMPLETED' })));

    const { data } = await ctx.service.caseDetail(ADMIN_A, RUN_ID, 'TC-01');

    expect(data.case).toMatchObject({ id: 'TC-01', category: 'concept' });
    expect(data.case.expect.rubric).toEqual(expect.any(String));
    expect(data.baseline).toEqual([{ caseId: 'TC-01', text: 'a' }]);
    expect(data.candidate).toEqual([{ caseId: 'TC-01', text: 'c' }]);
  });

  it('answers 404 for a case the dataset does not have and for a run that is not a benchmark', async () => {
    const ctx = build();
    ctx.prisma.optimizationRun.findUnique.mockResolvedValue(row(queuedPlan({ status: 'COMPLETED' })));
    await expect(ctx.service.caseDetail(ADMIN_A, RUN_ID, 'TC-99')).rejects.toMatchObject({ statusCode: 404 });

    ctx.prisma.optimizationRun.findUnique.mockResolvedValue({ ...row(queuedPlan()), optimizerName: 'registry-evaluation' });
    await expect(ctx.service.detail(ADMIN_A, RUN_ID)).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('BenchmarkService.proposalEvidence', () => {
  const DEV_RAW: unknown = JSON.parse(readFileSync(join(process.cwd(), 'prisma', 'seed-data', 'evaluation', 'tutor-chat-dev.v1.json'), 'utf8'));
  const DEV = benchmarkDatasetSchema.parse(DEV_RAW);
  const DEV_DIGEST = datasetDigest(DEV_RAW);
  const devRow = () => ({ name: DEV.datasetName, version: 1, isFrozen: true, examplesJson: DEV_RAW, description: describeDataset(DEV_DIGEST, DEV) });

  const result = (caseId: string, over: Record<string, unknown> = {}) => ({
    caseId,
    category: 'worked_example',
    risk: 'standard',
    repeat: 0,
    text: 'Coba hitung dulu ya.',
    checks: { facts: { missing: ['hasil'], violated: [] }, citations: { mode: 'OPTIONAL', invalid: [], misattributed: [], requiredMet: true, unexpected: false }, leaks: [] },
    judge: null,
    dimensions: { correctness: false, coverage: 0.5, citation: true, safety: true, pedagogy: null, behavior: null, grounding: null },
    ...over,
  });

  const summary = { cases: 2, rates: { correctness: { mean: 0.5 }, citation: { mean: 1 }, safety: { mean: 1 } }, scores: { pedagogy: { mean: null }, behavior: { mean: null }, grounding: { mean: null } } };

  const devRun = (over: Partial<BenchmarkPlan> = {}) =>
    queuedPlan({ status: 'COMPLETED', datasetName: DEV.datasetName, datasetRole: 'DEVELOPMENT', datasetDigest: DEV_DIGEST, report: { baseline: summary, candidate: summary } as never, ...over });

  const prepare = (plan: BenchmarkPlan, dataset: unknown = devRow()) => {
    const ctx = build({ dataset });
    ctx.prisma.optimizationRun.findUnique.mockResolvedValue({ optimizerName: 'offline-benchmark-v1', candidateJson: plan, baseMetricsJson: { results: [result('TD-08'), result('TD-09', { dimensions: { correctness: true, coverage: 1, citation: true, safety: true, pedagogy: null, behavior: null, grounding: null } })] } });
    return ctx;
  };

  it('builds evidence from a completed run on the development set', async () => {
    const ctx = prepare(devRun());

    const { evidence } = await ctx.service.proposalEvidence(ADMIN_A, RUN_ID);

    expect(evidence).toMatchObject({ datasetName: 'tutor-chat-dev-v1', datasetDigest: DEV_DIGEST, repeats: 1, cases: 2 });
    expect(evidence.samples.map((sample) => sample.caseId)).toEqual(['TD-08']);
    expect(evidence.samples[0].message).toContain('Rp750 juta');
    expect(evidence.weaknesses[0]).toMatchObject({ category: 'worked_example', cases: 2, failedCorrectness: 1 });
  });

  it('refuses a run on the benchmark that judges candidates, so the proposer never sees its cases', async () => {
    const plan = devRun({ datasetName: BENCHMARK_DATASET, datasetRole: 'BENCHMARK', datasetDigest: DIGEST });
    const ctx = prepare(plan, datasetRow());

    await expect(ctx.service.proposalEvidence(ADMIN_A, RUN_ID)).rejects.toMatchObject({ statusCode: 409 });
  });

  it('cannot be fooled by a plan that claims the development role for a benchmark dataset', async () => {
    const plan = devRun({ datasetName: BENCHMARK_DATASET, datasetRole: 'DEVELOPMENT', datasetDigest: DIGEST });
    const ctx = prepare(plan, datasetRow());

    await expect(ctx.service.proposalEvidence(ADMIN_A, RUN_ID)).rejects.toMatchObject({ statusCode: 409 });
  });

  it.each(['QUEUED', 'RUNNING', 'FAILED'] as const)('refuses a run that is %s', async (status) => {
    const ctx = prepare(devRun({ status, report: status === 'FAILED' ? (devRun().report as never) : null }));

    await expect(ctx.service.proposalEvidence(ADMIN_A, RUN_ID)).rejects.toMatchObject({ statusCode: 409 });
  });

  it('refuses a dataset that no longer matches the digest of the run', async () => {
    const ctx = prepare(devRun({ datasetDigest: 'f'.repeat(64) }));

    await expect(ctx.service.proposalEvidence(ADMIN_A, RUN_ID)).rejects.toMatchObject({ statusCode: 409 });
  });

  it('answers 404 for an id that is not a benchmark run', async () => {
    const ctx = build();
    ctx.prisma.optimizationRun.findUnique.mockResolvedValue({ optimizerName: 'registry-evaluation', candidateJson: {} });

    await expect(ctx.service.proposalEvidence(ADMIN_A, RUN_ID)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('accepts the development dataset as a source of runs and starts it like any other', async () => {
    const ctx = build({ dataset: devRow() });

    const started = await ctx.service.start(ADMIN_A, { name: 'tutor-chat', datasetName: DEVELOPMENT_DATASET, repeats: 1, judge: true });

    expect((ctx.registry.openBenchmarkRun.mock.calls[0][1] as BenchmarkPlan).datasetRole).toBe('DEVELOPMENT');
    expect(started.data.total).toBe(DEV.cases.length * 2);
  });
});
