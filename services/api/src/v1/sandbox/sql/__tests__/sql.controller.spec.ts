import { HttpException, HttpStatus, INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppError, AppErrorCode } from '@/common/lib/error';
import { STUDENT_A, asUser, createHttpApp } from '@/test-utils/http-harness';
import { RateLimitService } from '@/v1/common/rate-limit/rate-limit.service';
import { MAX_SQL_LENGTH } from '../sql-guard';
import { SqlPracticeService } from '../sql-practice.service';
import { SqlSandboxController } from '../sql.controller';

describe('SqlSandboxController', () => {
  let app: INestApplication;
  let service: Record<'catalog' | 'run' | 'check' | 'hint' | 'reveal', jest.Mock>;
  let rateLimit: { consume: jest.Mock };

  beforeEach(async () => {
    service = {
      catalog: jest.fn().mockResolvedValue({ datasets: [], exercises: [], summary: {} }),
      run: jest.fn().mockResolvedValue({ accepted: true, outputs: [] }),
      check: jest.fn().mockResolvedValue({ correct: true }),
      hint: jest.fn().mockResolvedValue({ hintLevel: 1 }),
      reveal: jest.fn().mockResolvedValue({ referenceSql: 'SELECT 1' }),
    };
    rateLimit = { consume: jest.fn().mockResolvedValue({ allowed: true, remaining: 10 }) };
    app = await createHttpApp({
      controllers: [SqlSandboxController],
      providers: [
        { provide: SqlPracticeService, useValue: service },
        { provide: RateLimitService, useValue: rateLimit },
      ],
    });
  });

  afterEach(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  it('requires a signed-in learner on every route', async () => {
    await http().get('/sandbox/sql').expect(401);
    await http().post('/sandbox/sql/run').send({ datasetId: 'toko-online', sql: 'SELECT 1' }).expect(401);
    await http().post('/sandbox/sql/exercises/sql-kota-unik/check').send({ sql: 'SELECT 1' }).expect(401);
    await http().post('/sandbox/sql/exercises/sql-kota-unik/hint').expect(401);
    await http().post('/sandbox/sql/exercises/sql-kota-unik/reveal').expect(401);
    expect(service.run).not.toHaveBeenCalled();
    expect(service.check).not.toHaveBeenCalled();
  });

  it('always acts as the caller', async () => {
    await http().get('/sandbox/sql').set(asUser(STUDENT_A)).expect(200);
    expect(service.catalog).toHaveBeenCalledWith(STUDENT_A.id);

    await http().post('/sandbox/sql/exercises/sql-kota-unik/check').set(asUser(STUDENT_A)).send({ sql: 'SELECT 1' }).expect(200);
    expect(service.check).toHaveBeenCalledWith(STUDENT_A.id, 'sql-kota-unik', { sql: 'SELECT 1' });

    await http().post('/sandbox/sql/exercises/sql-kota-unik/hint').set(asUser(STUDENT_A)).expect(200);
    expect(service.hint).toHaveBeenCalledWith(STUDENT_A.id, 'sql-kota-unik');

    await http().post('/sandbox/sql/exercises/sql-kota-unik/reveal').set(asUser(STUDENT_A)).expect(200);
    expect(service.reveal).toHaveBeenCalledWith(STUDENT_A.id, 'sql-kota-unik');
  });

  it('runs free SQL with a dataset id and nothing else', async () => {
    await http().post('/sandbox/sql/run').set(asUser(STUDENT_A)).send({ datasetId: 'toko-online', sql: 'SELECT 1' }).expect(200);
    expect(service.run).toHaveBeenCalledWith({ datasetId: 'toko-online', sql: 'SELECT 1' });
  });

  it('rejects a body it does not understand', async () => {
    const run = (body: unknown) => http().post('/sandbox/sql/run').set(asUser(STUDENT_A)).send(body as object);
    await run({ sql: 'SELECT 1' }).expect(400);
    await run({ datasetId: 'toko-online' }).expect(400);
    await run({ datasetId: 'Toko Online', sql: 'SELECT 1' }).expect(400);
    await run({ datasetId: 'toko-online', sql: '' }).expect(400);
    await run({ datasetId: 'toko-online', sql: 42 }).expect(400);
    await run({ datasetId: 'toko-online', sql: 'SELECT 1', userId: 'someone-else' }).expect(400);
    await run({ datasetId: 'toko-online', sql: 'x'.repeat(MAX_SQL_LENGTH + 1) }).expect(400);
    expect(service.run).not.toHaveBeenCalled();

    const check = (body: unknown) => http().post('/sandbox/sql/exercises/sql-kota-unik/check').set(asUser(STUDENT_A)).send(body as object);
    await check({}).expect(400);
    await check({ sql: 'SELECT 1', correct: true }).expect(400);
    await check({ sql: ['SELECT 1'] }).expect(400);
    expect(service.check).not.toHaveBeenCalled();
  });

  it('rejects an exercise id that is not a slug', async () => {
    await http().post('/sandbox/sql/exercises/Not_A_Slug/check').set(asUser(STUDENT_A)).send({ sql: 'SELECT 1' }).expect(400);
    await http().post('/sandbox/sql/exercises/ab/hint').set(asUser(STUDENT_A)).expect(400);
    await http().post('/sandbox/sql/exercises/ab/reveal').set(asUser(STUDENT_A)).expect(400);
    expect(service.hint).not.toHaveBeenCalled();
  });

  it('limits how often SQL can be run and checked but not the hints', async () => {
    rateLimit.consume.mockRejectedValue(new HttpException({ message: 'rate_limit_exceeded' }, HttpStatus.TOO_MANY_REQUESTS));
    await http().post('/sandbox/sql/run').set(asUser(STUDENT_A)).send({ datasetId: 'toko-online', sql: 'SELECT 1' }).expect(429);
    await http().post('/sandbox/sql/exercises/sql-kota-unik/check').set(asUser(STUDENT_A)).send({ sql: 'SELECT 1' }).expect(429);
    expect(service.run).not.toHaveBeenCalled();
    expect(service.check).not.toHaveBeenCalled();
    expect(rateLimit.consume).toHaveBeenCalledWith({ userId: STUDENT_A.id, scope: 'sandbox_sql', limitPerMinute: 40 });

    await http().post('/sandbox/sql/exercises/sql-kota-unik/hint').set(asUser(STUDENT_A)).expect(200);
    await http().get('/sandbox/sql').set(asUser(STUDENT_A)).expect(200);
  });

  it('turns a service error into its status', async () => {
    service.check.mockRejectedValue(new AppError('Latihan tidak ditemukan', 404, AppErrorCode.NOT_FOUND));
    await http().post('/sandbox/sql/exercises/sql-tidak-ada/check').set(asUser(STUDENT_A)).send({ sql: 'SELECT 1' }).expect(404);

    service.run.mockRejectedValue(new AppError('Sandbox SQL sedang tidak tersedia.', 503, AppErrorCode.SERVICE_UNAVAILABLE));
    await http().post('/sandbox/sql/run').set(asUser(STUDENT_A)).send({ datasetId: 'toko-online', sql: 'SELECT 1' }).expect(503);
  });
});
