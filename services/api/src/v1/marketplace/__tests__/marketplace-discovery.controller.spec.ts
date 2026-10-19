import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { MarketplaceDiscoveryController } from '../marketplace-discovery.controller';
import { MarketplaceDiscoveryService } from '../marketplace-discovery.service';
import { STUDENT_A, STUDENT_B, asUser, createHttpApp } from '@/test-utils/http-harness';

describe('MarketplaceDiscoveryController', () => {
  let app: INestApplication;
  let discovery: { recommend: jest.Mock };

  beforeEach(async () => {
    discovery = {
      recommend: jest.fn(async () => ({
        algorithm: 'reco-v1',
        averageMastery: 0.4,
        preferredDifficulty: 'INTERMEDIATE',
        needs: [],
        recommendations: [{ product: { kind: 'article', id: 'a1' }, reason: 'Membahas "X".', personalized: true }],
      })),
    };
    app = await createHttpApp({
      controllers: [MarketplaceDiscoveryController],
      providers: [{ provide: MarketplaceDiscoveryService, useValue: discovery }],
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it('requires authentication', async () => {
    await request(app.getHttpServer()).get('/marketplace-discovery/recommendations').expect(401);

    expect(discovery.recommend).not.toHaveBeenCalled();
  });

  it('recommends for the caller with the default limit', async () => {
    const res = await request(app.getHttpServer()).get('/marketplace-discovery/recommendations').set(asUser(STUDENT_A)).expect(200);

    expect(discovery.recommend).toHaveBeenCalledWith(STUDENT_A.id, { limit: 10 });
    expect(res.body.data).toMatchObject({ algorithm: 'reco-v1', preferredDifficulty: 'INTERMEDIATE' });
    expect(res.body.data.recommendations[0]).toMatchObject({ reason: 'Membahas "X".', personalized: true });
  });

  it('ignores a userId in the query', async () => {
    await request(app.getHttpServer()).get(`/marketplace-discovery/recommendations?userId=${STUDENT_B.id}`).set(asUser(STUDENT_A)).expect(200);

    expect(discovery.recommend).toHaveBeenCalledWith(STUDENT_A.id, expect.anything());
    expect(discovery.recommend).not.toHaveBeenCalledWith(STUDENT_B.id, expect.anything());
  });

  it('passes the limit that was asked for', async () => {
    await request(app.getHttpServer()).get('/marketplace-discovery/recommendations?limit=8').set(asUser(STUDENT_A)).expect(200);

    expect(discovery.recommend).toHaveBeenCalledWith(STUDENT_A.id, { limit: 8 });
  });

  it.each(['0', '31', '500', 'abc', '-3', '2.5'])('rejects the limit %s', async (limit) => {
    await request(app.getHttpServer()).get(`/marketplace-discovery/recommendations?limit=${limit}`).set(asUser(STUDENT_A)).expect(400);

    expect(discovery.recommend).not.toHaveBeenCalled();
  });
});
