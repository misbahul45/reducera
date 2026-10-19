import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { ADMIN_A, STUDENT_A, TEACHER_A, asUser, createHttpApp } from '@/test-utils/http-harness';
import { AchievementsAdminService } from '../achievements-admin.service';
import { GamifyAdminController } from '../gamify-admin.controller';
import { LevelsAdminService } from '../levels-admin.service';
import { RulesAdminService } from '../rules-admin.service';

const reason = 'tuning after the pilot';
const ok = () => jest.fn().mockResolvedValue({ message: 'ok', data: {} });

const achievement = {
  code: 'streak-14',
  title: 'Dua Minggu Penuh',
  description: 'Pertahankan streak empat belas hari berturut-turut.',
  iconName: 'streak',
  rule: { metric: 'STREAK_DAYS', value: 14 },
  sortOrder: 85,
  reason,
};

type Method = 'get' | 'post' | 'patch';

describe('GamifyAdminController', () => {
  let app: INestApplication;
  let rules: Record<'list' | 'publish' | 'activate' | 'deactivate', jest.Mock>;
  let levels: Record<'list' | 'replace', jest.Mock>;
  let achievements: Record<'list' | 'create' | 'update' | 'activate' | 'deactivate', jest.Mock>;

  beforeEach(async () => {
    rules = { list: ok(), publish: ok(), activate: ok(), deactivate: ok() };
    levels = { list: ok(), replace: ok() };
    achievements = { list: ok(), create: ok(), update: ok(), activate: ok(), deactivate: ok() };
    app = await createHttpApp({
      controllers: [GamifyAdminController],
      providers: [
        { provide: RulesAdminService, useValue: rules },
        { provide: LevelsAdminService, useValue: levels },
        { provide: AchievementsAdminService, useValue: achievements },
      ],
    });
  });

  afterEach(async () => {
    await app.close();
  });

  const routes: Array<[string, Method, string, object | undefined, () => jest.Mock, number]> = [
    ['list rules', 'get', '/admin/gamify/rules', undefined, () => rules.list, 200],
    ['publish a rule version', 'post', '/admin/gamify/rules/CONCEPT_PASSED/versions', { baseVersion: 1, values: { points: 80 }, reason }, () => rules.publish, 201],
    ['activate a rule version', 'post', '/admin/gamify/rules/CONCEPT_PASSED/versions/2/activate', { reason }, () => rules.activate, 200],
    ['deactivate a rule', 'post', '/admin/gamify/rules/CONCEPT_PASSED/deactivate', { reason }, () => rules.deactivate, 200],
    ['list levels', 'get', '/admin/gamify/levels', undefined, () => levels.list, 200],
    ['replace levels', 'post', '/admin/gamify/levels/replace', { baseFingerprint: 'abc', levels: [{ level: 1, xp: 0 }, { level: 2, xp: 100 }], reason }, () => levels.replace, 200],
    ['list achievements', 'get', '/admin/gamify/achievements', undefined, () => achievements.list, 200],
    ['create an achievement', 'post', '/admin/gamify/achievements', achievement, () => achievements.create, 201],
    ['update an achievement', 'patch', '/admin/gamify/achievements/streak-14', { title: 'Dua Pekan Penuh', reason }, () => achievements.update, 200],
    ['activate an achievement', 'post', '/admin/gamify/achievements/streak-14/activate', { reason }, () => achievements.activate, 200],
    ['deactivate an achievement', 'post', '/admin/gamify/achievements/streak-14/deactivate', { reason }, () => achievements.deactivate, 200],
  ];

  describe.each(routes)('%s', (_name, method, path, body, target, status) => {
    it('rejects an unauthenticated caller', async () => {
      await request(app.getHttpServer())[method](path).send(body).expect(401);
      expect(target()).not.toHaveBeenCalled();
    });

    it.each([
      ['a learner', STUDENT_A],
      ['a teacher', TEACHER_A],
    ])('rejects %s', async (_label, user) => {
      await request(app.getHttpServer())[method](path).set(asUser(user)).send(body).expect(403);
      expect(target()).not.toHaveBeenCalled();
    });

    it('lets an administrator through and passes the acting administrator', async () => {
      await request(app.getHttpServer())[method](path).set(asUser(ADMIN_A)).send(body).expect(status);
      expect(target()).toHaveBeenCalledTimes(1);
      expect(target().mock.calls[0][0]).toMatchObject({ id: ADMIN_A.id, role: 'ADMIN' });
    });
  });

  describe('what reaches the services', () => {
    const admin = () => request(app.getHttpServer());

    it('passes the rule code, the base version, the values and the reason of a publication', async () => {
      await admin().post('/admin/gamify/rules/STREAK_FREEZE_EARNED/versions').set(asUser(ADMIN_A)).send({ baseVersion: 1, values: { every: 5, maxHeld: 3 }, reason }).expect(201);

      const [, code, dto] = rules.publish.mock.calls[0];
      expect(code).toBe('STREAK_FREEZE_EARNED');
      expect(dto).toEqual({ baseVersion: 1, values: { every: 5, maxHeld: 3 }, reason });
    });

    it('passes the version of an activation as a number', async () => {
      await admin().post('/admin/gamify/rules/CONCEPT_PASSED/versions/3/activate').set(asUser(ADMIN_A)).send({ reason }).expect(200);

      expect(rules.activate.mock.calls[0].slice(1, 4)).toEqual(['CONCEPT_PASSED', 3, { reason }]);
    });

    it('passes a creation as the DTO says and never an identity from the body', async () => {
      await admin().post('/admin/gamify/achievements').set(asUser(ADMIN_A)).send(achievement).expect(201);

      expect(achievements.create.mock.calls[0][1]).toEqual(achievement);
    });
  });

  describe('input rules', () => {
    const admin = () => request(app.getHttpServer());

    it('refuses a field the body must not carry on every write', async () => {
      const extra = { extra: true };
      await admin().post('/admin/gamify/rules/CONCEPT_PASSED/versions').set(asUser(ADMIN_A)).send({ baseVersion: 1, values: { points: 80 }, reason, ...extra }).expect(400);
      await admin().post('/admin/gamify/rules/CONCEPT_PASSED/versions/2/activate').set(asUser(ADMIN_A)).send({ reason, ...extra }).expect(400);
      await admin().post('/admin/gamify/rules/CONCEPT_PASSED/deactivate').set(asUser(ADMIN_A)).send({ reason, ...extra }).expect(400);
      await admin().post('/admin/gamify/levels/replace').set(asUser(ADMIN_A)).send({ baseFingerprint: 'abc', levels: [{ level: 1, xp: 0 }, { level: 2, xp: 100 }], reason, ...extra }).expect(400);
      await admin().post('/admin/gamify/achievements').set(asUser(ADMIN_A)).send({ ...achievement, ...extra }).expect(400);
      await admin().patch('/admin/gamify/achievements/streak-14').set(asUser(ADMIN_A)).send({ title: 'Dua Pekan Penuh', reason, ...extra }).expect(400);
      await admin().post('/admin/gamify/achievements/streak-14/activate').set(asUser(ADMIN_A)).send({ reason, ...extra }).expect(400);

      for (const mock of [rules.publish, rules.activate, rules.deactivate, levels.replace, achievements.create, achievements.update, achievements.activate]) {
        expect(mock).not.toHaveBeenCalled();
      }
    });

    it('refuses a reason that is missing or too short, because every change is explained', async () => {
      await admin().post('/admin/gamify/rules/CONCEPT_PASSED/deactivate').set(asUser(ADMIN_A)).send({}).expect(400);
      await admin().post('/admin/gamify/rules/CONCEPT_PASSED/deactivate').set(asUser(ADMIN_A)).send({ reason: 'no' }).expect(400);

      expect(rules.deactivate).not.toHaveBeenCalled();
    });

    it('refuses a publication whose values are not numbers or whose base version is not a positive whole number', async () => {
      const publish = (body: object) => admin().post('/admin/gamify/rules/CONCEPT_PASSED/versions').set(asUser(ADMIN_A)).send(body);

      await publish({ baseVersion: 1, values: { points: '80' }, reason }).expect(400);
      await publish({ baseVersion: 1, values: { points: null }, reason }).expect(400);
      await publish({ baseVersion: 0, values: { points: 80 }, reason }).expect(400);
      await publish({ baseVersion: 1.5, values: { points: 80 }, reason }).expect(400);
      await publish({ values: { points: 80 }, reason }).expect(400);
      await publish({ baseVersion: 1, reason }).expect(400);

      expect(rules.publish).not.toHaveBeenCalled();
    });

    it('refuses a version in the path that is not a positive whole number', async () => {
      for (const version of ['0', '-1', '1.5', 'abc']) {
        await admin().post(`/admin/gamify/rules/CONCEPT_PASSED/versions/${version}/activate`).set(asUser(ADMIN_A)).send({ reason }).expect(400);
      }

      expect(rules.activate).not.toHaveBeenCalled();
    });

    it('refuses a ladder that is not a list of whole-number levels and XP', async () => {
      const replace = (levels: unknown) => admin().post('/admin/gamify/levels/replace').set(asUser(ADMIN_A)).send({ baseFingerprint: 'abc', levels, reason });

      await replace('nope').expect(400);
      await replace([{ level: 1, xp: '0' }]).expect(400);
      await replace([{ level: 1, xp: 0.5 }]).expect(400);
      await replace([{ level: 1, xp: 0, name: 'x' }]).expect(400);
      await replace(Array.from({ length: 101 }, (_, i) => ({ level: i + 1, xp: i * 10 }))).expect(400);

      expect(levels.replace).not.toHaveBeenCalled();
    });

    it('refuses to change the rule, the code, the type or the state of an achievement through an update', async () => {
      for (const patch of [{ rule: { metric: 'LEVEL', value: 3 } }, { code: 'other-code' }, { type: 'QUIZ' }, { active: false }]) {
        await admin().patch('/admin/gamify/achievements/streak-14').set(asUser(ADMIN_A)).send({ title: 'Dua Pekan Penuh', reason, ...patch }).expect(400);
      }
      await admin().patch('/admin/gamify/achievements/streak-14').set(asUser(ADMIN_A)).send({ reason }).expect(400);

      expect(achievements.update).not.toHaveBeenCalled();
    });

    it('refuses an achievement with an icon outside the vocabulary, a metric the evaluator does not know or a target beyond the metric', async () => {
      const create = (patch: object) => admin().post('/admin/gamify/achievements').set(asUser(ADMIN_A)).send({ ...achievement, ...patch });

      await create({ iconName: 'rocket' }).expect(400);
      await create({ rule: { metric: 'LOGINS', value: 3 } }).expect(400);
      await create({ rule: { metric: 'LEVEL', value: 99 } }).expect(400);

      expect(achievements.create).not.toHaveBeenCalled();
    });
  });
});
