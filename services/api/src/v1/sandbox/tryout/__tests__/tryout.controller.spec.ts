import { HttpException, HttpStatus, INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppError, AppErrorCode } from '@/common/lib/error';
import { STUDENT_A, asUser, createHttpApp } from '@/test-utils/http-harness';
import { RateLimitService } from '@/v1/common/rate-limit/rate-limit.service';
import { TryoutController } from '../tryout.controller';
import { TryoutService } from '../tryout.service';

const ID = '5f0e6a64-7a8c-4d5e-9b1d-3f2a8c6b9d10';

describe('TryoutController', () => {
  let app: INestApplication;
  let service: Record<'catalog' | 'history' | 'start' | 'view' | 'saveAnswers' | 'submit' | 'result', jest.Mock>;
  let rateLimit: { consume: jest.Mock };

  beforeEach(async () => {
    service = {
      catalog: jest.fn().mockResolvedValue({ subtests: [] }),
      history: jest.fn().mockResolvedValue({ items: [], page: { total: 0, limit: 10, nextCursor: null } }),
      start: jest.fn().mockResolvedValue({ id: ID }),
      view: jest.fn().mockResolvedValue({ id: ID }),
      saveAnswers: jest.fn().mockResolvedValue({ saved: 1 }),
      submit: jest.fn().mockResolvedValue({ id: ID }),
      result: jest.fn().mockResolvedValue({ id: ID }),
    };
    rateLimit = { consume: jest.fn().mockResolvedValue({ allowed: true, remaining: 5 }) };
    app = await createHttpApp({
      controllers: [TryoutController],
      providers: [
        { provide: TryoutService, useValue: service },
        { provide: RateLimitService, useValue: rateLimit },
      ],
    });
  });

  afterEach(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const plan = { examKey: 'utbk-snbt', subtests: [{ key: 'ppu', count: 5 }] };

  it('requires a signed-in learner on every route', async () => {
    await http().get('/sandbox/tryout').expect(401);
    await http().post('/sandbox/tryout').send(plan).expect(401);
    await http().get(`/sandbox/tryout/${ID}`).expect(401);
    await http().put(`/sandbox/tryout/${ID}/answers`).send({ answers: { q1: 1 } }).expect(401);
    await http().post(`/sandbox/tryout/${ID}/submit`).send({}).expect(401);
    await http().get(`/sandbox/tryout/${ID}/result`).expect(401);
    expect(service.start).not.toHaveBeenCalled();
  });

  it('always acts as the caller', async () => {
    await http().get('/sandbox/tryout').set(asUser(STUDENT_A)).expect(200);
    expect(service.catalog).toHaveBeenCalledWith(STUDENT_A.id);

    await http().post('/sandbox/tryout').set(asUser(STUDENT_A)).send(plan).expect(201);
    expect(service.start).toHaveBeenCalledWith(STUDENT_A.id, plan);

    await http().get(`/sandbox/tryout/${ID}`).set(asUser(STUDENT_A)).expect(200);
    expect(service.view).toHaveBeenCalledWith(STUDENT_A.id, ID);

    await http().put(`/sandbox/tryout/${ID}/answers`).set(asUser(STUDENT_A)).send({ answers: { q1: 2, q2: null } }).expect(200);
    expect(service.saveAnswers).toHaveBeenCalledWith(STUDENT_A.id, ID, { answers: { q1: 2, q2: null } });

    await http().post(`/sandbox/tryout/${ID}/submit`).set(asUser(STUDENT_A)).send({ answers: { q1: 0 } }).expect(200);
    expect(service.submit).toHaveBeenCalledWith(STUDENT_A.id, ID, { answers: { q1: 0 } });

    await http().get(`/sandbox/tryout/${ID}/result`).set(asUser(STUDENT_A)).expect(200);
    expect(service.result).toHaveBeenCalledWith(STUDENT_A.id, ID);
  });

  it('serves the history before it reads a session id, for the caller only', async () => {
    await http().get('/sandbox/tryout/history').expect(401);
    await http().get('/sandbox/tryout/history?band=CUKUP&subtest=ppu&sort=HIGHEST&limit=5&cursor=10').set(asUser(STUDENT_A)).expect(200);
    expect(service.history).toHaveBeenCalledWith(STUDENT_A.id, { band: 'CUKUP', subtest: 'ppu', sort: 'HIGHEST', limit: 5, cursor: 10 });
    expect(service.view).not.toHaveBeenCalled();

    await http().get('/sandbox/tryout/history').set(asUser(STUDENT_A)).expect(200);
    expect(service.history).toHaveBeenLastCalledWith(STUDENT_A.id, { sort: 'NEWEST' });
  });

  it('rejects a history filter it does not understand', async () => {
    const history = (query: string) => http().get(`/sandbox/tryout/history${query}`).set(asUser(STUDENT_A));
    await history('?band=EXCELLENT').expect(400);
    await history('?subtest=matematika').expect(400);
    await history('?sort=RANDOM').expect(400);
    await history('?limit=0').expect(400);
    await history('?limit=51').expect(400);
    await history('?cursor=-1').expect(400);
    await history('?userId=someone-else').expect(400);
    expect(service.history).not.toHaveBeenCalled();
  });

  it('accepts a submission without a body of answers', async () => {
    await http().post(`/sandbox/tryout/${ID}/submit`).set(asUser(STUDENT_A)).send({}).expect(200);
    expect(service.submit).toHaveBeenCalledWith(STUDENT_A.id, ID, {});
  });

  it('rejects a plan it does not understand', async () => {
    const start = (body: unknown) => http().post('/sandbox/tryout').set(asUser(STUDENT_A)).send(body as object);
    await start({}).expect(400);
    await start({ ...plan, examKey: 'toefl' }).expect(400);
    await start({ examKey: 'utbk-snbt', subtests: [] }).expect(400);
    await start({ examKey: 'utbk-snbt', subtests: [{ key: 'matematika', count: 5 }] }).expect(400);
    await start({ examKey: 'utbk-snbt', subtests: [{ key: 'ppu', count: 0 }] }).expect(400);
    await start({ examKey: 'utbk-snbt', subtests: [{ key: 'ppu', count: 161 }] }).expect(400);
    await start({ examKey: 'utbk-snbt', subtests: [{ key: 'ppu', count: 2.5 }] }).expect(400);
    await start({ examKey: 'utbk-snbt', subtests: [{ key: 'ppu', count: '5' }] }).expect(400);
    await start({ examKey: 'utbk-snbt', subtests: [{ key: 'ppu', count: 5, answer: 1 }] }).expect(400);
    await start({ ...plan, seed: 1 }).expect(400);
    await start({ examKey: 'utbk-snbt', subtests: Array.from({ length: 8 }, () => ({ key: 'ppu', count: 1 })) }).expect(400);
    expect(service.start).not.toHaveBeenCalled();
  });

  it('rejects answers that are not whole option numbers for known question ids', async () => {
    const save = (body: unknown) => http().put(`/sandbox/tryout/${ID}/answers`).set(asUser(STUDENT_A)).send(body as object);
    await save({}).expect(400);
    await save({ answers: { q1: 5 } }).expect(400);
    await save({ answers: { q1: -1 } }).expect(400);
    await save({ answers: { q1: 1.5 } }).expect(400);
    await save({ answers: { q1: 'A' } }).expect(400);
    await save({ answers: { question1: 1 } }).expect(400);
    await save({ answers: { q1: 1 }, correct: true }).expect(400);
    await save({ answers: Object.fromEntries(Array.from({ length: 161 }, (_, i) => [`q${i + 1}`, 0])) }).expect(400);
    expect(service.saveAnswers).not.toHaveBeenCalled();
  });

  it('rejects a session id that is not a uuid', async () => {
    await http().get('/sandbox/tryout/abc').set(asUser(STUDENT_A)).expect(400);
    await http().get('/sandbox/tryout/abc/result').set(asUser(STUDENT_A)).expect(400);
    await http().post('/sandbox/tryout/abc/submit').set(asUser(STUDENT_A)).send({}).expect(400);
    expect(service.view).not.toHaveBeenCalled();
  });

  it('limits starting a session and saving answers', async () => {
    rateLimit.consume.mockRejectedValue(new HttpException({ message: 'rate_limit_exceeded' }, HttpStatus.TOO_MANY_REQUESTS));
    await http().post('/sandbox/tryout').set(asUser(STUDENT_A)).send(plan).expect(429);
    await http().put(`/sandbox/tryout/${ID}/answers`).set(asUser(STUDENT_A)).send({ answers: { q1: 1 } }).expect(429);
    expect(rateLimit.consume).toHaveBeenCalledWith({ userId: STUDENT_A.id, scope: 'tryout_start', limitPerMinute: 6 });
    expect(rateLimit.consume).toHaveBeenCalledWith({ userId: STUDENT_A.id, scope: 'tryout_save', limitPerMinute: 120 });
    expect(service.start).not.toHaveBeenCalled();

    await http().post(`/sandbox/tryout/${ID}/submit`).set(asUser(STUDENT_A)).send({}).expect(200);
    await http().get(`/sandbox/tryout/${ID}`).set(asUser(STUDENT_A)).expect(200);
  });

  it('turns a service error into its status', async () => {
    service.view.mockRejectedValue(new AppError('Tryout tidak ditemukan', 404, AppErrorCode.NOT_FOUND));
    await http().get(`/sandbox/tryout/${ID}`).set(asUser(STUDENT_A)).expect(404);
    service.start.mockRejectedValue(new AppError('Masih ada tryout yang sedang berjalan.', 409, AppErrorCode.INVALID_STATE_TRANSITION));
    await http().post('/sandbox/tryout').set(asUser(STUDENT_A)).send(plan).expect(409);
  });
});
