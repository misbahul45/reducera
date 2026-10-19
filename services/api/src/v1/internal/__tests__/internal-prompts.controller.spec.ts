import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { InternalPromptsController } from '../internal-prompts.controller';
import { PromptRegistryService } from '../../optimization/prompt-registry.service';
import { InternalServiceGuard } from '@/common/authz/internal-service.guard';
import { ActingUserGuard } from '@/common/authz/acting-user.guard';
import { PrismaService } from '@/common/config/prisma/prisma.service';
import { createHttpApp } from '@/test-utils/http-harness';
import { internalAuthProviders, signInternalRequest } from '@/test-utils/internal-signing';

describe('InternalPromptsController', () => {
  let app: INestApplication;
  let registry: { resolve: jest.Mock };

  const get = (target: string, actingUser?: string) =>
    request(app.getHttpServer())
      .get(target)
      .set(signInternalRequest({ method: 'GET', target, actingUser }));

  beforeEach(async () => {
    registry = { resolve: jest.fn().mockResolvedValue({ label: 'tutor-chat@3', version: 3, body: 'template', modelName: 'router-default', arm: 'canary' }) };
    app = await createHttpApp({
      controllers: [InternalPromptsController],
      rawBody: true,
      providers: [
        InternalServiceGuard,
        ActingUserGuard,
        { provide: PrismaService, useValue: { user: { findUnique: jest.fn(async ({ where }) => (where.id === 'student-a' ? { id: 'student-a', role: 'STUDENT', isActive: true } : null)) } } },
        { provide: PromptRegistryService, useValue: registry },
        ...internalAuthProviders(),
      ],
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it('serves the template chosen for the acting learner', async () => {
    const response = await get('/internal/prompts/resolve?name=tutor-chat', 'student-a').expect(200);

    expect(registry.resolve).toHaveBeenCalledWith('student-a', 'tutor-chat');
    expect(response.body.data).toMatchObject({ label: 'tutor-chat@3', arm: 'canary' });
  });

  it('answers with no template when no version is live', async () => {
    registry.resolve.mockResolvedValue(null);

    const response = await get('/internal/prompts/resolve?name=tutor-chat', 'student-a').expect(200);

    expect(response.body.data).toBeNull();
  });

  it('rejects a prompt name outside the contract', async () => {
    await get('/internal/prompts/resolve?name=secrets', 'student-a').expect(400);
    await get('/internal/prompts/resolve', 'student-a').expect(400);

    expect(registry.resolve).not.toHaveBeenCalled();
  });

  it('rejects a missing acting user, an unknown one and an unsigned request', async () => {
    await get('/internal/prompts/resolve?name=tutor-chat').expect(400);
    await get('/internal/prompts/resolve?name=tutor-chat', 'ghost').expect(403);
    await request(app.getHttpServer()).get('/internal/prompts/resolve?name=tutor-chat').expect(401);

    expect(registry.resolve).not.toHaveBeenCalled();
  });
});
