import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { InternalLearnerWritesController } from '../internal-learner-writes.controller';
import { ChatMessagesService } from '../../chat/chat-messages/chat-messages.service';
import { ContentsService } from '../../chat/contents/contents.service';
import { PracticeQuizService } from '../../quiz/practice-quiz.service';
import { PersonalityQuizzesService } from '../../learning/personality-quizzes/personality-quizzes.service';
import { ChatMessagesSseService } from '../../sse/chat-messages-sse/chat-messages-sse.service';
import { ContentSseService } from '../../sse/content-sse/content-sse.service';
import { PersonalityQuizSseService } from '../../sse/personality-quiz-sse/personality-quiz-sse.service';
import { InternalServiceGuard } from '@/common/authz/internal-service.guard';
import { ActingUserGuard } from '@/common/authz/acting-user.guard';
import { IdempotencyService } from '@/common/idempotency/idempotency.service';
import { PrismaService } from '@/common/config/prisma/prisma.service';
import { createHttpApp } from '@/test-utils/http-harness';
import { internalAuthProviders, signInternalRequest } from '@/test-utils/internal-signing';

const CHAT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MESSAGE_A = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const LESSON = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const STEP_A = '99999999-9999-4999-8999-999999999999';
const STUDENT_A_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const STUDENT_B_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const ADMIN_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

