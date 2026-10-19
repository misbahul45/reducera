import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { PrismaService } from '@/common/config/prisma/prisma.service';
import { RateLimitService } from '@/v1/common/rate-limit/rate-limit.service';
import { STUDENT_A, STUDENT_B, asUser, createHttpApp } from '@/test-utils/http-harness';
import { ATTACHMENT_MAX_BYTES } from '../attachment-rules';
import { ChatAttachmentsController } from '../chat-attachments.controller';
import { ChatAttachmentsService } from '../chat-attachments.service';

const CHAT = '11111111-1111-4111-8111-111111111111';
const OTHER_CHAT = '22222222-2222-4222-8222-222222222222';
const ATT = '33333333-3333-4333-8333-333333333333';
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16, 1)]);

describe('ChatAttachmentsController', () => {
  let app: INestApplication;
  let service: { upload: jest.Mock; read: jest.Mock; removePending: jest.Mock };

  beforeEach(async () => {
    service = {
      upload: jest.fn().mockResolvedValue({ message: 'Image attached', data: { id: ATT, name: 'a.png', mime: 'image/png', size: PNG.length } }),
      read: jest.fn().mockResolvedValue({ id: ATT, name: 'a.png', mime: 'image/png', size: PNG.length, bytes: PNG }),
      removePending: jest.fn().mockResolvedValue({ message: 'Image removed', data: null }),
    };
    const owner = (where: { id: string }) => (where.id === CHAT || where.id === ATT ? { userStep: { userId: STUDENT_A.id } } : null);
    app = await createHttpApp({
      controllers: [ChatAttachmentsController],
      withOwnershipGuard: true,
      providers: [
        { provide: ChatAttachmentsService, useValue: service },
        { provide: RateLimitService, useValue: { consume: jest.fn().mockResolvedValue(undefined) } },
        {
          provide: PrismaService,
          useValue: {
            chat: { findUnique: jest.fn(async ({ where }) => owner(where)) },
            chatAttachment: { findUnique: jest.fn(async ({ where }) => (where.id === ATT ? { chat: owner({ id: CHAT }) } : null)) },
          },
        },
      ],
    });
  });

  afterEach(async () => {
    await app.close();
  });

  const upload = (chatId: string, user = STUDENT_A, file: Buffer = PNG) =>
    request(app.getHttpServer()).post(`/chat-attachments?chatId=${chatId}`).set(asUser(user)).attach('file', file, { filename: 'a.png', contentType: 'image/png' });

  it('requires authentication on every route', async () => {
    await request(app.getHttpServer()).post(`/chat-attachments?chatId=${CHAT}`).expect(401);
    await request(app.getHttpServer()).get(`/chat-attachments/${ATT}/content`).expect(401);
    await request(app.getHttpServer()).delete(`/chat-attachments/${ATT}`).expect(401);
  });

  it('lets the owner of the chat upload an image', async () => {
    const response = await upload(CHAT).expect(201);

    expect(response.body.data).toMatchObject({ id: ATT, mime: 'image/png' });
    const [chatId, file] = service.upload.mock.calls[0];
    expect(chatId).toBe(CHAT);
    expect(Buffer.from(file.buffer).equals(PNG)).toBe(true);
  });

  it('refuses an upload into the chat of someone else or into a chat that does not exist', async () => {
    await upload(CHAT, STUDENT_B).expect(403);
    await upload(OTHER_CHAT).expect(403);
    expect(service.upload).not.toHaveBeenCalled();
  });

  it('refuses an upload without a valid chat id', async () => {
    await request(app.getHttpServer()).post('/chat-attachments').set(asUser(STUDENT_A)).attach('file', PNG, 'a.png').expect(403);
    await request(app.getHttpServer()).post('/chat-attachments?chatId=nope').set(asUser(STUDENT_A)).attach('file', PNG, 'a.png').expect(403);
  });

  it('stops a file above the size limit before it reaches the service', async () => {
    await upload(CHAT, STUDENT_A, Buffer.concat([PNG, Buffer.alloc(ATTACHMENT_MAX_BYTES + 1)])).expect(413);
    expect(service.upload).not.toHaveBeenCalled();
  });

  it('serves the bytes to the owner as an inert, private, non sniffable image', async () => {
    const response = await request(app.getHttpServer()).get(`/chat-attachments/${ATT}/content`).set(asUser(STUDENT_A)).buffer(true).parse((res, done) => {
      const parts: Buffer[] = [];
      res.on('data', (part: Buffer) => parts.push(part));
      res.on('end', () => done(null, Buffer.concat(parts)));
    }).expect(200);

    expect(Buffer.from(response.body).equals(PNG)).toBe(true);
    expect(response.headers['content-type']).toBe('image/png');
    expect(response.headers['content-length']).toBe(String(PNG.length));
    expect(response.headers['content-disposition']).toBe('inline');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-security-policy']).toBe("default-src 'none'; sandbox");
    expect(response.headers['cache-control']).toMatch(/^private, /);
  });

  it('does not serve or remove the image of someone else', async () => {
    await request(app.getHttpServer()).get(`/chat-attachments/${ATT}/content`).set(asUser(STUDENT_B)).expect(403);
    await request(app.getHttpServer()).delete(`/chat-attachments/${ATT}`).set(asUser(STUDENT_B)).expect(403);
    expect(service.read).not.toHaveBeenCalled();
    expect(service.removePending).not.toHaveBeenCalled();
  });

  it('lets the owner remove an image before it is sent', async () => {
    await request(app.getHttpServer()).delete(`/chat-attachments/${ATT}`).set(asUser(STUDENT_A)).expect(200);

    expect(service.removePending).toHaveBeenCalledWith(ATT);
  });
});
