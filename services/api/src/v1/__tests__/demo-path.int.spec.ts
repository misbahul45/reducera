import { randomUUID } from 'crypto';
import { Role, TenantRole } from '@prisma/client';
import { Pool } from 'pg';
import { TenantContext } from '@/common/tenancy/tenant-context';
import { QuizAttemptsService } from '@/v1/quiz/quiz-attempts/quiz-attempts.service';
import { QuizEvaluationService } from '@/v1/quiz/services/quiz-evaluation.service';
import { ConceptRegistryService } from '@/v1/learner-model/concepts/concept-registry.service';
import { LearnerEventsService } from '@/v1/learner-model/events/learner-events.service';
import { LearnerStateService } from '@/v1/learner-model/learner-state.service';
import { AssessmentPayload } from '@/v1/learner-model/mastery/assessment-payload';
import { LearnerPolicyService } from '@/v1/learner-model/policy/learner-policy.service';
import { ReviewService } from '@/v1/learner-model/review/review.service';
import { StrategyOutcomeService } from '@/v1/learner-model/strategy/strategy-outcome.service';
import { MarketplaceDiscoveryService } from '@/v1/marketplace/marketplace-discovery.service';
import { buildCommerceStack, CommerceStack } from '@/test-utils/commerce-harness';
import { REGISTRY_SUITE_LOCK, createPool, databaseUrl, describeDb, holdSuiteLock, insertMembership, insertTenant, insertUser } from '@/test-utils/pg-fixtures';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date();
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS);

const weakAssessment = (): AssessmentPayload => ({ attemptId: randomUUID(), quizId: 'quiz-demo', score: 0.2, items: 5, hintsUsed: 0, share: 1, attemptNumber: 1 });

