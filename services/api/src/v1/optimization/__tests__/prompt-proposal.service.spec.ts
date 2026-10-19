import { createHash } from 'crypto';
import { AiServiceError } from '@/common/ai-client/ai-service.error';
import { AppError } from '@/common/lib/error';
import { PROMPT_CONTRACTS } from '../prompt-contracts';
import { MAX_OPEN_AI_DRAFTS, MIN_EVIDENCE_EPISODES, PROPOSAL_TIMEOUT_MS, PromptProposalService } from '../prompt-proposal.service';

const admin = { id: 'admin-1', role: 'ADMIN' as const };
const protectedText = PROMPT_CONTRACTS['tutor-chat'].protectedPhrases.join(' ');
const CURRENT = `${'x'.repeat(220)} {{user_step_title}} {{domain_block}} {{user_input}} {{rag}} {{web}} {{memory}} {{conversation}} {{current_material}} ${protectedText}`;
const EDITED = `${CURRENT} Ask the learner to explain in their own words.`;

const metrics = (episodes = 80) => ({ episodes, outcomes: 30, successRate: 0.4, groundedRate: 0.7, p50LatencyMs: 4000, p95LatencyMs: 9000, avgTokensIn: 2500, avgTokensOut: 400 });
const themes = [{ strategy: 'HINT', attempts: 10, failures: 7 }];
const samples = [{ strategy: 'HINT', grounded: false, scoreDelta: -0.02, reply: 'Coba lagi ya [nama]' }];
const answer = (overrides: Record<string, unknown> = {}) => ({ template: EDITED, rationale: 'Menambah pertanyaan penjelasan.', changes: ['Tambah pertanyaan'], similarity: 0.98, model: 'm', tokensIn: 3000, tokensOut: 2000, ...overrides });

interface Setup {
  openDrafts?: number;
  episodes?: number;
  reply?: unknown;
  failure?: Error;
  current?: string;
}

const build = ({ openDrafts = 0, episodes = 80, reply = answer(), failure, current = CURRENT }: Setup = {}) => {
  const prisma = { promptVersion: { count: jest.fn().mockResolvedValue(openDrafts) } };
  const policy = { assertAdmin: jest.fn() };
  const ai = { post: failure ? jest.fn().mockRejectedValue(failure) : jest.fn().mockResolvedValue(reply) };
  const registry = {
    baseline: jest.fn().mockResolvedValue({ label: 'tutor-chat-builtin-3', body: current, parentVersionId: null, modelName: 'router-default' }),
    propose: jest.fn().mockResolvedValue({ message: 'ok', data: { id: 'v-9', label: 'tutor-chat@2', status: 'DRAFT' } }),
  };
  const metricsService = { forLabel: jest.fn().mockResolvedValue(metrics(episodes)) };
  const evidence = { themes: jest.fn().mockResolvedValue(themes), samples: jest.fn().mockResolvedValue(samples) };
  const benchmarks = { proposalEvidence: jest.fn() };
  const service = new PromptProposalService(prisma as never, policy as never, ai as never, registry as never, metricsService as never, evidence as never, benchmarks as never);
  return { service, prisma, policy, ai, registry, metricsService, evidence, benchmarks };
};

const rejection = async (promise: Promise<unknown>): Promise<AppError> => {
  try {
    await promise;
  } catch (error) {
    return error as AppError;
  }
  throw new Error('Expected the call to be refused');
};

