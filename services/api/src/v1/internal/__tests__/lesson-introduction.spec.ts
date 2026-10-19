import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { InternalLessonIntroductionController } from '../internal-lesson-introduction.controller';
import { LessonIntroductionService } from '../lesson-introduction.service';
import { InternalServiceGuard } from '@/common/authz/internal-service.guard';
import { ActingUserGuard } from '@/common/authz/acting-user.guard';
import { IdempotencyService } from '@/common/idempotency/idempotency.service';
import { PrismaService } from '@/common/config/prisma/prisma.service';
import { createHttpApp } from '@/test-utils/http-harness';
import { internalAuthProviders, signInternalRequest } from '@/test-utils/internal-signing';

const LESSON = '11111111-1111-4111-8111-111111111111';
const INTRO = 'Pengantar singkat tentang akuntansi dasar [1].';
const CITATION = { index: 1, kind: 'TOPIC', title: 'Topik: Akuntansi Dasar', refType: 'TOPIC', refId: 'topic-1', via: ['LEXICAL'] };

describe('LessonIntroductionService', () => {
  const build = () => {
    const prisma: any = {
      lesson: { findUnique: jest.fn().mockResolvedValue({ subTopic: { topicId: 'topic-1' } }) },
      userTopic: { count: jest.fn().mockResolvedValue(1) },
      lessonProgress: { upsert: jest.fn().mockResolvedValue({ id: 'lp-1' }) },
    };
    return { prisma, service: new LessonIntroductionService(prisma) };
  };

  it('stores the text and its citations on the progress of the learner, creating it when it is missing', async () => {
    const { prisma, service } = build();

    const result = await service.save('user-1', LESSON, { introduction: INTRO, citations: [CITATION as never] });

    expect(prisma.lessonProgress.upsert.mock.calls[0][0]).toMatchObject({
      where: { userId_lessonId: { userId: 'user-1', lessonId: LESSON } },
      create: { userId: 'user-1', lessonId: LESSON, introduction: INTRO, introductionCitations: [CITATION] },
      update: { introduction: INTRO, introductionCitations: [CITATION] },
    });
    expect(result.data).toEqual({ id: 'lp-1', citations: 1 });
  });

  it('refuses a learner who has not unlocked the topic and a lesson that does not exist', async () => {
    const { prisma, service } = build();
    prisma.userTopic.count.mockResolvedValue(0);
    await expect(service.save('user-1', LESSON, { introduction: INTRO, citations: [] })).rejects.toMatchObject({ statusCode: 403 });
    expect(prisma.lessonProgress.upsert).not.toHaveBeenCalled();

    prisma.lesson.findUnique.mockResolvedValue(null);
    await expect(service.save('user-1', LESSON, { introduction: INTRO, citations: [] })).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('PUT /internal/lessons/:lessonId/introduction', () => {
  let app: INestApplication;
  let service: { save: jest.Mock };

  const put = (target: string, body: object, options: { actingUser?: string; idempotencyKey?: string } = {}) => {
    const raw = JSON.stringify(body);
    return request(app.getHttpServer())
      .put(target)
      .set(signInternalRequest({ method: 'PUT', target, body: raw, ...options }))
      .set('content-type', 'application/json')
      .send(raw);
  };

  beforeEach(async () => {
    const stored = new Map<string, Record<string, unknown>>();
    service = { save: jest.fn().mockResolvedValue({ message: 'ok', data: { id: 'lp-1', citations: 1 } }) };
    app = await createHttpApp({
      controllers: [InternalLessonIntroductionController],
      rawBody: true,
      withOwnershipGuard: true,
      providers: [
        InternalServiceGuard,
        ActingUserGuard,
        IdempotencyService,
        {
          provide: PrismaService,
          useValue: {
            user: { findUnique: jest.fn(async ({ where }) => (where.id === 'student-a' ? { id: 'student-a', role: 'STUDENT', isActive: true } : null)) },
            idempotencyKey: {
              findUnique: jest.fn(async ({ where }) => stored.get(`${where.key_userId.key}:${where.key_userId.userId}`) ?? null),
              create: jest.fn(async ({ data }) => {
                stored.set(`${data.key}:${data.userId}`, data);
                return data;
              }),
              delete: jest.fn(async ({ where }) => stored.delete(`${where.key_userId.key}:${where.key_userId.userId}`)),
            },
          },
        },
        { provide: LessonIntroductionService, useValue: service },
        ...internalAuthProviders(),
      ],
    });
  });

  afterEach(async () => {
    await app.close();
  });

  const target = `/internal/lessons/${LESSON}/introduction`;

  it('saves for the acting user', async () => {
    await put(target, { introduction: INTRO, citations: [CITATION] }, { actingUser: 'student-a', idempotencyKey: 'intro-key-0001' }).expect(200);

    expect(service.save).toHaveBeenCalledWith('student-a', LESSON, { introduction: INTRO, citations: [CITATION] });
  });

  it.each([
    ['a text that is too short', { introduction: 'pendek', citations: [] }],
    ['a citation with a script link', { introduction: INTRO, citations: [{ index: 1, kind: 'WEB', title: 'x', url: 'javascript:alert(1)' }] }],
    ['an unknown field', { introduction: INTRO, citations: [], userId: 'student-b' }],
    ['no citations list', { introduction: INTRO }],
  ])('rejects %s', async (_name, body) => {
    await put(target, body, { actingUser: 'student-a', idempotencyKey: 'intro-key-0002' }).expect(400);

    expect(service.save).not.toHaveBeenCalled();
  });

  it('rejects a lesson id that is not a uuid, and a caller without service credentials', async () => {
    await put('/internal/lessons/not-a-uuid/introduction', { introduction: INTRO, citations: [] }, { actingUser: 'student-a', idempotencyKey: 'intro-key-0003' }).expect(400);
    await request(app.getHttpServer()).put(target).send({ introduction: INTRO, citations: [] }).expect(401);
  });
});
