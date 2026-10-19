import { ForbiddenException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { AuditService } from '@/common/authz/audit.service';
import { PolicyService } from '@/common/authz/policy.service';
import { PrismaService } from '@/common/config/prisma/prisma.service';
import { LevelsAdminService } from '@/v1/gamify/admin/levels-admin.service';
import { ladderFingerprint } from '@/v1/gamify/admin/level-ladder';
import { DEFAULT_LEVELS } from '@/v1/gamify/me/level-progress';
import { REGISTRY_SUITE_LOCK, databaseUrl, describeDb, holdSuiteLock } from '@/test-utils/pg-fixtures';

class Rollback extends Error {}

describeDb('gamify levels admin (requires TEST_DATABASE_URL)', () => {
  let prisma: PrismaService;
  let service: LevelsAdminService;
  let releaseLock: () => Promise<void>;
  const admin = { id: 'admin-levels', role: Role.ADMIN };
  const reason = 'the first levels came too slowly';
  const ladder = (xps: number[]) => xps.map((xp, index) => ({ level: index + 1, xp }));

  const inRollback = async (work: (tx: Prisma.TransactionClient) => Promise<void>) => {
    try {
      await prisma.$transaction(async (tx) => {
        await work(tx);
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
  };

  const stored = async (tx: Prisma.TransactionClient) => (await tx.levelThreshold.findMany({ orderBy: { level: 'asc' } })).map((l) => ({ level: l.level, xp: l.xp }));
  const audits = (tx: Prisma.TransactionClient) => tx.auditLog.findMany({ where: { action: 'GAMIFY_LEVELS_REPLACED', actorId: admin.id }, orderBy: { createdAt: 'desc' } });

  beforeAll(async () => {
    releaseLock = await holdSuiteLock(REGISTRY_SUITE_LOCK);
    process.env.DATABASE_URL = databaseUrl;
    prisma = new PrismaService();
    service = new LevelsAdminService(prisma, new AuditService(prisma), new PolicyService());
  }, 120_000);

  afterAll(async () => {
    await prisma.$disconnect();
    await releaseLock();
  });

  describe('list', () => {
    it('shows the built-in ladder when nothing is stored, with a fingerprint to publish against', () =>
      inRollback(async (tx) => {
        await tx.levelThreshold.deleteMany();

        const { data } = await service.list(admin, tx);

        expect(data.builtin).toBe(true);
        expect(data.levels).toEqual(DEFAULT_LEVELS);
        expect(data.fingerprint).toBe(ladderFingerprint(DEFAULT_LEVELS));
      }));

    it('shows the stored ladder in level order', () =>
      inRollback(async (tx) => {
        await tx.levelThreshold.deleteMany();
        await tx.levelThreshold.createMany({ data: [{ level: 2, xp: 120 }, { level: 1, xp: 0 }] });

        const { data } = await service.list(admin, tx);

        expect(data.builtin).toBe(false);
        expect(data.levels).toEqual([{ level: 1, xp: 0 }, { level: 2, xp: 120 }]);
      }));

    it('refuses a caller who is not an administrator', async () => {
      await expect(service.list({ id: 'u', role: Role.STUDENT })).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('replace', () => {
    it('replaces the whole ladder in one step and audits the ladder before and after', () =>
      inRollback(async (tx) => {
        await tx.levelThreshold.deleteMany();
        await tx.levelThreshold.createMany({ data: DEFAULT_LEVELS.map((l) => ({ ...l })) });
        const { data: current } = await service.list(admin, tx);

        const next = ladder([0, 50, 120, 300]);
        const { data } = await service.replace(admin, { baseFingerprint: current.fingerprint, levels: next, reason }, 'trace-9', tx);

        expect(await stored(tx)).toEqual(next);
        expect(data.levels).toEqual(next);
        const [entry] = await audits(tx);
        expect(entry).toMatchObject({ actorRole: 'ADMIN', entityType: 'LevelThreshold', entityId: 'ladder', reason, traceId: 'trace-9' });
        expect(entry.before).toEqual({ levels: DEFAULT_LEVELS });
        expect(entry.after).toEqual({ levels: next });
      }));

    it('writes the built-in ladder aside when nothing was stored, and records it as the before', () =>
      inRollback(async (tx) => {
        await tx.levelThreshold.deleteMany();
        const { data: current } = await service.list(admin, tx);

        await service.replace(admin, { baseFingerprint: current.fingerprint, levels: ladder([0, 80]), reason }, undefined, tx);

        const [entry] = await audits(tx);
        expect(entry.before).toEqual({ levels: DEFAULT_LEVELS });
        expect(await stored(tx)).toEqual(ladder([0, 80]));
      }));

    it('refuses a stale fingerprint with 409 and keeps the ladder', () =>
      inRollback(async (tx) => {
        await tx.levelThreshold.deleteMany();
        await tx.levelThreshold.createMany({ data: ladder([0, 100]) });

        await expect(service.replace(admin, { baseFingerprint: ladderFingerprint(ladder([0, 90])), levels: ladder([0, 200]), reason }, undefined, tx)).rejects.toMatchObject({ statusCode: 409 });

        expect(await stored(tx)).toEqual(ladder([0, 100]));
        expect(await audits(tx)).toHaveLength(0);
      }));

    it('refuses the ladder already stored with 400', () =>
      inRollback(async (tx) => {
        await tx.levelThreshold.deleteMany();
        await tx.levelThreshold.createMany({ data: ladder([0, 100]) });
        const { data: current } = await service.list(admin, tx);

        await expect(service.replace(admin, { baseFingerprint: current.fingerprint, levels: ladder([0, 100]), reason }, undefined, tx)).rejects.toMatchObject({ statusCode: 400 });
      }));

    it('refuses a ladder with a gap, a repeat or a first level above zero, and names why', () =>
      inRollback(async (tx) => {
        await tx.levelThreshold.deleteMany();
        const { data: current } = await service.list(admin, tx);
        const base = { baseFingerprint: current.fingerprint, reason };

        for (const levels of [ladder([10, 100]), ladder([0, 100, 100]), ladder([0, 200, 100]), [{ level: 1, xp: 0 }, { level: 3, xp: 100 }], ladder([0])]) {
          await expect(service.replace(admin, { ...base, levels }, undefined, tx)).rejects.toMatchObject({ statusCode: 400 });
        }
        expect(await stored(tx)).toEqual([]);
      }));

    it('refuses a caller who is not an administrator', async () => {
      await expect(service.replace({ id: 'u', role: Role.TEACHER }, { baseFingerprint: 'x', levels: ladder([0, 100]), reason }))
        .rejects.toBeInstanceOf(ForbiddenException);
    });

    it('keeps a learner on the level their XP now earns, because the level is read from the ladder', () =>
      inRollback(async (tx) => {
        await tx.levelThreshold.deleteMany();
        const { data: current } = await service.list(admin, tx);

        await service.replace(admin, { baseFingerprint: current.fingerprint, levels: ladder([0, 500, 900]), reason }, undefined, tx);

        const { levelProgress } = await import('@/v1/gamify/me/level-progress');
        expect(levelProgress(450, await stored(tx)).level).toBe(1);
        expect(levelProgress(450, DEFAULT_LEVELS).level).toBe(5);
      }));
  });
});
