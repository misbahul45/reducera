import { ForbiddenException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { Pool } from 'pg';
import { AuditService } from '@/common/authz/audit.service';
import { PolicyService } from '@/common/authz/policy.service';
import { PrismaService } from '@/common/config/prisma/prisma.service';
import { AchievementsAdminService } from '@/v1/gamify/admin/achievements-admin.service';
import { AchievementEvaluator } from '@/v1/gamify/achievements/achievement-evaluator';
import { THEME_ICON_NAMES } from '@/v1/gamify/themes/theme-icons';
import { REGISTRY_SUITE_LOCK, createPool, databaseUrl, describeDb, holdSuiteLock, insertUser } from '@/test-utils/pg-fixtures';

class Rollback extends Error {}

describeDb('gamify achievements admin (requires TEST_DATABASE_URL)', () => {
  let prisma: PrismaService;
  let pool: Pool;
  let service: AchievementsAdminService;
  let releaseLock: () => Promise<void>;
  const admin = { id: 'admin-achievements', role: Role.ADMIN };
  const users: string[] = [];
  const reason = 'a goal for the second week';

  const draft = (overrides: Record<string, unknown> = {}) => ({
    code: 'streak-14',
    title: 'Dua Minggu Penuh',
    description: 'Pertahankan streak empat belas hari berturut-turut.',
    iconName: 'streak' as const,
    rule: { metric: 'STREAK_DAYS' as const, value: 14 },
    sortOrder: 85,
    reason,
    ...overrides,
  });

  const inRollback = async (work: (tx: Prisma.TransactionClient) => Promise<void>) => {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.achievement.deleteMany();
        await work(tx);
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
  };

  const evaluatorWith = (metrics: Record<string, number>) => new AchievementEvaluator({ values: async () => metrics });
  const newLearner = async () => {
    const id = await insertUser(pool);
    users.push(id);
    return id;
  };
  const audit = (tx: Prisma.TransactionClient, action: string) => tx.auditLog.findMany({ where: { action, actorId: admin.id }, orderBy: { createdAt: 'desc' } });

  beforeAll(async () => {
    releaseLock = await holdSuiteLock(REGISTRY_SUITE_LOCK);
    process.env.DATABASE_URL = databaseUrl;
    prisma = new PrismaService();
    pool = createPool();
    service = new AchievementsAdminService(prisma, new AuditService(prisma), new PolicyService());
  }, 120_000);

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.$disconnect();
    await pool.end();
    await releaseLock();
  });

  describe('create', () => {
    it('stores a typed rule, derives the type from the metric and starts active', () =>
      inRollback(async (tx) => {
        const { data } = await service.create(admin, draft(), 'trace-1', tx);

        expect(data).toMatchObject({ code: 'streak-14', title: 'Dua Minggu Penuh', iconName: 'streak', type: 'STREAK', active: true, sortOrder: 85, unlockedCount: 0 });
        const row = await tx.achievement.findUniqueOrThrow({ where: { code: 'streak-14' } });
        expect(row.rule).toEqual({ metric: 'STREAK_DAYS', op: '>=', value: 14 });
        expect(row.type).toBe('STREAK');
        const [entry] = await audit(tx, 'GAMIFY_ACHIEVEMENT_CREATED');
        expect(entry).toMatchObject({ actorRole: 'ADMIN', entityType: 'Achievement', entityId: 'streak-14', reason, traceId: 'trace-1' });
        expect(entry.after).toMatchObject({ title: 'Dua Minggu Penuh', rule: { metric: 'STREAK_DAYS', op: '>=', value: 14 }, active: true });
      }));

    it('is picked up by the evaluator, which unlocks it once the metric is reached', () =>
      inRollback(async (tx) => {
        const learner = await newLearner();
        await service.create(admin, draft(), undefined, tx);

        const early = await evaluatorWith({ STREAK_DAYS: 13 }).evaluate(learner, tx);
        const reached = await evaluatorWith({ STREAK_DAYS: 14 }).evaluate(learner, tx);
        const again = await evaluatorWith({ STREAK_DAYS: 20 }).evaluate(learner, tx);

        expect(early).toEqual([]);
        expect(reached).toEqual([{ code: 'streak-14', title: 'Dua Minggu Penuh', iconName: 'streak' }]);
        expect(again).toEqual([]);
      }));

    it('refuses a code that is taken with 409 and writes nothing', () =>
      inRollback(async (tx) => {
        await service.create(admin, draft(), undefined, tx);

        await expect(service.create(admin, draft({ title: 'Lain Lagi' }), undefined, tx)).rejects.toMatchObject({ statusCode: 409 });

        expect(await tx.achievement.count({ where: { code: 'streak-14' } })).toBe(1);
        expect(await audit(tx, 'GAMIFY_ACHIEVEMENT_CREATED')).toHaveLength(1);
      }));

    it('refuses a caller who is not an administrator', async () => {
      await expect(service.create({ id: 'u', role: Role.STUDENT }, draft())).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('list', () => {
    it('lists in display order with the number of learners who unlocked each, and the vocabulary for the form', () =>
      inRollback(async (tx) => {
        await service.create(admin, draft({ code: 'level-8', title: 'Naik ke Level 8', rule: { metric: 'LEVEL', value: 8 }, sortOrder: 120, iconName: 'level' }), undefined, tx);
        await service.create(admin, draft(), undefined, tx);
        const [one, two] = [await newLearner(), await newLearner()];
        const achievement = await tx.achievement.findUniqueOrThrow({ where: { code: 'streak-14' } });
        await tx.userAchievement.createMany({ data: [{ userId: one, achievementId: achievement.id }, { userId: two, achievementId: achievement.id }] });

        const { data } = await service.list(admin, tx);

        expect(data.achievements.map((a) => [a.code, a.unlockedCount, a.active])).toEqual([['streak-14', 2, true], ['level-8', 0, true]]);
        expect(data.metrics.map((m) => m.metric).sort()).toEqual(['ASSESSMENTS_COMPLETED', 'CONCEPTS_PASSED', 'LEVEL', 'NODES_MASTERED', 'STREAK_DAYS', 'XP_TOTAL']);
        expect(data.icons).toEqual([...THEME_ICON_NAMES]);
      }));

    it('refuses a caller who is not an administrator', async () => {
      await expect(service.list({ id: 'u', role: Role.TEACHER })).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('update', () => {
    it('changes the presentation and nothing else, and audits only what changed', () =>
      inRollback(async (tx) => {
        await service.create(admin, draft(), undefined, tx);

        const { data } = await service.update(admin, 'streak-14', { title: 'Dua Pekan Penuh', iconName: 'trophy', reason: 'wording' }, undefined, tx);

        expect(data).toMatchObject({ title: 'Dua Pekan Penuh', iconName: 'trophy', sortOrder: 85, active: true, type: 'STREAK', rule: { metric: 'STREAK_DAYS', op: '>=', value: 14 } });
        const [entry] = await audit(tx, 'GAMIFY_ACHIEVEMENT_UPDATED');
        expect(entry.before).toEqual({ title: 'Dua Minggu Penuh', iconName: 'streak' });
        expect(entry.after).toEqual({ title: 'Dua Pekan Penuh', iconName: 'trophy' });
      }));

    it('keeps the learners who already unlocked it', () =>
      inRollback(async (tx) => {
        const learner = await newLearner();
        await service.create(admin, draft(), undefined, tx);
        await evaluatorWith({ STREAK_DAYS: 14 }).evaluate(learner, tx);

        await service.update(admin, 'streak-14', { title: 'Dua Pekan Penuh', reason: 'wording' }, undefined, tx);

        expect(await tx.userAchievement.count({ where: { userId: learner } })).toBe(1);
      }));

    it('refuses an update that changes nothing with 400, an unknown code with 404', () =>
      inRollback(async (tx) => {
        await service.create(admin, draft(), undefined, tx);

        await expect(service.update(admin, 'streak-14', { title: 'Dua Minggu Penuh', reason: 'wording' }, undefined, tx)).rejects.toMatchObject({ statusCode: 400 });
        await expect(service.update(admin, 'no-such-code', { title: 'Judul Baru', reason: 'wording' }, undefined, tx)).rejects.toMatchObject({ statusCode: 404 });
      }));
  });

  describe('activate and deactivate', () => {
    it('stops the evaluator unlocking a retired achievement and keeps what was already unlocked', () =>
      inRollback(async (tx) => {
        const early = await newLearner();
        const late = await newLearner();
        await service.create(admin, draft(), undefined, tx);
        await evaluatorWith({ STREAK_DAYS: 14 }).evaluate(early, tx);

        const { data } = await service.deactivate(admin, 'streak-14', { reason: 'retired' }, undefined, tx);
        const unlocked = await evaluatorWith({ STREAK_DAYS: 14 }).evaluate(late, tx);

        expect(data.active).toBe(false);
        expect(unlocked).toEqual([]);
        expect(await tx.userAchievement.count({ where: { userId: early } })).toBe(1);
        const [entry] = await audit(tx, 'GAMIFY_ACHIEVEMENT_DEACTIVATED');
        expect(entry.before).toEqual({ active: true });
        expect(entry.after).toEqual({ active: false });
      }));

    it('brings it back with activate, and refuses a repeat of either with 409', () =>
      inRollback(async (tx) => {
        const learner = await newLearner();
        await service.create(admin, draft(), undefined, tx);
        await service.deactivate(admin, 'streak-14', { reason: 'retired' }, undefined, tx);
        await expect(service.deactivate(admin, 'streak-14', { reason: 'again' }, undefined, tx)).rejects.toMatchObject({ statusCode: 409 });

        await service.activate(admin, 'streak-14', { reason: 'back' }, undefined, tx);

        await expect(service.activate(admin, 'streak-14', { reason: 'again' }, undefined, tx)).rejects.toMatchObject({ statusCode: 409 });
        expect((await evaluatorWith({ STREAK_DAYS: 14 }).evaluate(learner, tx)).map((u) => u.code)).toEqual(['streak-14']);
        expect(await audit(tx, 'GAMIFY_ACHIEVEMENT_ACTIVATED')).toHaveLength(1);
      }));

    it('answers an unknown code with 404 and a caller who is not an administrator with 403', () =>
      inRollback(async (tx) => {
        await expect(service.deactivate(admin, 'no-such-code', { reason: 'retired' }, undefined, tx)).rejects.toMatchObject({ statusCode: 404 });
        await expect(service.activate({ id: 'u', role: Role.STUDENT }, 'streak-14', { reason: 'back' }, undefined, tx)).rejects.toBeInstanceOf(ForbiddenException);
      }));
  });
});
