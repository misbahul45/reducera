import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { AuditService } from '@/common/authz/audit.service';
import { PolicyService } from '@/common/authz/policy.service';
import { PrismaService } from '@/common/config/prisma/prisma.service';
import { MIN_TEMPLATE_LENGTH, PROMPT_CONTRACTS } from '@/v1/optimization/prompt-contracts';
import { PromptEvidenceService } from '@/v1/optimization/prompt-evidence';
import { PromptMetricsService } from '@/v1/optimization/prompt-metrics.service';
import { PromptRegistryService, bucketOf } from '@/v1/optimization/prompt-registry.service';
import { createPool, databaseUrl, describeDb, expectViolation, holdSuiteLock, insertUser, withRollback } from '@/test-utils/pg-fixtures';

const BUILTIN_LABEL = PROMPT_CONTRACTS['tutor-chat'].builtinLabel;

const PROMPT_SUITE_LOCK = 7_461_002;

describeDb('the prompt registry runs the governed loop on the database (requires TEST_DATABASE_URL)', () => {
  let prisma: PrismaService;
  let pool: Pool;
  let registry: PromptRegistryService;
  let releaseLock: () => Promise<void>;
  let admin: { id: string; role: 'ADMIN' };
  let learner: string;
  let concept: string;
  const ids = { users: [] as string[], concepts: [] as string[] };

  const template = (marker: string) =>
    `${marker} ${'Teach with care. '.repeat(Math.ceil(MIN_TEMPLATE_LENGTH / 17))} {{user_step_title}} {{domain_block}} {{learner_section}} {{user_input}} {{rag}} {{web}} {{memory}} {{conversation}} {{current_material}}`;

  const propose = async (marker: string) => {
    const response = await registry.propose(admin, { name: 'tutor-chat', body: template(marker), modelName: 'router-default', rationale: `candidate ${marker}` });
    return response.data;
  };

  const seedTraffic = async (label: string, options: { episodes: number; successes: number; outcomes: number; latencyMs: number; grounded: boolean }) => {
    for (let index = 0; index < options.episodes; index += 1) {
      const episode = await prisma.episode.create({
        data: {
          userId: learner,
          taskType: 'tutor_agent',
          inputPayload: {},
          retrievedChunks: options.grounded ? { citations: [{ lessonId: 'l-1' }] } : { citations: [] },
          retrievedMemory: {},
          strategy: {},
          promptVersion: label,
          modelName: 'test-model',
          response: 'jawaban',
          inputTokens: 2000,
          outputTokens: 500,
          latencyMs: options.latencyMs,
        },
      });
      if (index < options.outcomes) {
        const success = index < options.successes;
        await prisma.strategyOutcome.create({
          data: {
            userId: learner,
            conceptId: concept,
            strategy: 'HINT',
            episodeId: episode.id,
            eventKey: `prompt-int:${randomUUID()}`,
            promptVersion: label,
            scoreBefore: 0.5,
            scoreAfter: success ? 0.6 : 0.4,
            scoreDelta: success ? 0.1 : -0.1,
            success,
          },
        });
      }
    }
  };

  const cleanup = async () => {
    await prisma.optimizationRun.deleteMany({});
    await prisma.promptVersion.deleteMany({ where: { name: 'tutor-chat' } });
    await pool.query(`ALTER TABLE "StrategyOutcome" DISABLE TRIGGER "StrategyOutcome_no_update"`);
    await prisma.strategyOutcome.deleteMany({ where: { promptVersion: { startsWith: 'tutor-chat' } } });
    await pool.query(`ALTER TABLE "StrategyOutcome" ENABLE TRIGGER "StrategyOutcome_no_update"`);
    await prisma.episode.deleteMany({ where: { promptVersion: { startsWith: 'tutor-chat' } } });
  };

  beforeAll(async () => {
    releaseLock = await holdSuiteLock(PROMPT_SUITE_LOCK);
    process.env.DATABASE_URL = databaseUrl;
    prisma = new PrismaService();
    pool = createPool();
    registry = new PromptRegistryService(prisma, new PolicyService(), new AuditService(prisma), new PromptMetricsService(prisma));
    admin = { id: await insertUser(pool, 'ADMIN'), role: 'ADMIN' };
    learner = await insertUser(pool);
    ids.users.push(admin.id, learner);
    concept = `pr-${randomUUID().slice(0, 8)}`;
    await prisma.concept.create({ data: { id: concept, title: concept, level: 1, sortOrder: 1 } });
    ids.concepts.push(concept);
    await cleanup();
  }, 120_000);

  afterEach(async () => {
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
    await prisma.concept.deleteMany({ where: { id: { in: ids.concepts } } });
    await prisma.$disconnect();
    await pool.end();
    await releaseLock();
  });

  it('numbers proposals per prompt and refuses a template outside the contract', async () => {
    const first = await propose('one');
    const second = await propose('two');

    expect([first.label, second.label]).toEqual(['tutor-chat@1', 'tutor-chat@2']);
    await expect(registry.propose(admin, { name: 'tutor-chat', body: 'too short {{api_key}}', modelName: 'm', rationale: 'bad one' })).rejects.toMatchObject({ statusCode: 422 });
  });

  it('allows one canary and one active version per prompt, enforced by the database', async () => {
    const a = await propose('a');
    const b = await propose('b');
    await registry.startCanary(admin, a.id, { percent: 10, reason: 'try a' });

    await expect(registry.startCanary(admin, b.id, { percent: 10, reason: 'try b' })).rejects.toMatchObject({ statusCode: 409 });

    await withRollback(pool, async (client) => {
      const error = await expectViolation(client, `UPDATE "PromptVersion" SET status = 'EXPERIMENTAL', "canaryPercent" = 5 WHERE id = $1`, [b.id]);
      expect(error.constraint).toBe('PromptVersion_one_canary_per_name');
    });
    await withRollback(pool, async (client) => {
      const error = await expectViolation(client, `UPDATE "PromptVersion" SET "canaryPercent" = 5 WHERE id = $1`, [b.id]);
      expect(error.constraint).toBe('PromptVersion_canary_needs_experimental');
    });
  });

  it('sends a stable share of learners to the canary and everyone else to the active version', async () => {
    const active = await propose('active');
    await pool.query(`UPDATE "PromptVersion" SET status = 'ACTIVE' WHERE id = $1`, [active.id]);
    const canary = await propose('canary');
    await registry.startCanary(admin, canary.id, { percent: 30, reason: 'try canary' });

    const inside = Array.from({ length: 200 }, () => randomUUID()).find((id) => bucketOf(id, 'tutor-chat') < 30) as string;
    const outside = Array.from({ length: 200 }, () => randomUUID()).find((id) => bucketOf(id, 'tutor-chat') >= 30) as string;

    expect(await registry.resolve(inside, 'tutor-chat')).toMatchObject({ label: canary.label, arm: 'canary' });
    expect(await registry.resolve(inside, 'tutor-chat')).toMatchObject({ label: canary.label });
    expect(await registry.resolve(outside, 'tutor-chat')).toMatchObject({ label: active.label, arm: 'active' });
  });

  it('resolves nothing when no version is live so the service falls back to its builtin prompt', async () => {
    await propose('draft only');

    expect(await registry.resolve(randomUUID(), 'tutor-chat')).toBeNull();
  });

  it('validates a candidate whose measured numbers hold up and activates it only on a human decision', async () => {
    const baselineLabel = BUILTIN_LABEL;
    await seedTraffic(baselineLabel, { episodes: 40, outcomes: 20, successes: 10, latencyMs: 5000, grounded: true });
    const candidate = await propose('better');
    await registry.startCanary(admin, candidate.id, { percent: 20, reason: 'try better' });
    await seedTraffic(candidate.label, { episodes: 40, outcomes: 20, successes: 13, latencyMs: 5200, grounded: true });

    const evaluated = await registry.evaluate(admin, candidate.id);

    expect(evaluated.data.status).toBe('VALIDATED');
    expect(evaluated.data.gate.passed).toBe(true);
    expect(evaluated.data.gate.notMeasured).toEqual(['correctness', 'pedagogy', 'hallucination_rate']);
    expect(evaluated.data.decision).toBe('PENDING');
    expect(await registry.resolve(randomUUID(), 'tutor-chat')).toBeNull();

    await registry.approve(admin, candidate.id, { reason: 'reviewed the numbers', acknowledgeUnmeasured: true });

    const row = await prisma.promptVersion.findUniqueOrThrow({ where: { id: candidate.id } });
    const run = await prisma.optimizationRun.findFirstOrThrow({ where: { candidateJson: { path: ['promptVersionId'], equals: candidate.id } } });
    expect(row).toMatchObject({ status: 'ACTIVE', canaryPercent: 0 });
    expect(run).toMatchObject({ decision: 'ACCEPTED', decidedBy: admin.id });
    expect(await registry.resolve(randomUUID(), 'tutor-chat')).toMatchObject({ label: candidate.label, arm: 'active' });
  });

  it('rolls a regressing candidate back by itself and records why', async () => {
    await seedTraffic(BUILTIN_LABEL, { episodes: 40, outcomes: 20, successes: 14, latencyMs: 5000, grounded: true });
    const candidate = await propose('worse');
    await registry.startCanary(admin, candidate.id, { percent: 20, reason: 'try worse' });
    await seedTraffic(candidate.label, { episodes: 40, outcomes: 20, successes: 6, latencyMs: 5000, grounded: true });

    const evaluated = await registry.evaluate(admin, candidate.id);

    expect(evaluated.data.status).toBe('ROLLED_BACK');
    expect(evaluated.data.decision).toBe('REJECTED');
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'PromptVersion', entityId: candidate.id, action: 'PROMPT_AUTO_ROLLED_BACK' } });
    expect(audit.reason).toMatch(/regressed/);
    expect(await registry.resolve(randomUUID(), 'tutor-chat')).toBeNull();
  });

  it('keeps a candidate with too little data in the canary instead of deciding', async () => {
    const candidate = await propose('thin');
    await registry.startCanary(admin, candidate.id, { percent: 5, reason: 'try thin' });
    await seedTraffic(candidate.label, { episodes: 3, outcomes: 1, successes: 1, latencyMs: 5000, grounded: true });

    const evaluated = await registry.evaluate(admin, candidate.id);

    expect(evaluated.data.status).toBe('EXPERIMENTAL');
    expect(evaluated.data.decision).toBe('DEFERRED');
    expect(evaluated.data.gate.sampleSufficient).toBe(false);
  });

  describe('the scheduled sweep of running canaries', () => {
    const runsOf = (id: string) => prisma.optimizationRun.findMany({ where: { candidateJson: { path: ['promptVersionId'], equals: id } } });
    const decisionsOf = (id: string) =>
      prisma.auditLog.findMany({ where: { entityType: 'PromptVersion', entityId: id, action: { in: ['PROMPT_EVALUATED', 'PROMPT_AUTO_ROLLED_BACK'] } } });

    it('rolls a regressing canary back without an administrator and records the system as the actor', async () => {
      await seedTraffic(BUILTIN_LABEL, { episodes: 40, outcomes: 20, successes: 14, latencyMs: 5000, grounded: true });
      const candidate = await propose('sweep worse');
      await registry.startCanary(admin, candidate.id, { percent: 20, reason: 'try sweep worse' });
      await seedTraffic(candidate.label, { episodes: 40, outcomes: 20, successes: 6, latencyMs: 5000, grounded: true });

      const sweep = await registry.evaluateRunningCanaries('sweep-trace');

      expect(sweep.rolledBack).toContain(candidate.label);
      expect(sweep.failed).toEqual([]);
      const row = await prisma.promptVersion.findUniqueOrThrow({ where: { id: candidate.id } });
      expect(row).toMatchObject({ status: 'ROLLED_BACK', canaryPercent: 0 });
      const [audit] = await decisionsOf(candidate.id);
      expect(audit).toMatchObject({ action: 'PROMPT_AUTO_ROLLED_BACK', actorId: null, actorRole: null, traceId: 'sweep-trace' });
      expect((await runsOf(candidate.id)).map((run) => run.decision)).toEqual(['REJECTED']);
      expect(await registry.resolve(randomUUID(), 'tutor-chat')).toBeNull();
    });

    it('validates a passing canary but leaves the activation to a person', async () => {
      await seedTraffic(BUILTIN_LABEL, { episodes: 40, outcomes: 20, successes: 10, latencyMs: 5000, grounded: true });
      const candidate = await propose('sweep better');
      await registry.startCanary(admin, candidate.id, { percent: 20, reason: 'try sweep better' });
      await seedTraffic(candidate.label, { episodes: 40, outcomes: 20, successes: 13, latencyMs: 5200, grounded: true });

      const sweep = await registry.evaluateRunningCanaries();

      expect(sweep.validated).toContain(candidate.label);
      const row = await prisma.promptVersion.findUniqueOrThrow({ where: { id: candidate.id } });
      expect(row.status).toBe('VALIDATED');
      expect((await runsOf(candidate.id)).map((run) => run.decision)).toEqual(['PENDING']);
      expect(await registry.resolve(randomUUID(), 'tutor-chat')).toBeNull();
      await expect(registry.approve(admin, candidate.id, { reason: 'reviewed the numbers', acknowledgeUnmeasured: true })).resolves.toMatchObject({ data: { status: 'ACTIVE' } });
    });

    it('writes nothing for a canary that has too little data, however often it runs', async () => {
      const candidate = await propose('sweep thin');
      await registry.startCanary(admin, candidate.id, { percent: 5, reason: 'try sweep thin' });
      await seedTraffic(candidate.label, { episodes: 3, outcomes: 1, successes: 1, latencyMs: 5000, grounded: true });

      const first = await registry.evaluateRunningCanaries();
      const second = await registry.evaluateRunningCanaries();

      expect(first.undecided).toContain(candidate.label);
      expect(second.undecided).toContain(candidate.label);
      const row = await prisma.promptVersion.findUniqueOrThrow({ where: { id: candidate.id } });
      expect(row).toMatchObject({ status: 'EXPERIMENTAL', canaryPercent: 5 });
      expect(await runsOf(candidate.id)).toEqual([]);
      expect(await decisionsOf(candidate.id)).toEqual([]);
    });

    it('does not touch a decided version again on the next run', async () => {
      await seedTraffic(BUILTIN_LABEL, { episodes: 40, outcomes: 20, successes: 14, latencyMs: 5000, grounded: true });
      const candidate = await propose('sweep once');
      await registry.startCanary(admin, candidate.id, { percent: 20, reason: 'try sweep once' });
      await seedTraffic(candidate.label, { episodes: 40, outcomes: 20, successes: 6, latencyMs: 5000, grounded: true });
      await registry.evaluateRunningCanaries();

      const again = await registry.evaluateRunningCanaries();

      expect([...again.rolledBack, ...again.validated, ...again.undecided]).not.toContain(candidate.label);
      expect(await runsOf(candidate.id)).toHaveLength(1);
      expect(await decisionsOf(candidate.id)).toHaveLength(1);
    });

    it('ignores a draft that never started a canary', async () => {
      const draft = await propose('sweep draft');

      const sweep = await registry.evaluateRunningCanaries();

      expect([...sweep.rolledBack, ...sweep.validated, ...sweep.undecided]).not.toContain(draft.label);
      expect((await prisma.promptVersion.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe('DRAFT');
    });
  });

  it('cannot activate a version that skipped validation', async () => {
    const candidate = await propose('skip');

    await expect(registry.approve(admin, candidate.id, { reason: 'just do it please', acknowledgeUnmeasured: true })).rejects.toMatchObject({ statusCode: 409 });
  });

  it('kills the active version and brings back the one it replaced', async () => {
    const old = await propose('old');
    await pool.query(`UPDATE "PromptVersion" SET status = 'ARCHIVED' WHERE id = $1`, [old.id]);
    const current = await propose('current');
    await pool.query(`UPDATE "PromptVersion" SET status = 'ACTIVE' WHERE id = $1`, [current.id]);

    const killed = await registry.rollback(admin, current.id, 'the answers got worse');

    expect(killed.data).toMatchObject({ status: 'ROLLED_BACK', restoredVersionId: old.id });
    expect(await registry.resolve(randomUUID(), 'tutor-chat')).toMatchObject({ label: old.label });
  });

  it('refuses a second active version for the same prompt at the database', async () => {
    const a = await propose('active one');
    const b = await propose('active two');
    await pool.query(`UPDATE "PromptVersion" SET status = 'ACTIVE' WHERE id = $1`, [a.id]);

    await withRollback(pool, async (client) => {
      const error = await expectViolation(client, `UPDATE "PromptVersion" SET status = 'ACTIVE' WHERE id = $1`, [b.id]);
      expect(error.constraint).toBe('PromptVersion_one_active_per_name');
    });
  });

  it('never lets a frozen benchmark change or disappear', async () => {
    const name = `frozen-${randomUUID().slice(0, 8)}`;
    const created = await prisma.evaluationDataset.create({ data: { name, version: 1, isFrozen: true, examplesJson: [] } });
    const open = await prisma.evaluationDataset.create({ data: { name: `${name}-open`, version: 1, isFrozen: false, examplesJson: [] } });

    await withRollback(pool, async (client) => {
      expect((await expectViolation(client, `UPDATE "EvaluationDataset" SET "examplesJson" = '[1]' WHERE id = $1`, [created.id])).message).toContain('frozen');
    });
    await withRollback(pool, async (client) => {
      expect((await expectViolation(client, `DELETE FROM "EvaluationDataset" WHERE id = $1`, [created.id])).message).toContain('frozen');
    });
    await prisma.evaluationDataset.update({ where: { id: open.id }, data: { description: 'still editable' } });

    await pool.query(`ALTER TABLE "EvaluationDataset" DISABLE TRIGGER "EvaluationDataset_frozen_guard"`);
    await prisma.evaluationDataset.deleteMany({ where: { id: { in: [created.id, open.id] } } });
    await pool.query(`ALTER TABLE "EvaluationDataset" ENABLE TRIGGER "EvaluationDataset_frozen_guard"`);
  });
  describe('proposals written by the AI proposer', () => {
    it('stores where a proposal came from and shows it in the list, with its own audit action', async () => {
      const response = await registry.propose(
        admin,
        { name: 'tutor-chat', body: template('ai'), modelName: 'router-default', rationale: 'Menambah pertanyaan penjelasan' },
        'trace-1',
        { kind: 'AI_PROPOSED', evidence: { baselineLabel: BUILTIN_LABEL, sampleCount: 3 }, changes: ['Tambah pertanyaan'] },
      );

      const row = await prisma.promptVersion.findUniqueOrThrow({ where: { id: response.data.id } });
      expect(row.status).toBe('DRAFT');
      expect(row.metricsJson).toMatchObject({ rationale: 'Menambah pertanyaan penjelasan', origin: 'AI_PROPOSED', changes: ['Tambah pertanyaan'], evidence: { sampleCount: 3 } });

      const listed = (await registry.list(admin, 'tutor-chat')).data.versions.find((version) => version.id === response.data.id);
      expect(listed).toMatchObject({ origin: 'AI_PROPOSED', changes: ['Tambah pertanyaan'], rationale: 'Menambah pertanyaan penjelasan' });

      const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: response.data.id }, orderBy: { createdAt: 'desc' } });
      expect(audit.action).toBe('PROMPT_PROPOSED_BY_AI');
    });

    it('leaves a human proposal marked as human and without a change list', async () => {
      const human = await propose('human');

      const listed = (await registry.list(admin, 'tutor-chat')).data.versions.find((version) => version.id === human.id);
      expect(listed).toMatchObject({ origin: 'HUMAN', changes: [] });
      expect((await prisma.auditLog.findFirstOrThrow({ where: { entityId: human.id }, orderBy: { createdAt: 'desc' } })).action).toBe('PROMPT_PROPOSED');
    });

    it('starts from the builtin template while nothing is active and from the active version afterwards', async () => {
      const builtin = await registry.baseline('tutor-chat');
      expect(builtin).toMatchObject({ label: BUILTIN_LABEL, parentVersionId: null, modelName: 'router-default' });
      expect(builtin.body).toContain('{{conversation}}');

      const candidate = await propose('active-one');
      await registry.startCanary(admin, candidate.id, { percent: 10, reason: 'try it' });
      await prisma.promptVersion.update({ where: { id: candidate.id }, data: { status: 'VALIDATED', canaryPercent: 0 } });
      await registry.approve(admin, candidate.id, { reason: 'good numbers', acknowledgeUnmeasured: true });

      const active = await registry.baseline('tutor-chat');
      expect(active).toMatchObject({ label: 'tutor-chat@1', parentVersionId: candidate.id });
      expect(active.body).toContain('active-one');
    });
  });

  describe('the evidence the proposer is given, read from the real tables', () => {
    const label = BUILTIN_LABEL;

    const outcome = async (options: { strategy: string; success: boolean; reply: string; grounded: boolean }) => {
      const episode = await prisma.episode.create({
        data: {
          userId: learner,
          taskType: 'tutor_agent',
          inputPayload: { text: 'pertanyaan rahasia learner' },
          retrievedChunks: options.grounded ? { citations: [{ lessonId: 'l-1' }] } : { citations: [] },
          retrievedMemory: {},
          strategy: {},
          promptVersion: label,
          modelName: 'test-model',
          response: options.reply,
        },
      });
      await prisma.strategyOutcome.create({
        data: {
          userId: learner,
          conceptId: concept,
          strategy: options.strategy,
          episodeId: episode.id,
          eventKey: `evidence-int:${randomUUID()}`,
          promptVersion: label,
          scoreBefore: 0.5,
          scoreAfter: options.success ? 0.6 : 0.45,
          scoreDelta: options.success ? 0.1 : -0.05,
          success: options.success,
        },
      });
    };

    it('counts failures per strategy and ignores strategies that never failed', async () => {
      const evidence = new PromptEvidenceService(prisma);
      await outcome({ strategy: 'HINT', success: false, reply: 'a', grounded: false });
      await outcome({ strategy: 'HINT', success: false, reply: 'b', grounded: false });
      await outcome({ strategy: 'HINT', success: true, reply: 'c', grounded: true });
      await outcome({ strategy: 'EXPLAIN', success: true, reply: 'd', grounded: true });
      await outcome({ strategy: 'SOCRATIC', success: false, reply: 'e', grounded: true });

      expect(await evidence.themes(label)).toEqual([
        { strategy: 'HINT', attempts: 3, failures: 2 },
        { strategy: 'SOCRATIC', attempts: 1, failures: 1 },
      ]);
      expect(await evidence.themes('tutor-chat@99')).toEqual([]);
    });

    it('returns only replies that did not help, without the learner question and with the learner name removed', async () => {
      const evidence = new PromptEvidenceService(prisma);
      const user = await prisma.user.findUniqueOrThrow({ where: { id: learner }, select: { name: true } });
      const firstName = (user.name ?? '').split(/\s+/)[0];
      await outcome({ strategy: 'HINT', success: false, reply: `Halo ${user.name}, coba lagi ya ${firstName}!`, grounded: false });
      await outcome({ strategy: 'HINT', success: true, reply: 'Balasan yang membantu', grounded: true });

      const samples = await evidence.samples(label);

      expect(samples).toHaveLength(1);
      expect(samples[0]).toMatchObject({ strategy: 'HINT', grounded: false, scoreDelta: -0.05 });
      expect(samples[0].reply).toContain('[nama]');
      expect(JSON.stringify(samples)).not.toContain(firstName);
      expect(JSON.stringify(samples)).not.toContain('rahasia');
      expect(Object.keys(samples[0]).sort()).toEqual(['grounded', 'reply', 'scoreDelta', 'strategy']);
    });
  });
});
