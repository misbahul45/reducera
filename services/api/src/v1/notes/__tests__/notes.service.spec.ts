import { MAX_NOTES_PER_USER, NotesService } from '../notes.service';

const USER = 'user-1';
const STEP = '22222222-2222-4222-8222-222222222222';
const MESSAGE = '44444444-4444-4444-8444-444444444444';
const now = new Date('2026-10-12T00:00:00Z');

const stored = (overrides: Record<string, unknown> = {}) => ({
  id: 'n-1',
  userId: USER,
  userStepId: STEP,
  chatMessageId: null,
  title: 'Jurnal',
  body: 'Debit kas',
  source: 'MANUAL',
  createdAt: now,
  updatedAt: now,
  userStep: { title: 'Jurnal umum', stepTemplateId: 'tpl-1' },
  ...overrides,
});

describe('NotesService', () => {
  let prisma: any;
  let service: NotesService;

  beforeEach(() => {
    prisma = {
      note: {
        create: jest.fn(async ({ data }) => stored({ ...data })),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn(async ({ data }) => stored({ ...data })),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      userStep: { findUnique: jest.fn().mockResolvedValue({ userId: USER }) },
      chatMessage: { findUnique: jest.fn() },
    };
    service = new NotesService(prisma);
  });

  describe('create', () => {
    it('saves a free note without any link', async () => {
      const result = await service.create(USER, { title: 'Jurnal', body: 'Debit kas', source: 'MANUAL' });

      expect(prisma.note.create.mock.calls[0][0].data).toMatchObject({ userId: USER, userStepId: null, chatMessageId: null, source: 'MANUAL' });
      expect(result.data).toMatchObject({ title: 'Jurnal', duplicate: false });
    });

    it('links a note to a step of the caller', async () => {
      await service.create(USER, { title: 'Jurnal', body: 'Debit kas', userStepId: STEP, source: 'MANUAL' });

      expect(prisma.note.create.mock.calls[0][0].data.userStepId).toBe(STEP);
    });

    it("refuses a step of another learner as if it did not exist", async () => {
      prisma.userStep.findUnique.mockResolvedValue({ userId: 'someone-else' });

      await expect(service.create(USER, { title: 'a', body: 'b', userStepId: STEP, source: 'MANUAL' })).rejects.toMatchObject({ statusCode: 404 });
      expect(prisma.note.create).not.toHaveBeenCalled();
    });

    it('takes the step from the chat message and checks that the message is the caller', async () => {
      prisma.chatMessage.findUnique.mockResolvedValue({ chat: { userStepId: STEP, userStep: { userId: USER } } });

      await service.create(USER, { title: 'a', body: 'b', chatMessageId: MESSAGE, source: 'CHAT' });

      expect(prisma.note.create.mock.calls[0][0].data).toMatchObject({ userStepId: STEP, chatMessageId: MESSAGE, source: 'CHAT' });
    });

    it("refuses the message of another learner", async () => {
      prisma.chatMessage.findUnique.mockResolvedValue({ chat: { userStepId: STEP, userStep: { userId: 'someone-else' } } });

      await expect(service.create(USER, { title: 'a', body: 'b', chatMessageId: MESSAGE, source: 'CHAT' })).rejects.toMatchObject({ statusCode: 404 });
    });

    it('refuses a step that contradicts the message', async () => {
      prisma.chatMessage.findUnique.mockResolvedValue({ chat: { userStepId: 'other-step', userStep: { userId: USER } } });

      await expect(service.create(USER, { title: 'a', body: 'b', chatMessageId: MESSAGE, userStepId: STEP, source: 'CHAT' })).rejects.toMatchObject({ statusCode: 422 });
    });

    it('returns the saved note instead of a copy when the same note is sent twice for a message', async () => {
      prisma.chatMessage.findUnique.mockResolvedValue({ chat: { userStepId: STEP, userStep: { userId: USER } } });
      prisma.note.findFirst.mockResolvedValue(stored({ chatMessageId: MESSAGE, source: 'CHAT' }));

      const result = await service.create(USER, { title: 'Jurnal', body: 'Debit kas', chatMessageId: MESSAGE, source: 'CHAT' });

      expect(result.data).toMatchObject({ duplicate: true });
      expect(prisma.note.create).not.toHaveBeenCalled();
    });

    it('stops at the note limit', async () => {
      prisma.note.count.mockResolvedValue(MAX_NOTES_PER_USER);

      await expect(service.create(USER, { title: 'a', body: 'b', source: 'MANUAL' })).rejects.toMatchObject({ statusCode: 409, code: 'NOTE_LIMIT_REACHED' });
    });
  });

  describe('list', () => {
    it('scopes the query to the caller and paginates', async () => {
      prisma.note.findMany.mockResolvedValue([stored()]);
      prisma.note.count.mockResolvedValue(41);

      const result = await service.list(USER, { page: 2, limit: 20 });

      expect(prisma.note.findMany.mock.calls[0][0]).toMatchObject({ where: { userId: USER }, skip: 20, take: 20, orderBy: { createdAt: 'desc' } });
      expect(result.data.meta).toEqual({ page: 2, limit: 20, total: 41, totalPages: 3 });
      expect(result.data.data[0]).toMatchObject({ userStepTitle: 'Jurnal umum', stepTemplateId: 'tpl-1' });
    });

    it('filters by step and by text in the title or the body', async () => {
      await service.list(USER, { page: 1, limit: 20, userStepId: STEP, q: 'debit' });

      const where = prisma.note.findMany.mock.calls[0][0].where;
      expect(where).toMatchObject({ userId: USER, userStepId: STEP });
      expect(where.OR).toHaveLength(2);
    });
  });

  describe('update and remove', () => {
    it('changes only the fields that were sent', async () => {
      prisma.note.findUnique.mockResolvedValue({ id: 'n-1' });

      await service.update('n-1', { body: 'revisi' });

      expect(prisma.note.update.mock.calls[0][0].data).toEqual({ body: 'revisi' });
    });

    it('answers 404 for a missing note', async () => {
      prisma.note.findUnique.mockResolvedValue(null);
      prisma.note.deleteMany.mockResolvedValue({ count: 0 });

      await expect(service.update('n-1', { body: 'x' })).rejects.toMatchObject({ statusCode: 404 });
      await expect(service.remove('n-1')).rejects.toMatchObject({ statusCode: 404 });
      await expect(service.findOne('n-1')).rejects.toMatchObject({ statusCode: 404 });
    });
  });
});
