import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { ADMIN_A, STUDENT_A, STUDENT_B, TEACHER_A, asUser, createHttpApp } from '@/test-utils/http-harness';
import { UserThemeController } from '../user-theme.controller';
import { UserThemeService } from '../user-theme.service';

const choice = { mood: ['calm', 'playful'], intensity: 60 };
const view = { message: 'ok', data: { custom: false, mood: [], intensity: null, theme: null } };

type Method = 'get' | 'put' | 'post' | 'delete';

describe('UserThemeController', () => {
  let app: INestApplication;
  let service: Record<'get' | 'preview' | 'save' | 'reset', jest.Mock>;

  beforeEach(async () => {
    service = {
      get: jest.fn().mockResolvedValue(view),
      preview: jest.fn().mockResolvedValue(view),
      save: jest.fn().mockResolvedValue(view),
      reset: jest.fn().mockResolvedValue(view),
    };
    app = await createHttpApp({ controllers: [UserThemeController], providers: [{ provide: UserThemeService, useValue: service }] });
  });

  afterEach(async () => {
    await app.close();
  });

  const routes: Array<[string, Method, string, object | undefined, () => jest.Mock]> = [
    ['read the own theme', 'get', '/me/theme', undefined, () => service.get],
    ['save the own theme', 'put', '/me/theme', choice, () => service.save],
    ['preview a choice', 'post', '/me/theme/preview', choice, () => service.preview],
    ['reset the own theme', 'delete', '/me/theme', undefined, () => service.reset],
  ];

  describe.each(routes)('%s', (_name, method, path, body, target) => {
    it('rejects a caller without a session', async () => {
      await request(app.getHttpServer())[method](path).send(body).expect(401);
      expect(target()).not.toHaveBeenCalled();
    });

    it.each([
      ['a learner', STUDENT_A],
      ['a teacher', TEACHER_A],
      ['an administrator', ADMIN_A],
    ])('lets %s through', async (_label, user) => {
      await request(app.getHttpServer())[method](path).set(asUser(user)).send(body).expect(200);
      expect(target()).toHaveBeenCalledTimes(1);
    });
  });

  describe('identity', () => {
    it('uses the id of the session for reads, saves and resets, never one from the request', async () => {
      const call = () => request(app.getHttpServer());
      await call().get('/me/theme').set(asUser(STUDENT_A)).expect(200);
      await call().put('/me/theme').set(asUser(STUDENT_B)).send(choice).expect(200);
      await call().delete('/me/theme').set(asUser(STUDENT_A)).expect(200);

      expect(service.get).toHaveBeenCalledWith(STUDENT_A.id);
      expect(service.save).toHaveBeenCalledWith(STUDENT_B.id, choice);
      expect(service.reset).toHaveBeenCalledWith(STUDENT_A.id);
    });

    it('refuses a body that carries a user id', async () => {
      await request(app.getHttpServer()).put('/me/theme').set(asUser(STUDENT_A)).send({ ...choice, userId: 'someone-else' }).expect(400);
      expect(service.save).not.toHaveBeenCalled();
    });
  });

  describe('input rules', () => {
    const invalid: Array<[string, object]> = [
      ['no mood', { mood: [], intensity: 50 }],
      ['four moods', { mood: ['calm', 'playful', 'serious', 'natural'], intensity: 50 }],
      ['a repeated mood', { mood: ['calm', 'calm'], intensity: 50 }],
      ['an unknown mood', { mood: ['sleepy'], intensity: 50 }],
      ['an intensity above 100', { mood: ['calm'], intensity: 101 }],
      ['a negative intensity', { mood: ['calm'], intensity: -1 }],
      ['an intensity that is not whole', { mood: ['calm'], intensity: 50.5 }],
      ['a missing intensity', { mood: ['calm'] }],
      ['an extra field', { mood: ['calm'], intensity: 50, extra: true }],
    ];

    it.each(invalid)('refuses %s on save and on preview', async (_label, body) => {
      await request(app.getHttpServer()).put('/me/theme').set(asUser(STUDENT_A)).send(body).expect(400);
      await request(app.getHttpServer()).post('/me/theme/preview').set(asUser(STUDENT_A)).send(body).expect(400);

      expect(service.save).not.toHaveBeenCalled();
      expect(service.preview).not.toHaveBeenCalled();
    });

    it('passes a valid choice to the service as it was sent', async () => {
      await request(app.getHttpServer()).post('/me/theme/preview').set(asUser(STUDENT_A)).send(choice).expect(200);

      expect(service.preview).toHaveBeenCalledWith(choice);
    });
  });
});