describe('PromptProposalService.proposeImprovement', () => {
  it('only an administrator may ask, and the check comes first', async () => {
    const { service, policy, ai } = build();
    policy.assertAdmin.mockImplementation(() => {
      throw new AppError('Forbidden', 403);
    });

    const error = await rejection(service.proposeImprovement({ id: 'u', role: 'STUDENT' as never }, { name: 'tutor-chat' }));

    expect(error.statusCode).toBe(403);
    expect(ai.post).not.toHaveBeenCalled();
  });

  it('refuses when the measured evidence is thin and never asks the model', async () => {
    const { service, ai } = build({ episodes: MIN_EVIDENCE_EPISODES - 1 });

    const error = await rejection(service.proposeImprovement(admin, { name: 'tutor-chat' }));

    expect(error.statusCode).toBe(409);
    expect(error.message).toContain(`${MIN_EVIDENCE_EPISODES - 1} turns`);
    expect(ai.post).not.toHaveBeenCalled();
  });

  it('refuses when too many AI proposals are already waiting', async () => {
    const { service, ai, registry } = build({ openDrafts: MAX_OPEN_AI_DRAFTS });

    const error = await rejection(service.proposeImprovement(admin, { name: 'tutor-chat' }));

    expect(error.statusCode).toBe(409);
    expect(registry.baseline).not.toHaveBeenCalled();
    expect(ai.post).not.toHaveBeenCalled();
  });

  it('counts only AI proposals that are still drafts of this prompt', async () => {
    const { service, prisma } = build();

    await service.proposeImprovement(admin, { name: 'tutor-chat' });

    expect(prisma.promptVersion.count).toHaveBeenCalledWith({ where: { name: 'tutor-chat', status: 'DRAFT', metricsJson: { path: ['origin'], equals: 'AI_PROPOSED' } } });
  });

  it('sends the template, the measured numbers and the redacted evidence, as the acting administrator', async () => {
    const { service, ai } = build();

    await service.proposeImprovement(admin, { name: 'tutor-chat' }, 'trace-1');

    const request = ai.post.mock.calls[0][0];
    expect(request).toMatchObject({ path: '/prompt-proposals', actingUserId: 'admin-1', traceId: 'trace-1', timeoutMs: PROPOSAL_TIMEOUT_MS });
    expect(request.body).toEqual({ name: 'tutor-chat', template: CURRENT, metrics: metrics(), themes, samples });
    expect(Object.keys(request.body).sort()).toEqual(['metrics', 'name', 'samples', 'template', 'themes']);
  });

  it('uses a fresh idempotency key for every ask so a second proposal is not replayed from the first', async () => {
    const { service, ai } = build();

    await service.proposeImprovement(admin, { name: 'tutor-chat' });
    await service.proposeImprovement(admin, { name: 'tutor-chat' });

    expect(ai.post.mock.calls[0][0].idempotencyKey).not.toBe(ai.post.mock.calls[1][0].idempotencyKey);
  });

  it('saves the proposal as a draft that points at the baseline and records where it came from', async () => {
    const { service, registry } = build();
    registry.baseline.mockResolvedValue({ label: 'tutor-chat@4', body: CURRENT, parentVersionId: 'parent-1', modelName: 'model-x' });

    const result = await service.proposeImprovement(admin, { name: 'tutor-chat' }, 't');

    const [actor, dto, traceId, origin] = registry.propose.mock.calls[0];
    expect(actor).toBe(admin);
    expect(dto).toEqual({ name: 'tutor-chat', body: EDITED, modelName: 'model-x', parentVersionId: 'parent-1', rationale: 'Menambah pertanyaan penjelasan.' });
    expect(traceId).toBe('t');
    expect(origin.kind).toBe('AI_PROPOSED');
    expect(origin.changes).toEqual(['Tambah pertanyaan']);
    expect(origin.evidence).toMatchObject({ baselineLabel: 'tutor-chat@4', metrics: metrics(), sampleCount: 1, model: 'm', similarity: 0.98 });
    expect(result.data).toMatchObject({ id: 'v-9', label: 'tutor-chat@2', status: 'DRAFT', baselineLabel: 'tutor-chat@4', changes: ['Tambah pertanyaan'] });
  });

  it('leaves out the parent when the baseline is the builtin template', async () => {
    const { service, registry } = build();

    await service.proposeImprovement(admin, { name: 'tutor-chat' });

    expect(registry.propose.mock.calls[0][1].parentVersionId).toBeUndefined();
  });

  it('checks the model answer again and refuses a template that dropped a protected sentence', async () => {
    const dropped = EDITED.replace('Never invent sources, numbers or quotes', 'Be creative');
    const { service, registry } = build({ reply: answer({ template: dropped }) });

    const error = await rejection(service.proposeImprovement(admin, { name: 'tutor-chat' }));

    expect(error.statusCode).toBe(422);
    expect(error.message).toContain('Never invent sources');
    expect(registry.propose).not.toHaveBeenCalled();
  });

  it.each([
    ['a missing placeholder', () => EDITED.replace('{{rag}}', '')],
    ['a new placeholder', () => `${EDITED} {{secret}}`],
    ['no change at all', () => CURRENT],
  ])('refuses %s without saving anything', async (_name, make) => {
    const { service, registry } = build({ reply: answer({ template: make() }) });

    expect((await rejection(service.proposeImprovement(admin, { name: 'tutor-chat' }))).statusCode).toBe(422);
    expect(registry.propose).not.toHaveBeenCalled();
  });

  it('turns a refusal by the AI service into a 422 and any other failure into a 503', async () => {
    const refused = build({ failure: new AiServiceError('answered 422', 422, false) });
    const down = build({ failure: new AiServiceError('unreachable', null, true) });
    const broken = build({ failure: new Error('boom') });

    expect((await rejection(refused.service.proposeImprovement(admin, { name: 'tutor-chat' }))).statusCode).toBe(422);
    expect((await rejection(down.service.proposeImprovement(admin, { name: 'tutor-chat' }))).statusCode).toBe(503);
    expect((await rejection(broken.service.proposeImprovement(admin, { name: 'tutor-chat' }))).statusCode).toBe(503);
    for (const setup of [refused, down, broken]) expect(setup.registry.propose).not.toHaveBeenCalled();
  });

  it('does not trust an answer of the wrong shape', async () => {
    const { service, registry } = build({ reply: { template: 5 } });

    expect((await rejection(service.proposeImprovement(admin, { name: 'tutor-chat' }))).statusCode).toBe(502);
    expect(registry.propose).not.toHaveBeenCalled();
  });
});

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const RUN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const devEvidence = {
  datasetName: 'tutor-chat-dev-v1',
  datasetDigest: 'd'.repeat(64),
  cases: 24,
  repeats: 2,
  rates: { correctness: 0.55, citation: 0.7, safety: 0.96 },
  judgeMeans: { pedagogy: 3.4, behavior: 3.8, grounding: 3.9 },
  weaknesses: [{ category: 'worked_example', cases: 4, failedCorrectness: 3, failedCitation: 0, failedSafety: 0, lowPedagogy: 2 }],
  samples: [{ caseId: 'TD-08', category: 'worked_example', message: 'Liabilitasnya berapa?', reply: 'Coba hitung dulu ya.', problems: ['missing: hasil'] }],
};