describeDb('the demo path from a tagged class to a graded quiz (requires TEST_DATABASE_URL)', () => {
  let pool: Pool;
  let s: CommerceStack;
  let events: LearnerEventsService;
  let state: LearnerStateService;
  let review: ReviewService;
  let discovery: MarketplaceDiscoveryService;
  let outcomes: StrategyOutcomeService;
  let quizzes: QuizAttemptsService;
  let releaseLock: () => Promise<void>;

  const tag = randomUUID().slice(0, 8);
  const ids = { first: `dp-${tag}-akun`, second: `dp-${tag}-jurnal`, other: `dp-${tag}-lain` };
  const learners: string[] = [];
  const staff: string[] = [];
  const topics: string[] = [];

  const teacher = (id: string) => ({ id, role: Role.TEACHER });
  const admin = (id: string) => ({ id, role: Role.ADMIN });
  const ctx = (userId: string, tenantId: string, tenantRole: TenantRole): TenantContext => ({ userId, tenantId, tenantRole, isPlatformAdmin: false });

  const newUser = async (role: 'STUDENT' | 'TEACHER' | 'ADMIN' = 'STUDENT') => {
    const id = await insertUser(pool, role);
    (role === 'STUDENT' ? learners : staff).push(id);
    return id;
  };

  const publishTaggedClass = async (conceptIds: string[]) => {
    const owner = await newUser('TEACHER');
    const author = await newUser('TEACHER');
    const reviewer = await newUser('ADMIN');
    const tenant = await insertTenant(pool, owner);
    await insertMembership(pool, tenant, owner, 'OWNER');
    await insertMembership(pool, tenant, author, 'TEACHER');
    const authorCtx = ctx(author, tenant, TenantRole.TEACHER);
    const created = (
      await s.classAuthoring.create(teacher(author), authorCtx, { title: 'Akuntansi Dasar untuk Pemula', accessType: 'FREE', format: 'RECORDED', difficulty: 'BEGINNER', conceptIds } as never, 't')
    ).data;
    await s.classAuthoring.addSession(
      teacher(author),
      authorCtx,
      created.id,
      { startsAt: new Date(NOW.getTime() + 2 * DAY_MS), endsAt: new Date(NOW.getTime() + 2 * DAY_MS + 3_600_000), recordingUrl: 'https://rec.example.test/demo' } as never,
      't',
    );
    await s.classAuthoring.submitReview(teacher(author), authorCtx, created.id, 't');
    const proposed = await s.prisma.productConceptLink.findMany({ where: { classProductId: created.id }, select: { conceptId: true, status: true } });
    await s.classModeration.approve(admin(reviewer), created.id, 'Sesuai isi kelas', 't');
    return { classId: created.id, reviewer, proposed };
  };

  const courseFixture = async () => {
    const topic = await s.prisma.topic.create({
      data: {
        title: 'Demo path course',
        slug: `demo-path-${randomUUID().slice(0, 8)}`,
        image: {},
        price: 0,
        subTopics: { create: [{ title: 'Dasar', lessons: { create: [{ title: 'Akun' }, { title: 'Jurnal' }] } }] },
      },
      include: { subTopics: { include: { lessons: true } } },
    });
    topics.push(topic.id);
    const lessons = topic.subTopics[0].lessons;
    const akun = lessons.find((lesson) => lesson.title === 'Akun') as { id: string };
    const jurnal = lessons.find((lesson) => lesson.title === 'Jurnal') as { id: string };
    await s.prisma.conceptCurriculumLink.create({ data: { id: `fixture:${randomUUID()}`, conceptId: ids.first, status: 'APPROVED', lessonId: akun.id } });
    await s.prisma.conceptCurriculumLink.create({ data: { id: `fixture:${randomUUID()}`, conceptId: ids.second, status: 'APPROVED', lessonId: jurnal.id } });
    const quiz = await s.prisma.quiz.create({
      data: {
        title: 'Kuis akun',
        lessonId: akun.id,
        questions: {
          create: [
            { question: 'Akun kas bertambah di sisi?', options: ['Debit', 'Kredit'], correctAnswer: 'Debit', points: 1, sortOrder: 1 },
            { question: 'Beban bertambah di sisi?', options: ['Debit', 'Kredit'], correctAnswer: 'Debit', points: 1, sortOrder: 2 },
          ],
        },
      },
      include: { questions: true },
    });
    return { topic, quiz };
  };

  const enrolledLearner = async (topicId: string) => {
    const id = await newUser();
    await s.prisma.userTopic.create({ data: { userId: id, topicId } });
    return id;
  };

  const tutorTurn = (userId: string, conceptId: string, strategy: string) =>
    s.prisma.episode.create({
      data: {
        userId,
        taskType: 'tutor_agent',
        inputPayload: {},
        retrievedChunks: {},
        retrievedMemory: {},
        strategy: { metadata: { teachingStrategy: strategy, strategyConceptId: conceptId, conceptIds: [conceptId] } },
        promptVersion: 'tutor-chat-builtin-3',
        modelName: 'test-model',
        response: 'jawaban',
      },
    });

  const submit = async (userId: string, quiz: { id: string; questions: Array<{ id: string }> }, choices: string[]) => {
    const started = await quizzes.startAttempt({ id: userId, role: 'STUDENT' }, { quizId: quiz.id });
    const body = { userId, attemptId: started.data.id, answers: Object.fromEntries(quiz.questions.map((q, i) => [q.id, choices[i]])) };
    return { body, result: await quizzes.submitAttempt(body) };
  };

  const masteryOf = (userId: string, conceptId: string) => s.prisma.conceptMastery.findUniqueOrThrow({ where: { userId_conceptId: { userId, conceptId } } });

  beforeAll(async () => {
    releaseLock = await holdSuiteLock(REGISTRY_SUITE_LOCK);
    process.env.DATABASE_URL = databaseUrl;
    pool = createPool();
    s = buildCommerceStack();
    const registry = new ConceptRegistryService(s.prisma);
    events = new LearnerEventsService(s.prisma);
    state = new LearnerStateService(s.prisma, registry, new LearnerPolicyService());
    review = new ReviewService(s.prisma);
    discovery = new MarketplaceDiscoveryService(s.prisma, state);
    outcomes = new StrategyOutcomeService(s.prisma, new LearnerPolicyService());
    quizzes = new QuizAttemptsService({} as never, s.prisma, undefined, undefined, new QuizEvaluationService(), registry, events, undefined, undefined, undefined, outcomes);
    for (const [index, id] of Object.values(ids).entries()) {
      await s.prisma.concept.create({ data: { id, title: `Konsep ${id}`, level: 1, sortOrder: 800 + index } });
    }
    await s.prisma.conceptPrerequisite.create({ data: { conceptId: ids.second, requiresId: ids.first } });
  }, 120_000);

  afterAll(async () => {
    try {
      await s.prisma.productConceptLink.deleteMany({ where: { conceptId: { in: Object.values(ids) } } });
      await s.prisma.leaderboardScore.deleteMany({ where: { userId: { in: learners } } });
      await s.prisma.entitlement.deleteMany({ where: { userId: { in: [...learners, ...staff] } } });
      await s.prisma.user.deleteMany({ where: { id: { in: learners } } });
      await s.prisma.topic.deleteMany({ where: { id: { in: topics } } });
      await s.prisma.concept.deleteMany({ where: { id: { in: Object.values(ids) } } });
    } finally {
      await s.prisma.$disconnect();
      await pool.end();
      await releaseLock();
    }
  });

  it('runs the whole path: tag and approve, need, recommendation, tutor turn, graded quiz, new state', async () => {
    const { topic, quiz } = await courseFixture();
    const listing = await publishTaggedClass([ids.first]);

    expect(listing.proposed).toEqual([{ conceptId: ids.first, status: 'PROPOSED' }]);
    const links = await s.prisma.productConceptLink.findMany({ where: { classProductId: listing.classId }, select: { conceptId: true, status: true, reviewedAt: true } });
    expect(links).toEqual([{ conceptId: ids.first, status: 'APPROVED', reviewedAt: expect.any(Date) }]);
    expect(await s.prisma.auditLog.count({ where: { entityId: listing.classId, actorId: listing.reviewer } })).toBeGreaterThan(0);
    expect((await s.marketplaceClasses.findOne(listing.classId)).data.concepts).toEqual([{ id: ids.first, title: `Konsep ${ids.first}` }]);

    const learner = await enrolledLearner(topic.id);
    for (const when of [4, 3]) await events.append({ userId: learner, conceptId: ids.first, idempotencyKey: randomUUID(), payload: weakAssessment(), occurredAt: daysAgo(when) });
    const weak = await masteryOf(learner, ids.first);
    expect(weak.evidenceCount).toBe(2);
    expect(weak.score).toBeLessThan(0.5);

    const needNow = await state.nextConcept(learner);
    expect(needNow).toMatchObject({ conceptId: ids.first, reasonCodes: ['CONTINUE_PRACTICE'] });
    const queue = await review.queue(learner);
    expect(queue.due.map((entry) => [entry.conceptId, entry.kind])).toEqual([[ids.first, 'RELEARN']]);

    const shelf = await discovery.recommend(learner, { limit: 10 });
    const hit = shelf.recommendations.find((item) => item.product.id === listing.classId);
    expect(hit).toMatchObject({ personalized: true, matchedConcepts: [{ conceptId: ids.first, kind: expect.any(String) }], product: { kind: 'class' } });
    expect(hit?.reason).toContain(`Konsep ${ids.first}`);
    expect(shelf.needs.map((need) => need.conceptId)).toContain(ids.first);

    const taught = await tutorTurn(learner, ids.first, 'WORKED_EXAMPLE');
    const before = weak;

    const { body, result } = await submit(learner, quiz, ['Debit', 'Debit']);
    expect(result.score).toBe(100);

    const stored = await s.prisma.learningEvent.findMany({ where: { userId: learner }, orderBy: { streamSeq: 'asc' } });
    expect(stored).toHaveLength(3);
    const appended = stored[2];
    expect(appended).toMatchObject({ conceptId: ids.first, streamSeq: 3, entityType: 'QUIZ_ATTEMPT', entityId: body.attemptId, idempotencyKey: `assessment:${body.attemptId}:${ids.first}` });
    expect(appended.payload).toMatchObject({ score: 1, items: 2, share: 1, attemptNumber: 1, hintsUsed: 0 });

    const after = await masteryOf(learner, ids.first);
    expect(after.evidenceCount).toBe(3);
    expect(after.score).toBeGreaterThan(before.score);
    expect(after.modelVersion).toBe('mastery-v1');
    expect(await events.rebuild(learner)).toMatchObject({ changed: [], removed: [], skipped: [] });

    const outcome = await s.prisma.strategyOutcome.findMany({ where: { userId: learner } });
    expect(outcome).toHaveLength(1);
    expect(outcome[0]).toMatchObject({ conceptId: ids.first, strategy: 'WORKED_EXAMPLE', episodeId: taught.id, promptVersion: 'tutor-chat-builtin-3', success: true, eventKey: appended.idempotencyKey });
    expect(outcome[0].scoreBefore).toBeCloseTo(before.score, 9);
    expect(outcome[0].scoreAfter).toBeCloseTo(after.score, 9);

    await expect(quizzes.submitAttempt(body)).rejects.toThrow(/already submitted/i);
    const replayed = await events.append({ userId: learner, conceptId: ids.first, idempotencyKey: appended.idempotencyKey as string, payload: appended.payload as unknown as AssessmentPayload });
    expect(replayed).toMatchObject({ duplicate: true, eventId: appended.id });
    expect(await s.prisma.learningEvent.count({ where: { userId: learner } })).toBe(3);
    expect(await s.prisma.strategyOutcome.count({ where: { userId: learner } })).toBe(1);
    expect((await masteryOf(learner, ids.first)).evidenceCount).toBe(3);

    const reloaded = new LearnerStateService(s.prisma, new ConceptRegistryService(s.prisma), new LearnerPolicyService());
    const nextAfter = await reloaded.nextConcept(learner);
    const reviewAfter = await new ReviewService(s.prisma).queue(learner);
    const row = await masteryOf(learner, ids.first);
    expect(reviewAfter.due.find((entry) => entry.conceptId === ids.first)).toBeUndefined();
    expect(row.score).toBeLessThan(0.7);
    expect(nextAfter).toMatchObject({ conceptId: ids.first, reasonCodes: ['CONTINUE_PRACTICE'] });
  });

  it('shows a learner whose need does not match any approved tag only the plainly labelled new arrivals', async () => {
    await publishTaggedClass([ids.first]);
    const learner = await newUser();
    await events.append({ userId: learner, conceptId: ids.other, idempotencyKey: randomUUID(), payload: weakAssessment(), occurredAt: daysAgo(3) });

    const shelf = await discovery.recommend(learner, { limit: 10 });

    expect(shelf.recommendations.length).toBeGreaterThan(0);
    for (const item of shelf.recommendations) {
      expect(item.personalized).toBe(false);
      expect(item.reason).toBe('Terbaru di marketplace.');
    }
  });

  it('keeps a proposed tag out of the shelf until the administrator approves the class', async () => {
    const { topic } = await courseFixture();
    const owner = await newUser('TEACHER');
    const author = await newUser('TEACHER');
    const tenant = await insertTenant(pool, owner);
    await insertMembership(pool, tenant, owner, 'OWNER');
    await insertMembership(pool, tenant, author, 'TEACHER');
    const authorCtx = ctx(author, tenant, TenantRole.TEACHER);
    const draft = (await s.classAuthoring.create(teacher(author), authorCtx, { title: 'Belum tayang', accessType: 'FREE', format: 'RECORDED', conceptIds: [ids.first] } as never, 't')).data;
    const learner = await enrolledLearner(topic.id);
    await events.append({ userId: learner, conceptId: ids.first, idempotencyKey: randomUUID(), payload: weakAssessment(), occurredAt: daysAgo(3) });

    const shelf = await discovery.recommend(learner, { limit: 30 });

    expect(shelf.recommendations.map((item) => item.product.id)).not.toContain(draft.id);
  });
});
