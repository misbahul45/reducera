import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { LearnerEventsService } from '@/v1/learner-model/events/learner-events.service';
import { AssessmentPayload } from '@/v1/learner-model/mastery/assessment-payload';
import { ReviewService } from '@/v1/learner-model/review/review.service';
import { PrismaService } from '@/common/config/prisma/prisma.service';
import { REGISTRY_SUITE_LOCK, createPool, databaseUrl, describeDb, holdSuiteLock, insertUser } from '@/test-utils/pg-fixtures';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-16T00:00:00.000Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS);

const payload = (): AssessmentPayload => ({
  attemptId: randomUUID(),
  quizId: 'quiz-review',
  score: 0.9,
  items: 5,
  hintsUsed: 0,
  share: 1,
  attemptNumber: 1,
});

describeDb('review queue on a real database (requires TEST_DATABASE_URL)', () => {
  let prisma: PrismaService;
  let pool: Pool;
  let events: LearnerEventsService;
  let service: ReviewService;
  let releaseLock: () => Promise<void>;

  const tag = randomUUID().slice(0, 8);
  const ids = {
    stale: `rv-${tag}-stale`,
    staleDeeper: `rv-${tag}-stale-deeper`,
    fresh: `rv-${tag}-fresh`,
    unlinked: `rv-${tag}-unlinked`,
    viaSubTopic: `rv-${tag}-via-subtopic`,
    unseen: `rv-${tag}-unseen`,
  };
  const users: string[] = [];
  let topicId: string;
  let lessonOne: string;
  let lessonTwo: string;
  let stepOne: string;
  let stepTwo: string;

  const learnConcept = async (userId: string, conceptId: string, daysSince: number, times = 3) => {
    for (let n = 0; n < times; n += 1) {
      await events.append({ userId, conceptId, idempotencyKey: randomUUID(), payload: payload(), occurredAt: daysAgo(daysSince) });
    }
  };

  const userStep = (userId: string, stepTemplateId: string, order: number) =>
    prisma.userStep.create({ data: { userId, stepTemplateId, order, title: `Step ${order}` } });

  beforeAll(async () => {
    releaseLock = await holdSuiteLock(REGISTRY_SUITE_LOCK);
    process.env.DATABASE_URL = databaseUrl;
    prisma = new PrismaService();
    pool = createPool();
    events = new LearnerEventsService(prisma);
    service = new ReviewService(prisma);

    for (const [index, id] of Object.values(ids).entries()) {
      await prisma.concept.create({ data: { id, title: `Konsep ${id}`, level: 1, sortOrder: 100 + index } });
    }

    const topic = await prisma.topic.create({
      data: {
        title: 'Review fixture',
        slug: `rv-${tag}`,
        image: {},
        price: 0,
        subTopics: {
          create: [
            { title: 'S1', lessons: { create: [{ title: 'L1', steps: { create: [{ title: 'Step L1' }] } }] } },
            { title: 'S2', lessons: { create: [{ title: 'L2', steps: { create: [{ title: 'Step L2' }] } }] } },
          ],
        },
      },
      include: { subTopics: { include: { lessons: { include: { steps: true } } } } },
    });
    topicId = topic.id;
    const s1 = topic.subTopics.find((s) => s.title === 'S1')!;
    const s2 = topic.subTopics.find((s) => s.title === 'S2')!;
    lessonOne = s1.lessons[0].id;
    lessonTwo = s2.lessons[0].id;
    stepOne = s1.lessons[0].steps[0].id;
    stepTwo = s2.lessons[0].steps[0].id;

    const link = (conceptId: string, target: { lessonId?: string; subTopicId?: string }, status: 'APPROVED' | 'PROPOSED' = 'APPROVED') =>
      prisma.conceptCurriculumLink.create({ data: { id: randomUUID(), conceptId, status, ...target } });
    await link(ids.stale, { lessonId: lessonOne });
    await link(ids.staleDeeper, { lessonId: lessonOne });
    await link(ids.fresh, { lessonId: lessonOne });
    await link(ids.viaSubTopic, { subTopicId: s2.id });
    await link(ids.unseen, { lessonId: lessonTwo });
  }, 120_000);

  afterAll(async () => {
    try {
      await prisma.userStep.deleteMany({ where: { userId: { in: users } } });
      await prisma.user.deleteMany({ where: { id: { in: users } } });
      await prisma.conceptCurriculumLink.deleteMany({ where: { conceptId: { in: Object.values(ids) } } });
      await prisma.topic.deleteMany({ where: { id: topicId } });
      await prisma.concept.deleteMany({ where: { id: { in: Object.values(ids) } } });
    } finally {
      await prisma.$disconnect();
      await pool.end();
      await releaseLock();
    }
  });

  const newUser = async () => {
    const id = await insertUser(pool);
    users.push(id);
    return id;
  };

  it('is empty for a learner with no evidence', async () => {
    const userId = await newUser();

    const view = await service.queue(userId, NOW);

    expect(view).toMatchObject({ dueTotal: 0, due: [], upcoming: [] });
    expect(view.session.conceptIds).toEqual([]);
  });

  it('lists what has been forgotten, most forgotten first, and sends the learner to their own step', async () => {
    const userId = await newUser();
    await learnConcept(userId, ids.stale, 12);
    await learnConcept(userId, ids.staleDeeper, 45);
    await learnConcept(userId, ids.fresh, 0);
    await learnConcept(userId, ids.viaSubTopic, 25);
    const first = await userStep(userId, stepOne, 1);
    const second = await userStep(userId, stepTwo, 2);

    const view = await service.queue(userId, NOW);

    expect(view.due.map((entry) => entry.conceptId)).toEqual([ids.staleDeeper, ids.viaSubTopic, ids.stale]);
    expect(view.due.map((entry) => entry.target?.userStepId)).toEqual([first.id, second.id, first.id]);
    expect(view.due[0].target?.stepTemplateId).toBe(stepOne);
    expect(view.due[0]).toMatchObject({ title: `Konsep ${ids.staleDeeper}`, kind: 'REVIEW', evidenceCount: 3 });
    expect(view.due.map((entry) => entry.conceptId)).not.toContain(ids.fresh);
    expect(view.session.conceptIds).toEqual([ids.staleDeeper, ids.viaSubTopic, ids.stale]);
    expect(view.session.totalQuestions).toBe(9);
  });

  it('keeps a due concept that the learner has no step for in the list but out of the session', async () => {
    const userId = await newUser();
    await learnConcept(userId, ids.unlinked, 30);
    await learnConcept(userId, ids.stale, 12);
    const first = await userStep(userId, stepOne, 1);

    const view = await service.queue(userId, NOW);

    expect(view.due.map((entry) => [entry.conceptId, entry.target?.userStepId ?? null])).toEqual([
      [ids.unlinked, null],
      [ids.stale, first.id],
    ]);
    expect(view.session.conceptIds).toEqual([ids.stale]);
  });

  it("never points at another learner's step", async () => {
    const owner = await newUser();
    const other = await newUser();
    await userStep(owner, stepOne, 1);
    await learnConcept(other, ids.stale, 12);

    const view = await service.queue(other, NOW);

    expect(view.due[0].conceptId).toBe(ids.stale);
    expect(view.due[0].target).toBeNull();
  });

  it('does not review a concept the learner has not been assessed on', async () => {
    const userId = await newUser();
    await userStep(userId, stepTwo, 1);

    const view = await service.queue(userId, NOW);

    expect(view.due.map((entry) => entry.conceptId)).not.toContain(ids.unseen);
  });

  it('moves a concept off the due list after a fresh assessment', async () => {
    const userId = await newUser();
    await learnConcept(userId, ids.stale, 30);
    expect((await service.queue(userId, NOW)).due.map((entry) => entry.conceptId)).toContain(ids.stale);

    await events.append({ userId, conceptId: ids.stale, idempotencyKey: randomUUID(), payload: payload(), occurredAt: NOW });

    expect((await service.queue(userId, NOW)).due.map((entry) => entry.conceptId)).not.toContain(ids.stale);
  });
});
