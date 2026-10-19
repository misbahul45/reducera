import { randomUUID } from 'crypto';
import { ForbiddenException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { Pool } from 'pg';
import { AuditService } from '@/common/authz/audit.service';
import { PolicyService } from '@/common/authz/policy.service';
import { PrismaService } from '@/common/config/prisma/prisma.service';
import { RulesAdminService } from '@/v1/gamify/admin/rules-admin.service';
import { RewardEngineService } from '@/v1/gamify/rewards/reward-engine.service';
import { RewardLedgerService } from '@/v1/gamify/rewards/reward-ledger.service';
import { RewardRulesService } from '@/v1/gamify/rewards/reward-rules.service';
import { REGISTRY_SUITE_LOCK, createPool, databaseUrl, describeDb, holdSuiteLock, insertUser } from '@/test-utils/pg-fixtures';

class Rollback extends Error {}

describeDb('gamify rules admin (requires TEST_DATABASE_URL)', () => {
  let prisma: PrismaService;
  let pool: Pool;
  let service: RulesAdminService;
  let rules: RewardRulesService;
  let releaseLock: () => Promise<void>;
  let admin: { id: string; role: Role };
  const users: string[] = [];
  const concepts: string[] = [];

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

  const empty = (tx: Prisma.TransactionClient, code: string) => tx.rewardRule.deleteMany({ where: { code } });
  const rowsOf = (tx: Prisma.TransactionClient, code: string) => tx.rewardRule.findMany({ where: { code }, orderBy: { version: 'asc' } });
  const audits = (tx: Prisma.TransactionClient, action: string) => tx.auditLog.findMany({ where: { action, entityId: { in: ['CONCEPT_PASSED', 'STREAK_FREEZE_EARNED', 'PATH_NODE_MASTERED'] } }, orderBy: { createdAt: 'desc' } });
  const reason = 'tuning after the pilot';

  beforeAll(async () => {
    releaseLock = await holdSuiteLock(REGISTRY_SUITE_LOCK);
    process.env.DATABASE_URL = databaseUrl;
    prisma = new PrismaService();
    pool = createPool();
    rules = new RewardRulesService();
    service = new RulesAdminService(prisma, new AuditService(prisma), new PolicyService());
    const adminId = await insertUser(pool, 'ADMIN');
    users.push(adminId);
    admin = { id: adminId, role: Role.ADMIN };
  }, 120_000);

  afterAll(async () => {
    await prisma.leaderboardScore.deleteMany({ where: { userId: { in: users } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.concept.deleteMany({ where: { id: { in: concepts } } });
    await prisma.$disconnect();
    await pool.end();
    await releaseLock();
  });

  describe('list', () => {
    it('shows every rule of the catalog, with the built-in default in force when nothing is stored', () =>
      inRollback(async (tx) => {
        await tx.rewardRule.deleteMany();

        const { data } = await service.list(admin, tx);

        expect(data.map((r) => r.code)).toEqual(['MASTERY_PROGRESS', 'CONCEPT_PASSED', 'STREAK_BONUS_7', 'PATH_NODE_MASTERED', 'STREAK_FREEZE_EARNED']);
        expect(data.every((r) => r.inForce?.builtin === true && r.inForce.version === 1)).toBe(true);
        expect(data.find((r) => r.code === 'STREAK_FREEZE_EARNED')?.inForce?.values).toEqual({ every: 7, maxHeld: 2 });
      }));

    it('refuses a caller who is not an administrator', async () => {
      await expect(service.list({ id: 'u', role: Role.STUDENT })).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.list({ id: 'u', role: Role.TEACHER })).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('publish', () => {
    it('writes the default as a retired version 1 and the new values as version 2, which the engine then reads', () =>
      inRollback(async (tx) => {
        await empty(tx, 'CONCEPT_PASSED');

        const { data } = await service.publish(admin, 'CONCEPT_PASSED', { baseVersion: 1, values: { points: 80 }, reason }, undefined, tx);

        expect(data.inForce).toEqual({ version: 2, builtin: false, values: { points: 80 } });
        expect((await rowsOf(tx, 'CONCEPT_PASSED')).map((r) => [r.version, r.amount, r.active, r.rewardKind, r.eventType, r.dailyCap])).toEqual([
          [1, 50, false, 'XP', 'ASSESSMENT_COMPLETED', null],
          [2, 80, true, 'XP', 'ASSESSMENT_COMPLETED', null],
        ]);
        expect((await rules.current(tx)).conceptPassed).toEqual({ version: 2, points: 80 });
      }));

    it('keeps exactly one version active through a series of publishes', () =>
      inRollback(async (tx) => {
        await empty(tx, 'STREAK_FREEZE_EARNED');

        await service.publish(admin, 'STREAK_FREEZE_EARNED', { baseVersion: 1, values: { every: 5, maxHeld: 3 }, reason }, undefined, tx);
        await service.publish(admin, 'STREAK_FREEZE_EARNED', { baseVersion: 2, values: { every: 10, maxHeld: 1 }, reason }, undefined, tx);

        const rows = await rowsOf(tx, 'STREAK_FREEZE_EARNED');
        expect(rows.map((r) => [r.version, r.active])).toEqual([[1, false], [2, false], [3, true]]);
        expect(rows[2]).toMatchObject({ amount: 10, params: { maxHeld: 1 } });
        expect((await rules.current(tx)).streakFreeze).toEqual({ version: 3, every: 10, maxHeld: 1 });
      }));

    it('changes nothing in a version once written except whether it is active', () =>
      inRollback(async (tx) => {
        await empty(tx, 'CONCEPT_PASSED');
        await service.publish(admin, 'CONCEPT_PASSED', { baseVersion: 1, values: { points: 80 }, reason }, undefined, tx);
        const second = (await rowsOf(tx, 'CONCEPT_PASSED'))[1];

        await service.publish(admin, 'CONCEPT_PASSED', { baseVersion: 2, values: { points: 90 }, reason }, undefined, tx);

        const again = (await rowsOf(tx, 'CONCEPT_PASSED'))[1];
        expect({ ...again, active: true }).toEqual(second);
        expect(again.active).toBe(false);
      }));

    it('writes an audit entry with the version in force before and after, the actor and the reason', () =>
      inRollback(async (tx) => {
        await empty(tx, 'CONCEPT_PASSED');

        await service.publish(admin, 'CONCEPT_PASSED', { baseVersion: 1, values: { points: 80 }, reason }, 'trace-1', tx);

        const [entry] = await audits(tx, 'GAMIFY_RULE_PUBLISHED');
        expect(entry).toMatchObject({ actorId: admin.id, actorRole: 'ADMIN', entityType: 'RewardRule', entityId: 'CONCEPT_PASSED', reason, traceId: 'trace-1' });
        expect(entry.before).toEqual({ inForce: { version: 1, builtin: true, values: { points: 50 } } });
        expect(entry.after).toEqual({ inForce: { version: 2, builtin: false, values: { points: 80 } } });
      }));

    it('refuses a stale base version with 409 and writes nothing', () =>
      inRollback(async (tx) => {
        await empty(tx, 'CONCEPT_PASSED');
        await service.publish(admin, 'CONCEPT_PASSED', { baseVersion: 1, values: { points: 80 }, reason }, undefined, tx);
        const before = await audits(tx, 'GAMIFY_RULE_PUBLISHED');

        await expect(service.publish(admin, 'CONCEPT_PASSED', { baseVersion: 1, values: { points: 90 }, reason }, undefined, tx)).rejects.toMatchObject({ statusCode: 409 });

        expect((await rowsOf(tx, 'CONCEPT_PASSED')).map((r) => r.version)).toEqual([1, 2]);
        expect(await audits(tx, 'GAMIFY_RULE_PUBLISHED')).toHaveLength(before.length);
      }));

    it('refuses the values already in force with 400', () =>
      inRollback(async (tx) => {
        await empty(tx, 'CONCEPT_PASSED');

        await expect(service.publish(admin, 'CONCEPT_PASSED', { baseVersion: 1, values: { points: 50 }, reason }, undefined, tx)).rejects.toMatchObject({ statusCode: 400 });
        expect(await rowsOf(tx, 'CONCEPT_PASSED')).toEqual([]);
      }));

    it('refuses an unknown code with 404 and a caller who is not an administrator', () =>
      inRollback(async (tx) => {
        await expect(service.publish(admin, 'NOT_A_RULE', { baseVersion: 1, values: { points: 1 }, reason }, undefined, tx)).rejects.toMatchObject({ statusCode: 404 });
        await expect(service.publish({ id: 'u', role: Role.STUDENT }, 'CONCEPT_PASSED', { baseVersion: 1, values: { points: 80 }, reason }, undefined, tx)).rejects.toBeInstanceOf(ForbiddenException);
      }));

    it('refuses values outside the bounds of the catalog', () =>
      inRollback(async (tx) => {
        await empty(tx, 'CONCEPT_PASSED');

        await expect(service.publish(admin, 'CONCEPT_PASSED', { baseVersion: 1, values: { points: 100000 }, reason }, undefined, tx)).rejects.toMatchObject({ statusCode: 400 });
        await expect(service.publish(admin, 'CONCEPT_PASSED', { baseVersion: 1, values: { points: 80, extra: 1 }, reason }, undefined, tx)).rejects.toMatchObject({ statusCode: 400 });
      }));
  });

  describe('activate and deactivate', () => {
    it('puts an older version back in force, which is a rollback, and audits it', () =>
      inRollback(async (tx) => {
        await empty(tx, 'CONCEPT_PASSED');
        await service.publish(admin, 'CONCEPT_PASSED', { baseVersion: 1, values: { points: 80 }, reason }, undefined, tx);
        await service.publish(admin, 'CONCEPT_PASSED', { baseVersion: 2, values: { points: 90 }, reason }, undefined, tx);

        const { data } = await service.activate(admin, 'CONCEPT_PASSED', 2, { reason }, undefined, tx);

        expect(data.inForce).toMatchObject({ version: 2, values: { points: 80 } });
        expect((await rowsOf(tx, 'CONCEPT_PASSED')).map((r) => [r.version, r.active])).toEqual([[1, false], [2, true], [3, false]]);
        expect((await rules.current(tx)).conceptPassed).toEqual({ version: 2, points: 80 });
        const [entry] = await audits(tx, 'GAMIFY_RULE_ACTIVATED');
        expect(entry.before).toEqual({ inForce: { version: 3, builtin: false, values: { points: 90 } } });
        expect(entry.after).toEqual({ inForce: { version: 2, builtin: false, values: { points: 80 } } });
      }));

    it('refuses the version already in force with 409 and a missing version with 404', () =>
      inRollback(async (tx) => {
        await empty(tx, 'CONCEPT_PASSED');
        await service.publish(admin, 'CONCEPT_PASSED', { baseVersion: 1, values: { points: 80 }, reason }, undefined, tx);

        await expect(service.activate(admin, 'CONCEPT_PASSED', 2, { reason }, undefined, tx)).rejects.toMatchObject({ statusCode: 409 });
        await expect(service.activate(admin, 'CONCEPT_PASSED', 9, { reason }, undefined, tx)).rejects.toMatchObject({ statusCode: 404 });
      }));

    it('turns a rule off, so the engine pays nothing and does not fall back to the default, and audits it', () =>
      inRollback(async (tx) => {
        await empty(tx, 'CONCEPT_PASSED');

        const { data } = await service.deactivate(admin, 'CONCEPT_PASSED', { reason }, undefined, tx);

        expect(data.inForce).toBeNull();
        expect((await rowsOf(tx, 'CONCEPT_PASSED')).map((r) => [r.version, r.active])).toEqual([[1, false]]);
        expect((await rules.current(tx)).conceptPassed).toBeNull();
        const [entry] = await audits(tx, 'GAMIFY_RULE_DEACTIVATED');
        expect(entry.before).toEqual({ inForce: { version: 1, builtin: true, values: { points: 50 } } });
        expect(entry.after).toEqual({ inForce: null });
        await expect(service.deactivate(admin, 'CONCEPT_PASSED', { reason }, undefined, tx)).rejects.toMatchObject({ statusCode: 409 });
      }));

    it('takes a rule that is off back to work by publishing a new version', () =>
      inRollback(async (tx) => {
        await empty(tx, 'CONCEPT_PASSED');
        await service.deactivate(admin, 'CONCEPT_PASSED', { reason }, undefined, tx);

        await service.publish(admin, 'CONCEPT_PASSED', { baseVersion: 1, values: { points: 50 }, reason }, undefined, tx);

        expect((await rules.current(tx)).conceptPassed).toEqual({ version: 2, points: 50 });
      }));
  });

  describe('what a learner is paid after a new version', () => {
    const newConcept = async () => {
      const concept = await prisma.concept.create({ data: { id: `ra-${randomUUID()}`, title: 'Rules admin fixture', level: 1, sortOrder: 1 } });
      concepts.push(concept.id);
      return concept.id;
    };
    const newLearner = async () => {
      const id = await insertUser(pool);
      users.push(id);
      return id;
    };
    const passed = { score: 0.9, evidenceCount: 5 };

    it('pays the next pass under version 2 and ledger entries of version 1 stay as they were', () =>
      inRollback(async (tx) => {
        await empty(tx, 'CONCEPT_PASSED');
        await empty(tx, 'MASTERY_PROGRESS');
        const engine = new RewardEngineService(new RewardLedgerService(prisma, new AuditService(prisma)), rules);
        const learner = await newLearner();
        const first = await newConcept();
        const second = await newConcept();
        await engine.onAssessment({ userId: learner, conceptId: first, eventId: `e-${randomUUID()}`, duplicate: false, after: passed }, tx);

        await service.publish(admin, 'CONCEPT_PASSED', { baseVersion: 1, values: { points: 80 }, reason }, undefined, tx);
        await engine.onAssessment({ userId: learner, conceptId: second, eventId: `e-${randomUUID()}`, duplicate: false, after: passed }, tx);

        const entries = await tx.gamificationLedger.findMany({ where: { userId: learner, ruleId: 'CONCEPT_PASSED' }, orderBy: { createdAt: 'asc' } });
        expect(entries.map((e) => [e.conceptId, e.ruleVersion, e.points])).toEqual([[first, 1, 50], [second, 2, 80]]);
      }));

    it('does not pay a concept again that version 1 already paid', () =>
      inRollback(async (tx) => {
        await empty(tx, 'CONCEPT_PASSED');
        await empty(tx, 'MASTERY_PROGRESS');
        const engine = new RewardEngineService(new RewardLedgerService(prisma, new AuditService(prisma)), rules);
        const learner = await newLearner();
        const concept = await newConcept();
        await engine.onAssessment({ userId: learner, conceptId: concept, eventId: `e-${randomUUID()}`, duplicate: false, after: passed }, tx);

        await service.publish(admin, 'CONCEPT_PASSED', { baseVersion: 1, values: { points: 80 }, reason }, undefined, tx);
        await engine.onAssessment({ userId: learner, conceptId: concept, eventId: `e-${randomUUID()}`, duplicate: false, after: passed }, tx);

        const entries = await tx.gamificationLedger.findMany({ where: { userId: learner, ruleId: 'CONCEPT_PASSED' } });
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({ ruleVersion: 1, points: 50 });
      }));

    it('pays nothing for the pass once the rule is off', () =>
      inRollback(async (tx) => {
        await empty(tx, 'CONCEPT_PASSED');
        await empty(tx, 'MASTERY_PROGRESS');
        const engine = new RewardEngineService(new RewardLedgerService(prisma, new AuditService(prisma)), rules);
        const learner = await newLearner();
        const concept = await newConcept();
        await service.deactivate(admin, 'CONCEPT_PASSED', { reason }, undefined, tx);

        await engine.onAssessment({ userId: learner, conceptId: concept, eventId: `e-${randomUUID()}`, duplicate: false, after: passed }, tx);

        expect(await tx.gamificationLedger.count({ where: { userId: learner, ruleId: 'CONCEPT_PASSED' } })).toBe(0);
      }));
  });

  describe('two administrators at once', () => {
    it('creates one version when two publish from the same base, and the other is told to reload', async () => {
      const code = 'PATH_NODE_MASTERED';
      const snapshot = await prisma.rewardRule.findMany({ where: { code } });
      await prisma.rewardRule.deleteMany({ where: { code } });
      try {
        const attempts = await Promise.allSettled([
          service.publish(admin, code, { baseVersion: 1, values: { stars: 2 }, reason }),
          service.publish(admin, code, { baseVersion: 1, values: { stars: 3 }, reason }),
        ]);

        expect(attempts.filter((a) => a.status === 'fulfilled')).toHaveLength(1);
        const failed = attempts.find((a) => a.status === 'rejected') as PromiseRejectedResult;
        expect(failed.reason).toMatchObject({ statusCode: 409 });
        const rows = await prisma.rewardRule.findMany({ where: { code }, orderBy: { version: 'asc' } });
        expect(rows.map((r) => [r.version, r.active])).toEqual([[1, false], [2, true]]);
      } finally {
        await prisma.rewardRule.deleteMany({ where: { code } });
        if (snapshot.length > 0) {
          await prisma.rewardRule.createMany({
            data: snapshot.map((row) => ({ ...row, params: row.params ?? Prisma.JsonNull })),
          });
        }
      }
    });
  });
});
