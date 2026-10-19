import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { PrismaService } from '@/common/config/prisma/prisma.service';
import { AppError } from '@/common/lib/error';
import { ConceptRegistryService } from '@/v1/learner-model/concepts/concept-registry.service';
import { LearnerEventsService } from '@/v1/learner-model/events/learner-events.service';
import { LearnerPolicyService } from '@/v1/learner-model/policy/learner-policy.service';
import { LearnerStateService } from '@/v1/learner-model/learner-state.service';
import { StrategyOutcomeService } from '@/v1/learner-model/strategy/strategy-outcome.service';
import { TeachingDecisionService } from '@/v1/learner-model/strategy/teaching-decision.service';
import { MisconceptionRepo } from '@/v1/personalization/misconception/misconception.repo';
import { MisconceptionService } from '@/v1/personalization/misconception/misconception.service';
import { SandboxContentService } from '@/v1/sandbox/sandbox-content.service';
import { AssessmentGamifyOutcome, AssessmentGamifyService } from '@/v1/gamify/assessment-gamify.service';
import { HINT_COOLDOWN_MS, SandboxPracticeService } from '@/v1/sandbox/sandbox-practice.service';
import { REGISTRY_SUITE_LOCK, createPool, databaseUrl, describeDb, expectViolation, holdSuiteLock, insertUser, withRollback } from '@/test-utils/pg-fixtures';

