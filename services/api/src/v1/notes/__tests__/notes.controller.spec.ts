import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { PrismaService } from '@/common/config/prisma/prisma.service';
import { STUDENT_A, STUDENT_B, asUser, createHttpApp } from '@/test-utils/http-harness';
import { NotesController } from '../notes.controller';
import { NotesService } from '../notes.service';

const NOTE_ID = '11111111-1111-4111-8111-111111111111';
const STEP_ID = '22222222-2222-4222-8222-222222222222';

describe('NotesController', () => {
  let app: INestApplication;
  let service: { create: jest.Mock; list: jest.Mock; findOne: jest.Mock; update: jest.Mock; remove: jest.Mock };

  beforeEach(async () => {
    service = {
      create: jest.fn().mockResolvedValue({ message: 'Note saved', data: { id: NOTE_ID } }),
      list: jest.fn().mockResolvedValue({ message: 'ok', data: { data: [], meta: {} } }),
      findOne: jest.fn().mockResolvedValue({ message: 'ok', data: { id: NOTE_ID } }),
      update: jest.fn().mockResolvedValue({ message: 'ok', data: { id: NOTE_ID } }),
      remove: jest.fn().mockResolvedValue({ message: 'ok', data: null }),
    };
    app = await createHttpApp({
      controllers: [NotesController],
      withOwnershipGuard: true,
      providers: [
        { provide: NotesService, useValue: service },
        { provide: PrismaService, useValue: { note: { findUnique: jest.fn(async ({ where }) => (where.id === NOTE_ID ? { userId: STUDENT_A.id } : null)) } } },
      ],
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it('requires authentication on every route', async () => {
    await request(app.getHttpServer()).post('/notes').send({ title: 't', body: 'b' }).expect(401);
    await request(app.getHttpServer()).get('/notes').expect(401);
    await request(app.getHttpServer()).get(`/notes/${NOTE_ID}`).expect(401);
  });

  it('creates a note for the caller and never takes the owner from the body', async () => {
    await request(app.getHttpServer()).post('/notes').set(asUser(STUDENT_A)).send({ title: ' Jurnal ', body: 'Debit kas' }).expect(201);

    expect(service.create).toHaveBeenCalledWith(STUDENT_A.id, { title: 'Jurnal', body: 'Debit kas', source: 'MANUAL' });

    service.create.mockClear();
    await request(app.getHttpServer()).post('/notes').set(asUser(STUDENT_A)).send({ title: 't', body: 'b', userId: STUDENT_B.id }).expect(400);
    expect(service.create).not.toHaveBeenCalled();
  });

  it('rejects an empty or oversized note', async () => {
    await request(app.getHttpServer()).post('/notes').set(asUser(STUDENT_A)).send({ title: '   ', body: 'b' }).expect(400);
    await request(app.getHttpServer()).post('/notes').set(asUser(STUDENT_A)).send({ title: 't', body: 'x'.repeat(8001) }).expect(400);
    await request(app.getHttpServer()).post('/notes').set(asUser(STUDENT_A)).send({ title: 't', body: 'b', userStepId: 'not-a-uuid' }).expect(400);

    expect(service.create).not.toHaveBeenCalled();
  });

  it('lists only the caller notes and bounds the page size', async () => {
    await request(app.getHttpServer()).get(`/notes?userStepId=${STEP_ID}&limit=10`).set(asUser(STUDENT_A)).expect(200);

    expect(service.list).toHaveBeenCalledWith(STUDENT_A.id, { userStepId: STEP_ID, page: 1, limit: 10 });

    await request(app.getHttpServer()).get('/notes?limit=500').set(asUser(STUDENT_A)).expect(400);
    await request(app.getHttpServer()).get(`/notes?userId=${STUDENT_B.id}`).set(asUser(STUDENT_A)).expect(400);
  });

  it('lets the owner read, change and delete a note', async () => {
    await request(app.getHttpServer()).get(`/notes/${NOTE_ID}`).set(asUser(STUDENT_A)).expect(200);
    await request(app.getHttpServer()).patch(`/notes/${NOTE_ID}`).set(asUser(STUDENT_A)).send({ body: 'revisi' }).expect(200);
    await request(app.getHttpServer()).delete(`/notes/${NOTE_ID}`).set(asUser(STUDENT_A)).expect(200);

    expect(service.update).toHaveBeenCalledWith(NOTE_ID, { body: 'revisi' });
    expect(service.remove).toHaveBeenCalledWith(NOTE_ID);
  });

  it("refuses another learner's note on every verb", async () => {
    await request(app.getHttpServer()).get(`/notes/${NOTE_ID}`).set(asUser(STUDENT_B)).expect(403);
    await request(app.getHttpServer()).patch(`/notes/${NOTE_ID}`).set(asUser(STUDENT_B)).send({ body: 'x' }).expect(403);
    await request(app.getHttpServer()).delete(`/notes/${NOTE_ID}`).set(asUser(STUDENT_B)).expect(403);

    expect(service.findOne).not.toHaveBeenCalled();
    expect(service.update).not.toHaveBeenCalled();
    expect(service.remove).not.toHaveBeenCalled();
  });

  it('refuses an empty update', async () => {
    await request(app.getHttpServer()).patch(`/notes/${NOTE_ID}`).set(asUser(STUDENT_A)).send({}).expect(400);

    expect(service.update).not.toHaveBeenCalled();
  });

  it('answers 403 for a note that does not exist, the same as for a note of someone else', async () => {
    await request(app.getHttpServer()).get('/notes/33333333-3333-4333-8333-333333333333').set(asUser(STUDENT_A)).expect(403);
  });
});
