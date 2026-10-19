import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { ADMIN_A, STUDENT_A, TEACHER_A, asUser, createHttpApp } from '@/test-utils/http-harness';
import { AdminCircularityController } from '../admin-circularity.controller';
import { CircularityMetricsService } from '../circularity-metrics.service';

describe('AdminCircularityController', () => {
  let app: INestApplication;
  let metrics: { report: jest.Mock };

  beforeEach(async () => {
    metrics = { report: jest.fn(async () => ({ message: 'Successfully retrieved circularity metrics', data: { metrics: [] } })) };
    app = await createHttpApp({
      controllers: [AdminCircularityController],
      providers: [{ provide: CircularityMetricsService, useValue: metrics }],
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it('gives the report to an administrator and forwards the parsed window', async () => {
    const response = await request(app.getHttpServer())
      .get('/admin/metrics/circularity?from=2026-09-17T00:00:00.000Z&to=2026-10-17T00:00:00.000Z')
      .set(asUser(ADMIN_A));

    expect(response.status).toBe(200);
    expect(metrics.report).toHaveBeenCalledTimes(1);
    const [actor, query] = metrics.report.mock.calls[0];
    expect(actor.id).toBe(ADMIN_A.id);
    expect(query.from).toEqual(new Date('2026-09-17T00:00:00.000Z'));
    expect(query.to).toEqual(new Date('2026-10-17T00:00:00.000Z'));
  });

  it('accepts a request without a window', async () => {
    const response = await request(app.getHttpServer()).get('/admin/metrics/circularity').set(asUser(ADMIN_A));

    expect(response.status).toBe(200);
    expect(metrics.report.mock.calls[0][1]).toEqual({});
  });

  it.each([
    ['a learner', STUDENT_A],
    ['a creator', TEACHER_A],
  ])('refuses %s', async (_label, user) => {
    const response = await request(app.getHttpServer()).get('/admin/metrics/circularity').set(asUser(user));

    expect(response.status).toBe(403);
    expect(metrics.report).not.toHaveBeenCalled();
  });

  it('refuses a caller who is not signed in', async () => {
    const response = await request(app.getHttpServer()).get('/admin/metrics/circularity');

    expect(response.status).toBe(401);
    expect(metrics.report).not.toHaveBeenCalled();
  });

  it.each([['from=not-a-date'], ['days=7'], ['organic=false']])('rejects the query %s', async (query) => {
    const response = await request(app.getHttpServer()).get(`/admin/metrics/circularity?${query}`).set(asUser(ADMIN_A));

    expect(response.status).toBe(400);
    expect(metrics.report).not.toHaveBeenCalled();
  });
});
