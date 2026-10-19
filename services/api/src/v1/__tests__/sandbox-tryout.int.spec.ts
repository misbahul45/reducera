import { Pool } from 'pg';
import { PrismaService } from '@/common/config/prisma/prisma.service';
import { AppError } from '@/common/lib/error';
import { REGISTRY_SUITE_LOCK, createPool, databaseUrl, describeDb, holdSuiteLock, insertUser } from '@/test-utils/pg-fixtures';
import { LearnerEventsService } from '@/v1/learner-model/events/learner-events.service';
import { TryoutEngineService } from '@/v1/sandbox/tryout/tryout-engine.service';
import { UTBK_EXAM_KEY } from '@/v1/sandbox/tryout/tryout-engine';
import { GRACE_SECONDS, TryoutService } from '@/v1/sandbox/tryout/tryout.service';
import { SUBTEST_KEYS, TryoutItem } from '@/v1/sandbox/tryout/tryout-types';

describeDb('tryout (requires TEST_DATABASE_URL)', () => {
  let prisma: PrismaService;
  let pool: Pool;
  let engines: TryoutEngineService;
  let service: TryoutService;
  let releaseLock: () => Promise<void>;
  const users: string[] = [];
  const createdConcepts: string[] = [];

  const learner = async () => {
    const id = await insertUser(pool);
    users.push(id);
    return id;
  };

  const plan = (subtests: Array<{ key: (typeof SUBTEST_KEYS)[number]; count: number }>) => ({ examKey: 'utbk-snbt' as const, subtests });
  const small = () => plan([{ key: 'penalaran-umum', count: 6 }, { key: 'pengetahuan-kuantitatif', count: 4 }]);
  const errorOf = async (work: Promise<unknown>) => (await work.then(() => null, (failure: unknown) => failure)) as AppError | null;

  const storedItems = async (sessionId: string) => (await prisma.tryoutSession.findUniqueOrThrow({ where: { id: sessionId } })).items as unknown as TryoutItem[];

  const answerAll = async (sessionId: string, wrongEvery = 0) => {
    const items = await storedItems(sessionId);
    return Object.fromEntries(items.map((item, index) => [item.id, wrongEvery > 0 && index % wrongEvery === 0 ? (item.answer + 1) % item.options.length : item.answer]));
  };

  const age = (sessionId: string, seconds: number) =>
    prisma.tryoutSession.update({ where: { id: sessionId }, data: { startedAt: new Date(Date.now() - seconds * 1000) } });

  beforeAll(async () => {
    releaseLock = await holdSuiteLock(REGISTRY_SUITE_LOCK);
    process.env.DATABASE_URL = databaseUrl;
    prisma = new PrismaService();
    pool = createPool();
    engines = new TryoutEngineService();
    service = new TryoutService(prisma, engines, new LearnerEventsService(prisma));

    const wanted = SUBTEST_KEYS.flatMap((key) => engines.engine.info(key).conceptIds);
    const present = new Set((await prisma.concept.findMany({ where: { id: { in: wanted } }, select: { id: true } })).map((row) => row.id));
    for (const [index, id] of wanted.entries()) {
      if (present.has(id)) continue;
      await prisma.concept.create({ data: { id, title: id, level: 1, sortOrder: index + 1 } });
      createdConcepts.push(id);
    }
  }, 120_000);

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.concept.deleteMany({ where: { id: { in: createdConcepts } } });
    await prisma.$disconnect();
    await pool.end();
    await releaseLock();
  });

  it('lists the exam, the subtests, the presets and what the learner has done', async () => {
    const user = await learner();
    const catalog = await service.catalog(user);
    expect(catalog.exam).toMatchObject({ key: UTBK_EXAM_KEY, title: 'UTBK-SNBT' });
    expect(catalog.subtests.map((subtest) => subtest.key)).toEqual([...SUBTEST_KEYS]);
    expect(catalog.presets.map((preset) => preset.id)).toEqual(['singkat', 'tps', 'literasi']);
    expect(catalog.active).toBeNull();
    expect(catalog.recent).toEqual([]);
  });

  it('starts a session with the questions but without the answer keys or explanations', async () => {
    const user = await learner();
    const started = await service.start(user, small());
    expect(started).toMatchObject({ status: 'IN_PROGRESS', total: 10, examKey: UTBK_EXAM_KEY, answers: {} });
    expect(started.durationSeconds).toBe(6 * 60 + 4 * 60);
    expect(started.remainingSeconds).toBeGreaterThan(started.durationSeconds - 5);
    expect(started.items).toHaveLength(10);
    for (const item of started.items) {
      expect(item).not.toHaveProperty('answer');
      expect(item).not.toHaveProperty('explanation');
      expect(item.options.length).toBeGreaterThanOrEqual(4);
    }
    const view = await service.view(user, started.id);
    expect(JSON.stringify(view)).not.toMatch(/"explanation"|"answer":/);
    expect((await service.catalog(user)).active).toMatchObject({ id: started.id, total: 10, answered: 0 });
  });

  it('refuses a second running session and allows one after the first is submitted', async () => {
    const user = await learner();
    const first = await service.start(user, small());
    const blocked = await errorOf(service.start(user, small()));
    expect(blocked?.statusCode).toBe(409);
    await service.submit(user, first.id, {});
    const second = await service.start(user, small());
    expect(second.id).not.toBe(first.id);
  });

  it('refuses an invalid plan', async () => {
    const user = await learner();
    expect((await errorOf(service.start(user, plan([{ key: 'ppu', count: 99 }]))))?.statusCode).toBe(400);
    expect((await errorOf(service.start(user, plan([{ key: 'ppu', count: 3 }, { key: 'ppu', count: 4 }]))))?.statusCode).toBe(400);
    expect(await prisma.tryoutSession.count({ where: { userId: user } })).toBe(0);
  });

  it('saves answers a few at a time, replaces them, clears them and rejects what does not exist', async () => {
    const user = await learner();
    const session = await service.start(user, small());
    const first = await service.saveAnswers(user, session.id, { answers: { q1: 2, q2: 0 } });
    expect(first).toMatchObject({ saved: 2, total: 10 });
    await service.saveAnswers(user, session.id, { answers: { q1: 1, q3: 3 } });
    expect((await service.view(user, session.id)).answers).toEqual({ q1: 1, q2: 0, q3: 3 });
    await service.saveAnswers(user, session.id, { answers: { q2: null } });
    expect((await service.view(user, session.id)).answers).toEqual({ q1: 1, q3: 3 });

    expect((await errorOf(service.saveAnswers(user, session.id, { answers: { q99: 1 } })))?.statusCode).toBe(400);
    expect((await errorOf(service.saveAnswers(user, session.id, { answers: { q1: 7 } })))?.message).toMatch(/tidak valid/i);
    const stored = await prisma.tryoutSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(stored.answers).toEqual({ q1: 1, q3: 3 });
  });

  it('grades a submission by subtest and by concept and shows the key and the explanation afterwards', async () => {
    const user = await learner();
    const session = await service.start(user, small());
    const answers = await answerAll(session.id, 2);
    const items = await storedItems(session.id);
    const expectedCorrect = items.filter((_, index) => index % 2 !== 0).length;

    const before = await errorOf(service.result(user, session.id));
    expect(before?.statusCode).toBe(409);

    const result = await service.submit(user, session.id, { answers });
    expect(result).toMatchObject({ total: 10, answered: 10, correct: expectedCorrect, percent: (expectedCorrect / 10) * 100, timedOut: false });
    expect(result.subtests.map((subtest) => subtest.key)).toEqual(['penalaran-umum', 'pengetahuan-kuantitatif']);
    expect(result.subtests.reduce((sum, subtest) => sum + subtest.correct, 0)).toBe(expectedCorrect);
    expect(result.concepts.reduce((sum, concept) => sum + concept.total, 0)).toBe(10);
    expect(result.review).toHaveLength(10);
    for (const row of result.review) {
      expect(row.explanation.length).toBeGreaterThan(10);
      expect(row.correct).toBe(row.chosen === row.answer);
    }
    expect(await service.result(user, session.id)).toEqual(result);
    expect((await service.catalog(user)).recent[0]).toMatchObject({ id: session.id, percent: result.percent, total: 10 });
    expect((await service.view(user, session.id)).status).toBe('SUBMITTED');
  });

  it('counts an unanswered question as wrong and lists the weak concepts', async () => {
    const user = await learner();
    const session = await service.start(user, plan([{ key: 'penalaran-umum', count: 9 }]));
    const result = await service.submit(user, session.id, {});
    expect(result).toMatchObject({ answered: 0, correct: 0, percent: 0 });
    expect(result.weakConceptIds.length).toBe(3);
    expect(result.concepts.every((concept) => concept.percent === 0)).toBe(true);
  });

  it('is idempotent when the same submission arrives twice, even at the same moment', async () => {
    const user = await learner();
    const session = await service.start(user, small());
    const answers = await answerAll(session.id);
    const [a, b] = await Promise.all([service.submit(user, session.id, { answers }), service.submit(user, session.id, { answers })]);
    expect(a.percent).toBe(100);
    expect(b).toEqual(a);
    const later = await service.submit(user, session.id, { answers: { q1: 0 } });
    expect(later).toEqual(a);
    expect(await prisma.learningEvent.count({ where: { userId: user } })).toBe(a.concepts.filter((concept) => concept.total >= 2).length);
  });

  it('writes one piece of learner evidence per concept and none when the learner barely answered', async () => {
    const user = await learner();
    const session = await service.start(user, small());
    const result = await service.submit(user, session.id, { answers: await answerAll(session.id) });
    const events = await prisma.learningEvent.findMany({ where: { userId: user } });
    const eligible = result.concepts.filter((concept) => concept.total >= 2);
    expect(eligible.length).toBeGreaterThan(0);
    expect(events).toHaveLength(eligible.length);
    expect(events.map((event) => event.idempotencyKey).sort()).toEqual(eligible.map((concept) => `tryout:${session.id}:${concept.conceptId}`).sort());

    const idle = await learner();
    const idleSession = await service.start(idle, small());
    await service.submit(idle, idleSession.id, { answers: { q1: 0, q2: 0 } });
    expect(await prisma.learningEvent.count({ where: { userId: idle } })).toBe(0);
  });

  it('keeps a session private to its owner', async () => {
    const [owner, other] = [await learner(), await learner()];
    const session = await service.start(owner, small());
    expect((await errorOf(service.view(other, session.id)))?.statusCode).toBe(404);
    expect((await errorOf(service.saveAnswers(other, session.id, { answers: { q1: 0 } })))?.statusCode).toBe(404);
    expect((await errorOf(service.submit(other, session.id, {})))?.statusCode).toBe(404);
    expect((await errorOf(service.result(other, session.id)))?.statusCode).toBe(404);
    expect((await service.catalog(other)).active).toBeNull();
    expect((await prisma.tryoutSession.findUniqueOrThrow({ where: { id: session.id } })).status).toBe('IN_PROGRESS');
  });

  it('closes a session whose time ran out and refuses late answers', async () => {
    const user = await learner();
    const session = await service.start(user, small());
    await service.saveAnswers(user, session.id, { answers: { q1: 1 } });
    await age(session.id, session.durationSeconds + GRACE_SECONDS + 30);

    const late = await errorOf(service.saveAnswers(user, session.id, { answers: { q2: 1 } }));
    expect(late?.statusCode).toBe(409);
    expect(late?.message).toMatch(/habis/);

    const view = await service.view(user, session.id);
    expect(view.status).toBe('SUBMITTED');
    const result = await service.result(user, session.id);
    expect(result).toMatchObject({ answered: 1, timedOut: false, usedSeconds: session.durationSeconds });
    const stored = await prisma.tryoutSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(stored.submittedAt!.getTime()).toBe(stored.startedAt.getTime() + session.durationSeconds * 1000);
  });

  it('frees the learner to start again once an old session has expired', async () => {
    const user = await learner();
    const session = await service.start(user, small());
    await age(session.id, session.durationSeconds + GRACE_SECONDS + 5);
    const next = await service.start(user, small());
    expect(next.id).not.toBe(session.id);
    expect((await prisma.tryoutSession.findUniqueOrThrow({ where: { id: session.id } })).status).toBe('SUBMITTED');
  });

  it('ignores answers that arrive after the grace period when submitting', async () => {
    const user = await learner();
    const session = await service.start(user, small());
    await service.saveAnswers(user, session.id, { answers: { q1: 1 } });
    await age(session.id, session.durationSeconds + GRACE_SECONDS + 10);
    const result = await service.submit(user, session.id, { answers: await answerAll(session.id) });
    expect(result.answered).toBe(1);
  });

  it('accepts the final answers sent just after the deadline, within the grace period', async () => {
    const user = await learner();
    const session = await service.start(user, small());
    await age(session.id, session.durationSeconds + 3);
    const result = await service.submit(user, session.id, { answers: await answerAll(session.id) });
    expect(result.answered).toBe(10);
    expect(result.percent).toBe(100);
    expect(result.timedOut).toBe(false);
  });

  it('never puts a message or data key at the top of a payload, where the response wrapper would take it', async () => {
    const user = await learner();
    const started = await service.start(user, small());
    const saved = await service.saveAnswers(user, started.id, { answers: { q1: 0 } });
    const submitted = await service.submit(user, started.id, {});
    for (const payload of [await service.catalog(user), started, saved, submitted, await service.result(user, started.id), await service.view(user, started.id)]) {
      expect(payload).not.toHaveProperty('message');
      expect(payload).not.toHaveProperty('data');
    }
  });

  describe('the history', () => {
    const finish = async (user: string, subtests: Array<{ key: (typeof SUBTEST_KEYS)[number]; count: number }>, wrongEvery = 0) => {
      const session = await service.start(user, plan(subtests));
      await service.submit(user, session.id, { answers: await answerAll(session.id, wrongEvery) });
      return session.id;
    };

    it('pages the finished sessions newest first without losing or repeating one', async () => {
      const user = await learner();
      const ids: string[] = [];
      for (let i = 0; i < 7; i += 1) {
        ids.push(await finish(user, [{ key: 'ppu', count: 4 }], i));
        await new Promise((resolve) => setTimeout(resolve, 15));
      }

      const seen: string[] = [];
      let cursor: number | undefined = 0;
      let pages = 0;
      while (cursor !== undefined) {
        const page = await service.history(user, { sort: 'NEWEST', limit: 3, cursor });
        expect(page.page.total).toBe(7);
        seen.push(...page.items.map((item) => item.id));
        cursor = page.page.nextCursor ?? undefined;
        pages += 1;
      }
      expect(seen).toEqual([...ids].reverse());
      expect(pages).toBe(3);
      expect((await service.history(user, { sort: 'OLDEST' })).items.map((item) => item.id)).toEqual(ids);
    });

    it('filters by score band and by subtest and sorts by score', async () => {
      const user = await learner();
      const perfect = await finish(user, [{ key: 'ppu', count: 4 }]);
      const weak = await finish(user, [{ key: 'pengetahuan-kuantitatif', count: 4 }], 1);
      const half = await finish(user, [{ key: 'ppu', count: 4 }, { key: 'pengetahuan-kuantitatif', count: 4 }], 2);

      expect((await service.history(user, { sort: 'NEWEST', band: 'SANGAT_BAIK' })).items.map((item) => item.id)).toEqual([perfect]);
      expect((await service.history(user, { sort: 'NEWEST', band: 'LATIH' })).items.map((item) => item.id)).toEqual([weak]);
      expect((await service.history(user, { sort: 'NEWEST', band: 'CUKUP' })).items.map((item) => item.id)).toEqual([half]);
      expect((await service.history(user, { sort: 'NEWEST', subtest: 'ppu' })).items.map((item) => item.id)).toEqual([half, perfect]);
      expect((await service.history(user, { sort: 'HIGHEST' })).items.map((item) => item.id)).toEqual([perfect, half, weak]);
      expect((await service.history(user, { sort: 'LOWEST' })).items.map((item) => item.id)).toEqual([weak, half, perfect]);
      expect((await service.history(user, { sort: 'NEWEST', subtest: 'literasi-inggris' })).items).toEqual([]);
    });

    it('lists only the caller finished sessions and closes one that ran out of time', async () => {
      const [owner, other] = [await learner(), await learner()];
      const done = await finish(owner, [{ key: 'ppu', count: 3 }]);
      const running = await service.start(owner, plan([{ key: 'ppu', count: 3 }]));
      expect((await service.history(owner, { sort: 'NEWEST' })).items.map((item) => item.id)).toEqual([done]);
      expect((await service.history(other, { sort: 'NEWEST' })).page.total).toBe(0);

      await age(running.id, running.durationSeconds + GRACE_SECONDS + 10);
      const after = await service.history(owner, { sort: 'NEWEST' });
      expect(after.items.map((item) => item.id)).toEqual([done, running.id]);
    });

    it('never puts a message or data key at the top of the payload', async () => {
      const user = await learner();
      await finish(user, [{ key: 'ppu', count: 3 }]);
      const payload = await service.history(user, { sort: 'NEWEST' });
      expect(payload).not.toHaveProperty('message');
      expect(payload).not.toHaveProperty('data');
    });
  });

  it('deletes with the learner', async () => {
    const user = await learner();
    await service.start(user, small());
    await prisma.user.delete({ where: { id: user } });
    users.splice(users.indexOf(user), 1);
    expect(await prisma.tryoutSession.count({ where: { userId: user } })).toBe(0);
  });
});
