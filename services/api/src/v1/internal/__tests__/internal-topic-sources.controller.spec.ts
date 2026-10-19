import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { InternalTopicSourcesController } from '../internal-topic-sources.controller';
import { TopicSourcesService } from '../topic-sources.service';
import { InternalServiceGuard } from '@/common/authz/internal-service.guard';
import { ActingUserGuard } from '@/common/authz/acting-user.guard';
import { PrismaService } from '@/common/config/prisma/prisma.service';
import { createHttpApp } from '@/test-utils/http-harness';
import { internalAuthProviders, signInternalRequest } from '@/test-utils/internal-signing';

const LESSON = '11111111-1111-4111-8111-111111111111';

describe('InternalTopicSourcesController', () => {
  let app: INestApplication;
  let service: { read: jest.Mock };

  const get = (target: string, actingUser?: string) =>
    request(app.getHttpServer())
      .get(target)
      .set(signInternalRequest({ method: 'GET', target, actingUser }));

  beforeEach(async () => {
    service = { read: jest.fn().mockResolvedValue({ message: 'ok', data: { scope: {}, sources: [] } }) };
    app = await createHttpApp({
      controllers: [InternalTopicSourcesController],
      rawBody: true,
      withOwnershipGuard: true,
      providers: [
        InternalServiceGuard,
        ActingUserGuard,
        { provide: PrismaService, useValue: { user: { findUnique: jest.fn(async ({ where }) => (where.id === 'student-a' ? { id: 'student-a', role: 'STUDENT', isActive: true } : null)) } } },
        { provide: TopicSourcesService, useValue: service },
        ...internalAuthProviders(),
      ],
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it('reads the sources of a lesson for the acting user', async () => {
    await get(`/internal/topic-sources?lessonId=${LESSON}`, 'student-a').expect(200);

    expect(service.read).toHaveBeenCalledWith('student-a', { lessonId: LESSON });
  });

  it('rejects a request that names neither a lesson nor a step', async () => {
    await get('/internal/topic-sources', 'student-a').expect(400);

    expect(service.read).not.toHaveBeenCalled();
  });

  it.each(['lessonId=nope', 'userStepId=nope', `lessonId=${LESSON}&userId=student-b`])('rejects the query "%s"', async (query) => {
    await get(`/internal/topic-sources?${query}`, 'student-a').expect(400);

    expect(service.read).not.toHaveBeenCalled();
  });

  it('answers 400 without an acting user, 403 for an inactive or unknown one and 401 without service credentials', async () => {
    await get(`/internal/topic-sources?lessonId=${LESSON}`).expect(400);
    await get(`/internal/topic-sources?lessonId=${LESSON}`, 'ghost').expect(403);
    await request(app.getHttpServer()).get(`/internal/topic-sources?lessonId=${LESSON}`).expect(401);
  });
});