describe('InternalLearnerWritesController', () => {
  let app: INestApplication;
  let chatMessages: { updateReply: jest.Mock };
  let contents: { create: jest.Mock };
  let quizzes: { create: jest.Mock };
  let practice: { create: jest.Mock };
  let chatMessagesSse: { emitUpdate: jest.Mock };
  let contentSse: { emitUpdate: jest.Mock };
  let quizSse: { emitUpdate: jest.Mock };
  let storedKeys: Map<string, Record<string, unknown>>;

  const users: Record<string, { id: string; role: string; isActive: boolean }> = {
    [STUDENT_A_ID]: { id: STUDENT_A_ID, role: 'STUDENT', isActive: true },
    [STUDENT_B_ID]: { id: STUDENT_B_ID, role: 'STUDENT', isActive: true },
    [ADMIN_ID]: { id: ADMIN_ID, role: 'ADMIN', isActive: true },
  };

  const send = (
    method: 'POST' | 'PATCH',
    target: string,
    body: object,
    options: { actingUser?: string; idempotencyKey?: string } = {},
  ) => {
    const raw = JSON.stringify(body);
    const headers = signInternalRequest({ method, target, body: raw, ...options });
    const call = method === 'POST' ? request(app.getHttpServer()).post(target) : request(app.getHttpServer()).patch(target);
    return call.set(headers).set('content-type', 'application/json').send(raw);
  };

  beforeEach(async () => {
    storedKeys = new Map();
    const prisma = {
      user: { findUnique: jest.fn(async ({ where }) => users[where.id] ?? null) },
      userStep: { findUnique: jest.fn(async ({ where }) => (where.id === STEP_A ? { userId: STUDENT_A_ID } : null)) },
      chat: {
        findUnique: jest.fn(async ({ where }) => (where.id === CHAT_A ? { userStep: { userId: STUDENT_A_ID } } : null)),
      },
      chatMessage: {
        findUnique: jest.fn(async ({ where }) =>
          where.id === MESSAGE_A ? { chat: { userStep: { userId: STUDENT_A_ID } } } : null,
        ),
      },
      idempotencyKey: {
        findUnique: jest.fn(async ({ where }) => storedKeys.get(`${where.key_userId.key}:${where.key_userId.userId}`) ?? null),
        create: jest.fn(async ({ data }) => {
          storedKeys.set(`${data.key}:${data.userId}`, data);
          return data;
        }),
        delete: jest.fn(async ({ where }) => storedKeys.delete(`${where.key_userId.key}:${where.key_userId.userId}`)),
      },
    };
    chatMessages = { updateReply: jest.fn().mockResolvedValue({ message: 'ok', data: { id: MESSAGE_A, chatId: CHAT_A } }) };
    contents = { create: jest.fn().mockResolvedValue({ message: 'ok', data: { id: 'content-1', chatId: CHAT_A } }) };
    quizzes = { create: jest.fn().mockResolvedValue({ message: 'ok', data: { id: 'quiz-1' } }) };
    practice = { create: jest.fn().mockResolvedValue({ message: 'ok', data: { quizId: 'quiz-9', questionCount: 3, taggedDistractors: 1 } }) };
    chatMessagesSse = { emitUpdate: jest.fn() };
    contentSse = { emitUpdate: jest.fn() };
    quizSse = { emitUpdate: jest.fn() };

    app = await createHttpApp({
      controllers: [InternalLearnerWritesController],
      rawBody: true,
      withOwnershipGuard: true,
      providers: [
        InternalServiceGuard,
        ActingUserGuard,
        IdempotencyService,
        { provide: PrismaService, useValue: prisma },
        { provide: ChatMessagesService, useValue: chatMessages },
        { provide: ContentsService, useValue: contents },
        { provide: PracticeQuizService, useValue: practice },
        { provide: PersonalityQuizzesService, useValue: quizzes },
        { provide: ChatMessagesSseService, useValue: chatMessagesSse },
        { provide: ContentSseService, useValue: contentSse },
        { provide: PersonalityQuizSseService, useValue: quizSse },
        ...internalAuthProviders(),
      ],
    });
  });

  afterEach(async () => {
    await app.close();
  });

  describe('PATCH /internal/chat-messages/:id', () => {
    const target = `/internal/chat-messages/${MESSAGE_A}`;
    const body = { text: 'Mengambil data pelajaran', status: 'PROCESSING' };

    it('updates the message of the acting user and announces the change', async () => {
      await send('PATCH', target, body, { actingUser: STUDENT_A_ID }).expect(200);

      expect(chatMessages.updateReply).toHaveBeenCalledWith(MESSAGE_A, body);
      expect(chatMessagesSse.emitUpdate).toHaveBeenCalledWith(CHAT_A);
    });

    it('rejects another user, an admin acting user and an unknown message', async () => {
      await send('PATCH', target, body, { actingUser: STUDENT_B_ID }).expect(403);
      await send('PATCH', target, body, { actingUser: ADMIN_ID }).expect(403);
      await send('PATCH', `/internal/chat-messages/${LESSON}`, body, { actingUser: STUDENT_A_ID }).expect(403);
      expect(chatMessages.updateReply).not.toHaveBeenCalled();
    });

    it('rejects a field the contract does not define', async () => {
      await send('PATCH', target, { ...body, role: 'ASSISTANT' }, { actingUser: STUDENT_A_ID }).expect(400);
      expect(chatMessages.updateReply).not.toHaveBeenCalled();
    });

    describe('citations and actions of a reply', () => {
      const reply = { text: 'Kas itu aset [1].', status: 'COMPLETED' };
      const citation = { index: 1, kind: 'MATERIAL', title: 'Persamaan akuntansi', snippet: 'Aset = Liabilitas + Ekuitas' };

      it('stores citations and proposed actions that follow the closed contract', async () => {
        const full = {
          ...reply,
          citations: [citation, { index: 2, kind: 'WEB', title: 'Contoh jurnal', url: 'https://example.com/jurnal' }],
          actions: [
            { type: 'QUIZ', count: 5 },
            { type: 'IMPROVE_MATERIAL', instruction: 'SIMPLIFY' },
            { type: 'NOTE', title: 'Kas', body: 'Kas adalah aset lancar.' },
          ],
        };

        await send('PATCH', target, full, { actingUser: STUDENT_A_ID }).expect(200);

        expect(chatMessages.updateReply).toHaveBeenCalledWith(MESSAGE_A, full);
      });

      it.each([
        ['an unknown action', { actions: [{ type: 'DELETE_ACCOUNT' }] }],
        ['an action with an extra field', { actions: [{ type: 'QUIZ', count: 5, userId: STUDENT_B_ID }] }],
        ['too many questions', { actions: [{ type: 'QUIZ', count: 50 }] }],
        ['an unknown instruction', { actions: [{ type: 'IMPROVE_MATERIAL', instruction: 'ERASE' }] }],
        ['more than four actions', { actions: Array.from({ length: 5 }, () => ({ type: 'OPEN_MATERIAL' })) }],
        ['a script link', { citations: [{ index: 1, kind: 'WEB', title: 'x', url: 'javascript:alert(1)' }] }],
        ['a link on a material source', { citations: [{ ...citation, url: 'https://example.com' }] }],
        ['more than twenty citations', { citations: Array.from({ length: 21 }, (_, index) => ({ ...citation, index: index + 1 })) }],
        ['a citation with an extra field', { citations: [{ ...citation, html: '<b>x</b>' }] }],
      ])('rejects %s', async (_name, extra) => {
        await send('PATCH', target, { ...reply, ...extra }, { actingUser: STUDENT_A_ID }).expect(400);

        expect(chatMessages.updateReply).not.toHaveBeenCalled();
      });

      it('lets the writer clear them with null', async () => {
        await send('PATCH', target, { ...reply, citations: null, actions: null }, { actingUser: STUDENT_A_ID }).expect(200);

        expect(chatMessages.updateReply).toHaveBeenCalledWith(MESSAGE_A, { ...reply, citations: null, actions: null });
      });
    });

    it('answers 400 without an acting user and 401 without service credentials', async () => {
      await send('PATCH', target, body).expect(400);
      await request(app.getHttpServer()).patch(target).send(body).expect(401);
    });

    it('applies the same key once and replays the first response', async () => {
      const options = { actingUser: STUDENT_A_ID, idempotencyKey: 'retry-key-0001' };

      const first = await send('PATCH', target, body, options).expect(200);
      const second = await send('PATCH', target, body, options).expect(200);

      expect(chatMessages.updateReply).toHaveBeenCalledTimes(1);
      expect(chatMessagesSse.emitUpdate).toHaveBeenCalledTimes(1);
      expect(second.body).toEqual(first.body);
    });

    it('rejects the same key with a different body', async () => {
      const options = { actingUser: STUDENT_A_ID, idempotencyKey: 'retry-key-0002' };
      await send('PATCH', target, body, options).expect(200);

      await send('PATCH', target, { ...body, text: 'Teks lain' }, options).expect(400);

      expect(chatMessages.updateReply).toHaveBeenCalledTimes(1);
    });
  });

  describe('POST /internal/contents', () => {
    const target = '/internal/contents';
    const body = {
      chatId: CHAT_A,
      chatMessageId: MESSAGE_A,
      data: '## Materi',
      citations: [{ lessonId: LESSON, chunkId: '3', score: 0.8, source: 'material' }],
      metadata: {},
    };

    it('stores content for a chat of the acting user, keeps object citations and announces it', async () => {
      await send('POST', target, body, { actingUser: STUDENT_A_ID }).expect(201);

      expect(contents.create).toHaveBeenCalledWith(body);
      expect(contentSse.emitUpdate).toHaveBeenCalledWith(CHAT_A);
    });

    it('rejects another user and an admin acting user', async () => {
      await send('POST', target, body, { actingUser: STUDENT_B_ID }).expect(403);
      await send('POST', target, body, { actingUser: ADMIN_ID }).expect(403);
      expect(contents.create).not.toHaveBeenCalled();
    });

    it('rejects a field the contract does not define', async () => {
      await send('POST', target, { ...body, jobStatus: 'DONE' }, { actingUser: STUDENT_A_ID }).expect(400);
      expect(contents.create).not.toHaveBeenCalled();
    });

    it('writes once when the same request is retried', async () => {
      const options = { actingUser: STUDENT_A_ID, idempotencyKey: 'retry-key-0003' };

      await send('POST', target, body, options).expect(201);
      await send('POST', target, body, options).expect(201);

      expect(contents.create).toHaveBeenCalledTimes(1);
      expect(contentSse.emitUpdate).toHaveBeenCalledTimes(1);
    });

    it('answers 400 without an acting user and 401 without service credentials', async () => {
      await send('POST', target, body).expect(400);
      await request(app.getHttpServer()).post(target).send(body).expect(401);
    });
  });

  describe('POST /internal/personality-quizzes', () => {
    const target = '/internal/personality-quizzes';
    const quiz = (userId?: string) => ({
      ...(userId ? { userId } : {}),
      lessonId: LESSON,
      title: 'AI Generated Personality Quiz',
      questions: [{ question: 'Saya suka bekerja sama', type: 'multiple_choice', difficulty: 'easy', options: ['Ya', 'Tidak'] }],
      userAttempt: 'JSON_NULL',
      result: 'JSON_NULL',
      takenAt: null,
    });

    it('creates the quiz for the acting user and announces it', async () => {
      await send('POST', target, quiz(STUDENT_A_ID), { actingUser: STUDENT_A_ID }).expect(201);

      expect(quizzes.create).toHaveBeenCalledWith(expect.objectContaining({ userId: STUDENT_A_ID, lessonId: LESSON }));
      expect(quizSse.emitUpdate).toHaveBeenCalledWith({ userId: STUDENT_A_ID, personalityQuizId: 'quiz-1' });
    });

    it('fills in the acting user when the body names none', async () => {
      await send('POST', target, quiz(), { actingUser: STUDENT_A_ID }).expect(201);

      expect(quizzes.create).toHaveBeenCalledWith(expect.objectContaining({ userId: STUDENT_A_ID }));
    });

    it('rejects a body that names another user, also for an admin acting user', async () => {
      await send('POST', target, quiz(STUDENT_A_ID), { actingUser: STUDENT_B_ID }).expect(403);
      await send('POST', target, quiz(STUDENT_A_ID), { actingUser: ADMIN_ID }).expect(403);
      expect(quizzes.create).not.toHaveBeenCalled();
    });

    it('answers 400 without an acting user and 401 without service credentials', async () => {
      await send('POST', target, quiz(STUDENT_A_ID)).expect(400);
      await request(app.getHttpServer()).post(target).send(quiz(STUDENT_A_ID)).expect(401);
    });
  });

  describe('POST /internal/user-steps/:id/practice-quiz', () => {
    const target = `/internal/user-steps/${STEP_A}/practice-quiz`;
    const question = {
      question: 'Akun apa yang bertambah di sisi debit?',
      options: ['Kas', 'Utang usaha', 'Modal', 'Pendapatan'],
      correctAnswer: 'Kas',
      distractors: { 'Utang usaha': 'normal_balance_confusion' },
    };
    const body = { title: 'Latihan jurnal', questions: [question, question, question] };

    it('creates the quiz for the step of the acting user', async () => {
      const response = await send('POST', target, body, { actingUser: STUDENT_A_ID, idempotencyKey: 'practice-1' }).expect(201);

      expect(practice.create).toHaveBeenCalledWith(STUDENT_A_ID, STEP_A, body);
      expect(response.body.data).toMatchObject({ quizId: 'quiz-9' });
    });

    it('rejects another user, an admin acting user and an unknown step', async () => {
      await send('POST', target, body, { actingUser: STUDENT_B_ID, idempotencyKey: 'practice-2' }).expect(403);
      await send('POST', target, body, { actingUser: ADMIN_ID, idempotencyKey: 'practice-3' }).expect(403);
      await send('POST', `/internal/user-steps/${LESSON}/practice-quiz`, body, { actingUser: STUDENT_A_ID, idempotencyKey: 'practice-4' }).expect(403);

      expect(practice.create).not.toHaveBeenCalled();
    });

    it.each([
      ['a quiz of two questions', { ...body, questions: [question, question] }],
      ['an answer outside the options', { ...body, questions: [{ ...question, correctAnswer: 'Giro' }, question, question] }],
      ['a learner named in the body', { ...body, userId: STUDENT_B_ID }],
    ])('rejects %s', async (_name, invalid) => {
      await send('POST', target, invalid, { actingUser: STUDENT_A_ID, idempotencyKey: 'practice-5' }).expect(400);

      expect(practice.create).not.toHaveBeenCalled();
    });

    it('creates one quiz when the same request is retried with the same key', async () => {
      const options = { actingUser: STUDENT_A_ID, idempotencyKey: 'practice-retry-0001' };

      await send('POST', target, body, options).expect(201);
      await send('POST', target, body, options).expect(201);

      expect(practice.create).toHaveBeenCalledTimes(1);
    });
  });
});
