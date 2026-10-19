import { Pool } from 'pg';
import { PrismaService } from '@/common/config/prisma/prisma.service';
import { ReviewService } from '@/v1/learner-model/review/review.service';
import { ReviewReminderService } from '@/v1/learner-model/review/review-reminder.service';
import { REMINDER_TITLE, reminderKey } from '@/v1/learner-model/review/review-reminder';
import { REGISTRY_SUITE_LOCK, createPool, databaseUrl, describeDb, holdSuiteLock, insertUser } from '@/test-utils/pg-fixtures';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-16T11:00:00.000Z');
const daysAgo = (days: number, from: Date = NOW) => new Date(from.getTime() - days * DAY_MS);

describeDb('review reminders (requires TEST_DATABASE_URL)', () => {
  let prisma: PrismaService;
  let pool: Pool;
  let review: ReviewService;
  let service: ReviewReminderService;
  let releaseLock: () => Promise<void>;
  const users: string[] = [];
  const concepts = ['rr-test-a', 'rr-test-b', 'rr-test-c'];
  const createdConcepts: string[] = [];

  const learner = async () => {
    const id = await insertUser(pool);
    users.push(id);
    return id;
  };

  const mastery = (userId: string, conceptId: string, days: number, evidenceCount = 4) =>
    prisma.conceptMastery.create({
      data: { userId, conceptId, theta: 1, score: 0.8, confidence: 0.3, evidenceCount, lastEventAt: daysAgo(days), lastSeq: evidenceCount, modelVersion: 'mastery-v1' },
    });

  const reminders = (userId: string) => prisma.notification.findMany({ where: { userId, type: 'REVIEW' }, orderBy: { createdAt: 'asc' } });

  beforeAll(async () => {
    releaseLock = await holdSuiteLock(REGISTRY_SUITE_LOCK);
    process.env.DATABASE_URL = databaseUrl;
    prisma = new PrismaService();
    pool = createPool();
    for (const [index, id] of concepts.entries()) {
      if (await prisma.concept.findUnique({ where: { id } })) continue;
      await prisma.concept.create({ data: { id, title: `Konsep ${id}`, level: 1, sortOrder: index + 1 } });
      createdConcepts.push(id);
    }
    review = new ReviewService(prisma);
    service = new ReviewReminderService(prisma, review);
  }, 120_000);

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.concept.deleteMany({ where: { id: { in: createdConcepts } } });
    await prisma.$disconnect();
    await pool.end();
    await releaseLock();
  });

  it('sends one reminder that names what is fading and writes it once per day', async () => {
    const user = await learner();
    await mastery(user, 'rr-test-a', 12);

    const sweep = await service.run(NOW, [user]);

    expect(sweep).toMatchObject({ considered: 1, sent: 1, paused: 0, duplicate: 0, failed: 0 });
    const [stored, ...rest] = await reminders(user);
    expect(rest).toHaveLength(0);
    expect(stored).toMatchObject({ title: REMINDER_TITLE, readAt: null, isGlobal: false, dedupeKey: reminderKey(user, NOW) });
    expect(stored!.body).toContain('Konsep rr-test-a');
    expect(stored!.body).toContain('mulai terlupa');
  });

  it('does not pile reminders up while the last one is unread, and not twice in one day once it was read', async () => {
    const user = await learner();
    await mastery(user, 'rr-test-a', 12);
    await service.run(NOW, [user]);

    const again = await service.run(NOW, [user]);
    expect(again).toMatchObject({ considered: 1, sent: 0, paused: 1 });
    expect(await reminders(user)).toHaveLength(1);

    await prisma.notification.updateMany({ where: { userId: user, type: 'REVIEW' }, data: { readAt: NOW } });
    const sameDay = await service.run(new Date(NOW.getTime() + 60 * 60 * 1000), [user]);
    expect(sameDay).toMatchObject({ sent: 0, duplicate: 1 });
    expect(await reminders(user)).toHaveLength(1);
  });

  it('sends again the next day after the learner read the last one', async () => {
    const user = await learner();
    await mastery(user, 'rr-test-a', 12);
    await service.run(NOW, [user]);
    await prisma.notification.updateMany({ where: { userId: user, type: 'REVIEW' }, data: { readAt: NOW } });

    const tomorrow = await service.run(new Date(NOW.getTime() + DAY_MS), [user]);

    expect(tomorrow).toMatchObject({ sent: 1, paused: 0 });
    expect(await reminders(user)).toHaveLength(2);
  });

  it('stops waiting for a reminder that stayed unread for more than three days', async () => {
    const user = await learner();
    await mastery(user, 'rr-test-a', 12);
    await service.run(NOW, [user]);
    await prisma.notification.updateMany({ where: { userId: user, type: 'REVIEW' }, data: { createdAt: NOW } });

    const withinThree = await service.run(new Date(NOW.getTime() + 2 * DAY_MS), [user]);
    expect(withinThree).toMatchObject({ sent: 0, paused: 1 });

    const afterFour = await service.run(new Date(NOW.getTime() + 4 * DAY_MS), [user]);
    expect(afterFour).toMatchObject({ sent: 1, paused: 0 });
    expect(await reminders(user)).toHaveLength(2);
  });

  it('skips a learner who turned reminders off, an inactive account and a learner with nothing to review', async () => {
    const optedOut = await learner();
    const inactive = await learner();
    const fresh = await learner();
    const noEvidence = await learner();
    for (const user of [optedOut, inactive, fresh]) await mastery(user, 'rr-test-a', user === fresh ? 0 : 12);
    await mastery(noEvidence, 'rr-test-a', 12, 0);
    await prisma.user.update({ where: { id: optedOut }, data: { reviewReminders: false } });
    await prisma.user.update({ where: { id: inactive }, data: { isActive: false } });

    const sweep = await service.run(NOW, [optedOut, inactive, fresh, noEvidence]);

    expect(sweep).toMatchObject({ considered: 1, sent: 0, nothingDue: 1 });
    for (const user of [optedOut, inactive, fresh, noEvidence]) expect(await reminders(user)).toHaveLength(0);
  });

  it('leaves a learner alone whose last evidence is older than thirty days', async () => {
    const dormant = await learner();
    await mastery(dormant, 'rr-test-a', 45);

    const sweep = await service.run(NOW, [dormant]);

    expect(sweep.considered).toBe(0);
    expect(await reminders(dormant)).toHaveLength(0);
  });

  it('counts the concepts that are due and names the first two', async () => {
    const user = await learner();
    await mastery(user, 'rr-test-a', 20);
    await mastery(user, 'rr-test-b', 14);
    await mastery(user, 'rr-test-c', 10);

    await service.run(NOW, [user]);

    const [stored] = await reminders(user);
    expect(stored!.body).toContain('3 konsep mulai terlupa, antara lain');
  });

  it('keeps going when one learner fails and reports it', async () => {
    const broken = await learner();
    const fine = await learner();
    await mastery(broken, 'rr-test-a', 12);
    await mastery(fine, 'rr-test-a', 12);
    const original = review.queue.bind(review);
    const spy = jest.spyOn(review, 'queue').mockImplementation(async (userId, now) => {
      if (userId === broken) throw new Error('read failed');
      return original(userId, now);
    });

    try {
      const sweep = await service.run(NOW, [broken, fine]);
      expect(sweep).toMatchObject({ considered: 2, sent: 1, failed: 1 });
    } finally {
      spy.mockRestore();
    }
    expect(await reminders(broken)).toHaveLength(0);
    expect(await reminders(fine)).toHaveLength(1);
  });

  it('refuses a second row with the same key at the database', async () => {
    const user = await learner();
    const key = reminderKey(user, NOW);
    await prisma.notification.create({ data: { userId: user, type: 'REVIEW', title: 'a', dedupeKey: key } });

    await expect(prisma.notification.create({ data: { userId: user, type: 'REVIEW', title: 'b', dedupeKey: key } })).rejects.toMatchObject({ code: 'P2002' });
    await prisma.notification.create({ data: { userId: user, type: 'SYSTEM', title: 'c' } });
    await prisma.notification.create({ data: { userId: user, type: 'SYSTEM', title: 'd' } });
  });
});
