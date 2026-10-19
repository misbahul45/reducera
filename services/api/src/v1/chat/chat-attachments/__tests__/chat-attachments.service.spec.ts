import { ATTACHMENTS_PER_CHAT, ATTACHMENT_MAX_BYTES, PENDING_ATTACHMENTS_PER_CHAT } from '../attachment-rules';
import { ChatAttachmentsService } from '../chat-attachments.service';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 7)]);

describe('ChatAttachmentsService', () => {
  let prisma: any;
  let service: ChatAttachmentsService;

  beforeEach(() => {
    prisma = {
      chatAttachment: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(async ({ data }) => ({ id: 'att-1', name: data.name, mime: data.mime, size: data.size })),
        findUnique: jest.fn(),
      },
    };
    service = new ChatAttachmentsService(prisma);
  });

  it('stores a real image with the type read from its bytes and a clean name', async () => {
    const result = await service.upload('chat-1', { originalname: '../neraca.png', buffer: PNG });

    expect(result.data).toEqual({ id: 'att-1', name: 'neraca.png', mime: 'image/png', size: PNG.length });
    const { data } = prisma.chatAttachment.create.mock.calls[0][0];
    expect(data).toMatchObject({ chatId: 'chat-1', mime: 'image/png', size: PNG.length });
    expect(Buffer.from(data.data).equals(PNG)).toBe(true);
    expect(prisma.chatAttachment.create.mock.calls[0][0].select).toEqual({ id: true, name: true, mime: true, size: true });
  });

  it('refuses a file that is not an image even when it is named like one', async () => {
    await expect(service.upload('chat-1', { originalname: 'x.png', buffer: Buffer.from('<svg onload=alert(1)>') })).rejects.toMatchObject({ statusCode: 422 });
    expect(prisma.chatAttachment.create).not.toHaveBeenCalled();
  });

  it.each([[undefined], [{}], [{ buffer: Buffer.alloc(0) }]])('refuses a missing or empty file (%j)', async (file) => {
    await expect(service.upload('chat-1', file as any)).rejects.toMatchObject({ statusCode: 422 });
  });

  it('refuses an image larger than the limit', async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(ATTACHMENT_MAX_BYTES)]);

    await expect(service.upload('chat-1', { originalname: 'big.png', buffer: big })).rejects.toMatchObject({ statusCode: 413 });
    expect(prisma.chatAttachment.create).not.toHaveBeenCalled();
  });

  it('removes old unsent images before counting, so abandoned uploads do not block the chat', async () => {
    await service.upload('chat-1', { originalname: 'a.png', buffer: PNG });

    const where = prisma.chatAttachment.deleteMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ chatId: 'chat-1', messageId: null });
    expect(where.createdAt.lt).toBeInstanceOf(Date);
    expect(prisma.chatAttachment.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(prisma.chatAttachment.count.mock.invocationCallOrder[0]);
  });

  it('stops at the image limit of the chat and at the unsent limit', async () => {
    prisma.chatAttachment.count.mockResolvedValueOnce(ATTACHMENTS_PER_CHAT).mockResolvedValueOnce(0);
    await expect(service.upload('chat-1', { originalname: 'a.png', buffer: PNG })).rejects.toMatchObject({ statusCode: 409, code: 'ATTACHMENT_LIMIT_REACHED' });

    prisma.chatAttachment.count.mockResolvedValueOnce(5).mockResolvedValueOnce(PENDING_ATTACHMENTS_PER_CHAT);
    await expect(service.upload('chat-1', { originalname: 'a.png', buffer: PNG })).rejects.toMatchObject({ statusCode: 409, code: 'ATTACHMENT_LIMIT_REACHED' });
    expect(prisma.chatAttachment.create).not.toHaveBeenCalled();
  });

  it('reads an image back and encodes it for the ai service', async () => {
    prisma.chatAttachment.findUnique.mockResolvedValue({ id: 'att-1', name: 'a.png', mime: 'image/png', size: PNG.length, data: new Uint8Array(PNG) });

    const { data } = await service.readEncoded('att-1');

    expect(data).toEqual({ id: 'att-1', name: 'a.png', mime: 'image/png', size: PNG.length, base64: PNG.toString('base64') });
  });

  it('answers 404 for an image that does not exist', async () => {
    prisma.chatAttachment.findUnique.mockResolvedValue(null);

    await expect(service.read('missing')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('removes only an image that is not sent yet', async () => {
    prisma.chatAttachment.deleteMany.mockResolvedValueOnce({ count: 1 });
    await expect(service.removePending('att-1')).resolves.toMatchObject({ data: null });
    expect(prisma.chatAttachment.deleteMany).toHaveBeenCalledWith({ where: { id: 'att-1', messageId: null } });

    prisma.chatAttachment.deleteMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.removePending('att-2')).rejects.toMatchObject({ statusCode: 409 });
  });
});