describeDb('sandbox practice (requires TEST_DATABASE_URL)', () => {
  let prisma: PrismaService;
  let pool: Pool;
  let content: SandboxContentService;
  let service: SandboxPracticeService;
  let build: (gamify?: AssessmentGamifyService) => SandboxPracticeService;
  let releaseLock: () => Promise<void>;
  const users: string[] = [];
  const createdConcepts: string[] = [];

  const learner = async () => {
    const id = await insertUser(pool);
    users.push(id);
    return id;
  };

  const key = (id: string) => content.find(id)!.key.map((line) => ({ ...line }));
  const swapped = (id: string) => key(id).map((line) => ({ ...line, side: line.side === 'DEBIT' ? ('CREDIT' as const) : ('DEBIT' as const) }));
  const errorOf = async (work: Promise<unknown>) => (await work.then(() => null, (error) => error)) as AppError | null;

  beforeAll(async () => {
    releaseLock = await holdSuiteLock(REGISTRY_SUITE_LOCK);
    process.env.DATABASE_URL = databaseUrl;
    prisma = new PrismaService();
    pool = createPool();
    content = new SandboxContentService();

    const wanted = content.conceptIds();
    const present = new Set((await prisma.concept.findMany({ where: { id: { in: wanted } }, select: { id: true } })).map((row) => row.id));
    for (const [index, id] of wanted.entries()) {
      if (present.has(id)) continue;
      await prisma.concept.create({ data: { id, title: id, level: 1, sortOrder: index + 1 } });
      createdConcepts.push(id);
    }

    const registry = new ConceptRegistryService(prisma);
    const policy = new LearnerPolicyService();
    const outcomes = new StrategyOutcomeService(prisma, policy);
    const state = new LearnerStateService(prisma, registry, policy);
    build = (gamify) =>
      new SandboxPracticeService(
        prisma,
        content,
        new LearnerEventsService(prisma),
        outcomes,
        undefined,
        gamify,
        new MisconceptionService(new MisconceptionRepo(prisma)),
        state,
        new TeachingDecisionService(prisma, state, registry, policy, outcomes),
      );
    service = build();
  }, 120_000);

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.concept.deleteMany({ where: { id: { in: createdConcepts } } });
    await prisma.$disconnect();
    await pool.end();
    await releaseLock();
  });

  it('returns the gamify outcome with the learner evidence, stars and achievements included', async () => {
    const outcome: AssessmentGamifyOutcome = {
      xpGained: 40,
      starsGained: 2,
      streak: { current: 3, longest: 5, freezes: 1, extended: true, freezeEarned: false, freezesUsed: 0, bonusPoints: 0 },
      achievements: [{ code: 'first-journal', title: 'Jurnal pertama', iconName: null }],
    };
    const afterAssessment = jest.fn().mockResolvedValue(outcome);
    const rewarded = build({ afterAssessment } as unknown as AssessmentGamifyService);
    const user = await learner();

    const right = await rewarded.check(user, 'j-bayar-gaji', { lines: key('j-bayar-gaji') });

    expect(afterAssessment).toHaveBeenCalledTimes(1);
    expect(afterAssessment).toHaveBeenCalledWith(expect.objectContaining({ passed: true }), expect.anything());
    expect(right.learning).toMatchObject({
      conceptId: 'l1-t02-debits-credits',
      xpGained: 40,
      starsGained: 2,
      streak: outcome.streak,
      achievements: outcome.achievements,
    });
  });

  it('keeps every failed check, solves on the right one and writes learner evidence once', async () => {
    const user = await learner();
    const wrong = await service.check(user, 'j-bayar-gaji', { lines: [{ account: '512', side: 'DEBIT', amount: 1200000 }, { account: '101', side: 'CREDIT', amount: 1200000 }] });
    expect(wrong.correct).toBe(false);
    expect(wrong.practice).toMatchObject({ status: 'IN_PROGRESS', attempts: 1 });
    expect(wrong.explanation).toBeNull();
    expect(wrong.learning).toBeNull();

    const right = await service.check(user, 'j-bayar-gaji', { lines: key('j-bayar-gaji') });
    expect(right).toMatchObject({ correct: true, score: 1, firstSolve: true, attemptNumber: 2 });
    expect(right.practice).toMatchObject({ status: 'SOLVED', attempts: 2, solvedUnaided: true });
    expect(right.explanation).toContain('Beban gaji');
    expect(right.learning).toMatchObject({ conceptId: 'l1-t02-debits-credits' });
    expect(right.learning!.masteryAfter).toBeGreaterThan(right.learning!.masteryBefore);

    await service.check(user, 'j-bayar-gaji', { lines: key('j-bayar-gaji') });
    expect(await prisma.sandboxCheck.count({ where: { userId: user } })).toBe(3);
    expect(await prisma.learningEvent.count({ where: { userId: user, idempotencyKey: `sandbox:${user}:j-bayar-gaji` } })).toBe(1);
    const row = await prisma.sandboxPractice.findUniqueOrThrow({ where: { userId_scenarioId: { userId: user, scenarioId: 'j-bayar-gaji' } } });
    expect(row.attempts).toBe(3);
    expect(row.solvedAt).not.toBeNull();
  });

  it('turns what the learner got wrong into misconception evidence', async () => {
    const user = await learner();
    await service.check(user, 'j-setor-modal', { lines: swapped('j-setor-modal') });
    await service.check(user, 'j-setor-modal', { lines: swapped('j-setor-modal') });

    const open = await prisma.misconception.findMany({ where: { userId: user } });
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ conceptKey: 'debit_credit_swap', count: 2, status: 'OPEN' });
    const stored = await prisma.sandboxCheck.findFirstOrThrow({ where: { userId: user }, orderBy: { createdAt: 'desc' } });
    expect(stored.findingCodes).toContain('REVERSED_ALL_SIDES');
    expect(stored.correct).toBe(false);
  });

  it('gives no evidence for a solve after the answer was shown', async () => {
    const user = await learner();
    await service.check(user, 'j-beli-perlengkapan', { lines: swapped('j-beli-perlengkapan') });
    const revealed = await service.reveal(user, 'j-beli-perlengkapan');
    expect(revealed.countsAsEvidence).toBe(false);
    expect(revealed.key).toHaveLength(2);

    const solved = await service.check(user, 'j-beli-perlengkapan', { lines: key('j-beli-perlengkapan') });
    expect(solved.practice).toMatchObject({ status: 'SOLVED', solvedUnaided: false, revealed: true });
    expect(solved.learning).toBeNull();
    expect(await prisma.learningEvent.count({ where: { userId: user } })).toBe(0);
  });

  it('lowers the weight of evidence by the hints that were used', async () => {
    const plain = await learner();
    const helped = await learner();
    await service.hint(helped, 'j-listrik');
    await prisma.sandboxPractice.update({ where: { userId_scenarioId: { userId: helped, scenarioId: 'j-listrik' } }, data: { hintAt: new Date(Date.now() - 10_000) } });
    await service.hint(helped, 'j-listrik');

    const a = await service.check(plain, 'j-listrik', { lines: key('j-listrik') });
    const b = await service.check(helped, 'j-listrik', { lines: key('j-listrik') });

    const gain = (outcome: typeof a) => outcome.learning!.masteryAfter - outcome.learning!.masteryBefore;
    expect(gain(b)).toBeGreaterThan(0);
    expect(gain(b)).toBeLessThan(gain(a));
    const event = await prisma.learningEvent.findFirstOrThrow({ where: { userId: helped } });
    expect((event.payload as { hintsUsed: number }).hintsUsed).toBe(2);
  });

  describe('hints and the answer', () => {
    it('opens one hint at a time, waits between them and stops at three', async () => {
      const user = await learner();
      const first = await service.hint(user, 'j-prive');
      expect(first).toMatchObject({ level: 1, remaining: 2, canReveal: false });
      expect(first.hints).toHaveLength(1);

      const tooSoon = await errorOf(service.hint(user, 'j-prive'));
      expect(tooSoon?.statusCode).toBe(429);
      expect(tooSoon?.message).toMatch(/detik/);

      const past = new Date(Date.now() - HINT_COOLDOWN_MS - 500);
      await prisma.sandboxPractice.update({ where: { userId_scenarioId: { userId: user, scenarioId: 'j-prive' } }, data: { hintAt: past } });
      expect(await service.hint(user, 'j-prive')).toMatchObject({ level: 2 });
      await prisma.sandboxPractice.update({ where: { userId_scenarioId: { userId: user, scenarioId: 'j-prive' } }, data: { hintAt: past } });
      const third = await service.hint(user, 'j-prive');
      expect(third).toMatchObject({ level: 3, remaining: 0, canReveal: true });
      expect(third.hints.join(' ')).not.toMatch(/Rp|\d{3}/);

      const again = await service.hint(user, 'j-prive');
      expect(again.level).toBe(3);
    });

    it('refuses to show the answer before any try and then shows it once tried', async () => {
      const user = await learner();
      const early = await errorOf(service.reveal(user, 'j-prive'));
      expect(early?.statusCode).toBe(409);

      await service.check(user, 'j-prive', { lines: [{ account: '302', side: 'DEBIT', amount: 100 }, { account: '101', side: 'CREDIT', amount: 100 }] });
      const shown = await service.reveal(user, 'j-prive');
      expect(shown.key.map((line) => line.account)).toEqual(['302', '101']);
      expect(shown.why).toContain('Prive');
    });

    it('does not open hints for a solved scenario but still shows its solution', async () => {
      const user = await learner();
      await service.check(user, 'j-listrik', { lines: key('j-listrik') });
      expect((await errorOf(service.hint(user, 'j-listrik')))?.statusCode).toBe(409);
      expect((await service.reveal(user, 'j-listrik')).key).toHaveLength(2);
    });
  });

  describe('what the learner sees', () => {
    it('lists scenarios with their own progress and never with an answer key', async () => {
      const user = await learner();
      await service.check(user, 'j-listrik', { lines: key('j-listrik') });
      await service.check(user, 'j-prive', { lines: swapped('j-prive') });

      const catalog = await service.catalog(user, {});
      const byId = new Map(catalog.scenarios.map((s) => [s.id, s]));
      expect(byId.get('j-listrik')!.practice.status).toBe('SOLVED');
      expect(byId.get('j-prive')!.practice.status).toBe('IN_PROGRESS');
      expect(byId.get('j-setor-modal')!.practice.status).toBe('NEW');
      expect(catalog.summary).toMatchObject({ solved: 1, inProgress: 1, solvedUnaided: 1 });
      expect(JSON.stringify(catalog)).not.toContain('"key"');

      const onlySolved = await service.catalog(user, { status: 'SOLVED' });
      expect(onlySolved.scenarios.map((s) => s.id)).toEqual(['j-listrik']);
      const search = await service.catalog(user, { q: 'prive' });
      expect(search.scenarios.length).toBeGreaterThan(0);
    });

    it('pages the scenarios without losing or repeating one, under any filter, and keeps the summary whole', async () => {
      const user = await learner();
      await service.check(user, 'j-listrik', { lines: key('j-listrik') });
      const all = await service.catalog(user, {});
      expect(all.page).toEqual({ total: all.scenarios.length, limit: null, nextCursor: null });

      const seen: string[] = [];
      let cursor: number | undefined = 0;
      let pages = 0;
      while (cursor !== undefined) {
        const page = await service.catalog(user, { limit: 7, cursor });
        expect(page.scenarios.length).toBeLessThanOrEqual(7);
        expect(page.summary).toEqual(all.summary);
        expect(page.page.total).toBe(all.scenarios.length);
        seen.push(...page.scenarios.map((scenario) => scenario.id));
        cursor = page.page.nextCursor ?? undefined;
        pages += 1;
      }
      expect(seen).toEqual(all.scenarios.map((scenario) => scenario.id));
      expect(pages).toBe(Math.ceil(all.scenarios.length / 7));

      const solved = await service.catalog(user, { status: 'SOLVED', limit: 5 });
      expect(solved.scenarios.map((scenario) => scenario.id)).toEqual(['j-listrik']);
      expect(solved.page).toEqual({ total: 1, limit: 5, nextCursor: null });
    });

    it('keeps another learner progress private', async () => {
      const a = await learner();
      const b = await learner();
      await service.check(a, 'j-listrik', { lines: key('j-listrik') });
      expect((await service.detail(b, 'j-listrik')).practice.status).toBe('NEW');
      expect((await service.catalog(b, {})).summary.solved).toBe(0);
    });

    it('resumes the last entry and hands out a worked example only to a scaffolded learner', async () => {
      const user = await learner();
      const first = await service.detail(user, 'j-setor-modal');
      expect(first.personalization.scaffold).toBe('HIGH');
      expect(first.example).toMatchObject({ story: expect.stringContaining('Pak Dedi') });
      expect(first.solution).toBeNull();

      await service.check(user, 'j-setor-modal', { lines: swapped('j-setor-modal') });
      const resumed = await service.detail(user, 'j-setor-modal');
      expect(resumed.lastLines).toHaveLength(2);

      await service.check(user, 'j-setor-modal', { lines: key('j-setor-modal') });
      const done = await service.detail(user, 'j-setor-modal');
      expect(done.example).toBeNull();
      expect(done.lastLines).toBeNull();
      expect(done.solution?.why).toContain('Kas');
    });

    it('answers 404 for an unknown scenario and 400 for an account outside the chart', async () => {
      const user = await learner();
      expect((await errorOf(service.detail(user, 'tidak-ada')))?.statusCode).toBe(404);
      expect((await errorOf(service.check(user, 'tidak-ada', { lines: key('j-listrik') })))?.statusCode).toBe(404);
      const bad = await errorOf(service.check(user, 'j-listrik', { lines: [{ account: '999', side: 'DEBIT', amount: 5 }] }));
      expect(bad?.statusCode).toBe(400);
    });
  });

  describe('personalization from what happened', () => {
    it('recommends practice that targets an open misconception', async () => {
      const user = await learner();
      await service.check(user, 'j-setor-modal', { lines: swapped('j-setor-modal') });
      await service.check(user, 'j-setor-modal', { lines: swapped('j-setor-modal') });

      const rec = await service.recommend(user);

      expect(rec).not.toBeNull();
      expect(rec!.reason).toBe('REMEDIATION');
      expect(content.find(rec!.scenarioId)!.targets).toContain('debit_credit_swap');
      expect(rec!.message).toContain('menukar sisi debit dan kredit');
    });

    it('starts a new learner on a simple scenario and does not repeat the concept just practised', async () => {
      const user = await learner();
      const start = await service.recommend(user);
      expect(start!.reason).toBe('START');
      expect(content.find(start!.scenarioId)!.difficulty).toBe('BEGINNER');

      await service.check(user, start!.scenarioId, { lines: key(start!.scenarioId) });
      const next = await service.recommend(user);
      expect(next!.scenarioId).not.toBe(start!.scenarioId);
      expect(next!.conceptId).not.toBe(start!.conceptId);
    });

    it('summarises the signals the companion can use', async () => {
      const user = await learner();
      await service.check(user, 'j-setor-modal', { lines: swapped('j-setor-modal') });
      await service.check(user, 'j-listrik', { lines: key('j-listrik') });

      const signals = await service.signals(user);

      expect(signals.solved).toBe(1);
      expect(signals.total).toBe(content.list().length);
      expect(signals.openMisconceptions[0]).toMatchObject({ code: 'debit_credit_swap', label: expect.stringContaining('debit dan kredit') });
      expect(signals.recentErrors[0]).toMatchObject({ code: 'REVERSED_ALL_SIDES', count: 1 });
      expect(signals.weakConcepts.length).toBeGreaterThan(0);
      expect(signals.suggestion).not.toBeNull();
    });
  });

  describe('variants with other numbers', () => {
    const solve = async (user: string, id: string) => service.check(user, id, { lines: key(id) });
    const scaledLines = (detailStory: string, id: string) => {
      const base = content.find(id)!;
      const [firstAmount] = (detailStory.match(/\d{1,3}(?:\.\d{3})+/g) ?? []).map((token) => Number(token.replace(/\./g, '')));
      const ratio = firstAmount! / Number((base.story.match(/\d{1,3}(?:\.\d{3})+/) ?? ['0'])[0].replace(/\./g, ''));
      return base.key.map((line) => ({ ...line, amount: line.amount * ratio }));
    };

    it('opens only after the learner solved the scenario', async () => {
      const user = await learner();
      expect((await errorOf(service.variantDetail(user, 'j-bayar-gaji', 1)))?.statusCode).toBe(409);
      await service.check(user, 'j-bayar-gaji', { lines: swapped('j-bayar-gaji') });
      expect((await errorOf(service.variantDetail(user, 'j-bayar-gaji', 1)))?.statusCode).toBe(409);
      expect((await errorOf(service.checkVariant(user, 'j-bayar-gaji', 1, { lines: key('j-bayar-gaji') })))?.statusCode).toBe(409);
      expect((await errorOf(service.revealVariant(user, 'j-bayar-gaji', 1)))?.statusCode).toBe(409);
    });

    it('is private to the learner who solved it', async () => {
      const solver = await learner();
      const other = await learner();
      await solve(solver, 'j-bayar-gaji');
      expect((await service.variantDetail(solver, 'j-bayar-gaji', 1)).scenarioId).toBe('j-bayar-gaji');
      expect((await errorOf(service.variantDetail(other, 'j-bayar-gaji', 1)))?.statusCode).toBe(409);
    });

    it('tells a story with new amounts, never an answer key, and the same seed gives the same story', async () => {
      const user = await learner();
      await solve(user, 'j-bayar-gaji');
      const first = await service.variantDetail(user, 'j-bayar-gaji', 4);
      const again = await service.variantDetail(user, 'j-bayar-gaji', 4);
      const other = await service.variantDetail(user, 'j-bayar-gaji', 5);

      expect(first.story).not.toBe(content.find('j-bayar-gaji')!.story);
      expect(first.story).toBe(again.story);
      expect(first.story).not.toBe(other.story);
      expect(first.hints).toHaveLength(3);
      expect(first.countsAsEvidence).toBe(false);
      expect(JSON.stringify(first)).not.toContain('correctAnswer');
      expect(first).not.toHaveProperty('solution');
    });

    it('accepts the scaled journal, rejects the original amounts and writes nothing', async () => {
      const user = await learner();
      await solve(user, 'j-bayar-gaji');
      const before = {
        checks: await prisma.sandboxCheck.count({ where: { userId: user } }),
        events: await prisma.learningEvent.count({ where: { userId: user } }),
        row: await prisma.sandboxPractice.findUniqueOrThrow({ where: { userId_scenarioId: { userId: user, scenarioId: 'j-bayar-gaji' } } }),
      };
      const detail = await service.variantDetail(user, 'j-bayar-gaji', 3);

      const original = await service.checkVariant(user, 'j-bayar-gaji', 3, { lines: key('j-bayar-gaji') });
      expect(original.correct).toBe(false);
      expect(original.findings.map((finding) => finding.code)).toContain('WRONG_AMOUNT');
      expect(original.solution).toBeNull();

      const right = await service.checkVariant(user, 'j-bayar-gaji', 3, { lines: scaledLines(detail.story, 'j-bayar-gaji') });
      expect(right).toMatchObject({ correct: true, score: 1, countsAsEvidence: false });
      expect(right.explanation).not.toBeNull();
      expect(right.solution!.key).toHaveLength(2);

      expect(await prisma.sandboxCheck.count({ where: { userId: user } })).toBe(before.checks);
      expect(await prisma.learningEvent.count({ where: { userId: user } })).toBe(before.events);
      const row = await prisma.sandboxPractice.findUniqueOrThrow({ where: { userId_scenarioId: { userId: user, scenarioId: 'j-bayar-gaji' } } });
      expect({ attempts: row.attempts, bestScore: row.bestScore, status: row.status }).toEqual({ attempts: before.row.attempts, bestScore: before.row.bestScore, status: before.row.status });
    });

    it('shows the scaled solution without touching the base practice', async () => {
      const user = await learner();
      await solve(user, 'j-bayar-gaji');
      const detail = await service.variantDetail(user, 'j-bayar-gaji', 6);
      const revealed = await service.revealVariant(user, 'j-bayar-gaji', 6);
      expect(revealed.countsAsEvidence).toBe(false);
      expect(revealed.key.map((line) => line.amount)).toEqual(scaledLines(detail.story, 'j-bayar-gaji').map((line) => line.amount));
      const row = await prisma.sandboxPractice.findUniqueOrThrow({ where: { userId_scenarioId: { userId: user, scenarioId: 'j-bayar-gaji' } } });
      expect(row.revealed).toBe(false);
    });

    it('answers 404 for an unknown scenario and 400 for an account outside the chart', async () => {
      const user = await learner();
      await solve(user, 'j-bayar-gaji');
      expect((await errorOf(service.variantDetail(user, 'tidak-ada', 1)))?.statusCode).toBe(404);
      expect((await errorOf(service.checkVariant(user, 'j-bayar-gaji', 1, { lines: [{ account: '999', side: 'DEBIT', amount: 5 }, { account: '101', side: 'CREDIT', amount: 5 }] })))?.statusCode).toBe(400);
    });
  });

  it('serialises parallel checks of one learner and one scenario', async () => {
    const user = await learner();
    const results = await Promise.all(Array.from({ length: 5 }, () => service.check(user, 'j-bayar-sewa', { lines: key('j-bayar-sewa') })));

    expect(results.filter((r) => r.firstSolve)).toHaveLength(1);
    expect(await prisma.learningEvent.count({ where: { userId: user } })).toBe(1);
    expect((await prisma.sandboxPractice.findFirstOrThrow({ where: { userId: user } })).attempts).toBe(5);
    expect(await prisma.sandboxCheck.count({ where: { userId: user } })).toBe(5);
  });

  describe('database guarantees', () => {
    it('refuses to rewrite a stored check', async () => {
      const user = await learner();
      await service.check(user, 'j-listrik', { lines: key('j-listrik') });
      const stored = await prisma.sandboxCheck.findFirstOrThrow({ where: { userId: user } });
      await withRollback(pool, async (client) => {
        const error = await expectViolation(client, `UPDATE "SandboxCheck" SET score = 0 WHERE id = $1`, [stored.id]);
        expect(error.message).toMatch(/append-only/);
      });
    });

    it('refuses impossible progress rows', async () => {
      const user = await learner();
      await withRollback(pool, async (client) => {
        const insert = (columns: string, values: string) =>
          `INSERT INTO "SandboxPractice" (id, "userId", "scenarioId", "updatedAt", ${columns}) VALUES ('${randomUUID()}', '${user}', 's-${randomUUID().slice(0, 6)}', now(), ${values})`;
        expect((await expectViolation(client, insert('"hintLevel"', '5'))).constraint).toBe('SandboxPractice_hintLevel_check');
        expect((await expectViolation(client, insert('"bestScore"', '1.5'))).constraint).toBe('SandboxPractice_bestScore_check');
        expect((await expectViolation(client, insert('status', `'SOLVED'`))).constraint).toBe('SandboxPractice_solved_check');
        expect((await expectViolation(client, insert('"solvedUnaided"', 'true'))).constraint).toBe('SandboxPractice_unaided_check');
      });
    });

    it('keeps one progress row per learner and scenario and removes everything with the learner', async () => {
      const user = await learner();
      await service.check(user, 'j-listrik', { lines: key('j-listrik') });
      await withRollback(pool, async (client) => {
        const error = await expectViolation(client, `INSERT INTO "SandboxPractice" (id, "userId", "scenarioId", "updatedAt") VALUES ($1, $2, 'j-listrik', now())`, [randomUUID(), user]);
        expect(error.constraint).toBe('SandboxPractice_userId_scenarioId_key');
      });
      await prisma.user.delete({ where: { id: user } });
      users.splice(users.indexOf(user), 1);
      expect(await prisma.sandboxCheck.count({ where: { userId: user } })).toBe(0);
      expect(await prisma.sandboxPractice.count({ where: { userId: user } })).toBe(0);
    });
  });
});