const devPlan = (over: Record<string, unknown> = {}) => ({
  name: 'tutor-chat',
  datasetRole: 'DEVELOPMENT',
  baseline: { label: 'tutor-chat-builtin-3', hash: sha256(CURRENT), promptId: null },
  ...over,
});

const withEvidence = (setup: ReturnType<typeof build>, plan = devPlan()) => setup.benchmarks.proposalEvidence.mockResolvedValue({ plan, evidence: devEvidence });

describe('PromptProposalService.proposeFromBenchmark', () => {
  it('asks the model with the development evidence and the current template, as the acting administrator', async () => {
    const setup = build();
    withEvidence(setup);

    await setup.service.proposeFromBenchmark(admin, RUN, 'trace-1');

    const request = setup.ai.post.mock.calls[0][0];
    expect(request).toMatchObject({ path: '/prompt-proposals', actingUserId: 'admin-1', traceId: 'trace-1', timeoutMs: PROPOSAL_TIMEOUT_MS });
    expect(request.body).toEqual({ name: 'tutor-chat', template: CURRENT, benchmark: devEvidence });
    expect(request.body).not.toHaveProperty('metrics');
    expect(setup.benchmarks.proposalEvidence).toHaveBeenCalledWith(admin, RUN);
  });

  it('saves only a draft that points at the baseline and records the development run it came from', async () => {
    const setup = build();
    withEvidence(setup);

    const result = await setup.service.proposeFromBenchmark(admin, RUN, 'trace-1');

    const [actor, dto, traceId, origin] = setup.registry.propose.mock.calls[0];
    expect(actor).toBe(admin);
    expect(dto).toMatchObject({ name: 'tutor-chat', body: EDITED, modelName: 'router-default' });
    expect(dto.parentVersionId).toBeUndefined();
    expect(traceId).toBe('trace-1');
    expect(origin.kind).toBe('AI_PROPOSED');
    expect(origin.evidence).toMatchObject({ source: 'DEVELOPMENT_BENCHMARK', benchmarkRunId: RUN, datasetName: 'tutor-chat-dev-v1', baselineLabel: 'tutor-chat-builtin-3', sampleCount: 1 });
    expect(result.data).toMatchObject({ id: 'v-9', status: 'DRAFT', baselineLabel: 'tutor-chat-builtin-3' });
  });

  it('never reads a run on the benchmark that judges candidates: the evidence service refuses it and the model is not asked', async () => {
    const setup = build();
    setup.benchmarks.proposalEvidence.mockRejectedValue(new AppError('Only a run on the development set can feed a proposal', 409));

    const error = await rejection(setup.service.proposeFromBenchmark(admin, RUN));

    expect(error.statusCode).toBe(409);
    expect(setup.ai.post).not.toHaveBeenCalled();
    expect(setup.registry.propose).not.toHaveBeenCalled();
  });

  it.each([
    ['another label', devPlan({ baseline: { label: 'tutor-chat@4', hash: sha256(CURRENT), promptId: null } })],
    ['another body', devPlan({ baseline: { label: 'tutor-chat-builtin-3', hash: sha256('older template'), promptId: null } })],
  ])('refuses evidence measured on a baseline that is no longer in use (%s)', async (_label, plan) => {
    const setup = build();
    withEvidence(setup, plan);

    const error = await rejection(setup.service.proposeFromBenchmark(admin, RUN));

    expect(error.statusCode).toBe(409);
    expect(setup.ai.post).not.toHaveBeenCalled();
  });

  it('keeps the limit on open AI drafts', async () => {
    const setup = build({ openDrafts: MAX_OPEN_AI_DRAFTS });
    withEvidence(setup);

    expect((await rejection(setup.service.proposeFromBenchmark(admin, RUN))).statusCode).toBe(409);
    expect(setup.ai.post).not.toHaveBeenCalled();
  });

  it('checks the model answer again and refuses a template that dropped a protected sentence', async () => {
    const setup = build({ reply: answer({ template: CURRENT.replace(PROMPT_CONTRACTS['tutor-chat'].protectedPhrases[0], 'gone') }) });
    withEvidence(setup);

    expect((await rejection(setup.service.proposeFromBenchmark(admin, RUN))).statusCode).toBe(422);
    expect(setup.registry.propose).not.toHaveBeenCalled();
  });

  it('only an administrator may ask, and the check comes first', async () => {
    const setup = build();
    setup.policy.assertAdmin.mockImplementation(() => {
      throw new AppError('Forbidden', 403);
    });

    expect((await rejection(setup.service.proposeFromBenchmark({ id: 'u', role: 'STUDENT' as never }, RUN))).statusCode).toBe(403);
    expect(setup.benchmarks.proposalEvidence).not.toHaveBeenCalled();
  });
});
