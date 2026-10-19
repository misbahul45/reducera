import { ChatMessagesRepo } from '../chat-messages/chat-messages.repo';

const CHAT = '11111111-1111-4111-8111-111111111111';
const IMG_A = '22222222-2222-4222-8222-222222222222';
const IMG_B = '33333333-3333-4333-8333-333333333333';
const VIEW_SELECT = { id: true, name: true, mime: true, size: true };

describe('ChatMessagesRepo attachments', () => {
  let tx: any;
  let prisma: any;
  let repo: ChatMessagesRepo;

  beforeEach(() => {
    tx = {
      chatMessage: {
        create: jest.fn().mockResolvedValue({ id: 'msg-1', chatId: CHAT }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'msg-1', chatId: CHAT, attachments: [{ id: IMG_A }] }),
      },
      chatAttachment: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    prisma = {
      chatMessage: { create: jest.fn().mockResolvedValue({ id: 'msg-0', chatId: CHAT }), findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
      $transaction: jest.fn(async (work: (client: any) => unknown) => work(tx)),
    };
    repo = new ChatMessagesRepo(prisma);
  });

  it('creates a plain message without a transaction', async () => {
    await repo.create({ chatId: CHAT, role: 'USER', text: 'Halo' });

    expect(prisma.chatMessage.create).toHaveBeenCalledWith({ data: { chatId: CHAT, role: 'USER', text: 'Halo' } });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('creates the message and links its images in one transaction, keeping the ids out of the row', async () => {
    const created = await repo.create({ chatId: CHAT, role: 'USER', text: 'Lihat ini', attachmentIds: [IMG_A] });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.chatMessage.create).toHaveBeenCalledWith({ data: { chatId: CHAT, role: 'USER', text: 'Lihat ini' } });
    expect(tx.chatAttachment.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [IMG_A] }, chatId: CHAT, messageId: null },
      data: { messageId: 'msg-1' },
    });
    expect(tx.chatMessage.findUniqueOrThrow.mock.calls[0][0].include.attachments.select).toEqual(VIEW_SELECT);
    expect(created).toMatchObject({ id: 'msg-1', attachments: [{ id: IMG_A }] });
  });

  it('rolls the message back when an image cannot be linked', async () => {
    tx.chatAttachment.updateMany.mockResolvedValue({ count: 0 });

    await expect(repo.create({ chatId: CHAT, role: 'USER', text: 'x', attachmentIds: [IMG_A, IMG_B] })).rejects.toMatchObject({ statusCode: 422 });
    expect(tx.chatMessage.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('refuses images on a message that is not from the learner', async () => {
    await expect(repo.create({ chatId: CHAT, role: 'ASSISTANT', text: 'x', attachmentIds: [IMG_A] })).rejects.toMatchObject({ statusCode: 422 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.chatMessage.create).not.toHaveBeenCalled();
  });

  it('refuses more images than a message may hold', async () => {
    const ids = [IMG_A, IMG_B, '44444444-4444-4444-8444-444444444444', '55555555-5555-4555-8555-555555555555'];

    await expect(repo.create({ chatId: CHAT, role: 'USER', text: 'x', attachmentIds: ids })).rejects.toBeDefined();
    expect(prisma.chatMessage.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('lists messages with the description of their images and never their bytes', async () => {
    await repo.findAll(CHAT, { page: 1, limit: 50 } as any);

    const query = prisma.chatMessage.findMany.mock.calls[0][0];
    expect(query.include.attachments.select).toEqual(VIEW_SELECT);
    expect(query.include.attachments.select.data).toBeUndefined();
  });
});
