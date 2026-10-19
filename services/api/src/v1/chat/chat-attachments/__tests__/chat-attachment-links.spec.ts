import { ATTACHMENTS_PER_MESSAGE } from '../attachment-rules';
import { linkAttachments } from '../chat-attachment-links';

const ID = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

describe('linkAttachments', () => {
  const tx = (count: number) => ({ chatAttachment: { updateMany: jest.fn().mockResolvedValue({ count }) } }) as any;

  it('does nothing when there is no image', async () => {
    const client = tx(0);

    await linkAttachments(client, 'chat-1', 'msg-1', []);

    expect(client.chatAttachment.updateMany).not.toHaveBeenCalled();
  });

  it('links only unsent images of this chat to the message', async () => {
    const client = tx(2);

    await linkAttachments(client, 'chat-1', 'msg-1', [ID(1), ID(2)]);

    expect(client.chatAttachment.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [ID(1), ID(2)] }, chatId: 'chat-1', messageId: null },
      data: { messageId: 'msg-1' },
    });
  });

  it('counts the same image once', async () => {
    const client = tx(1);

    await linkAttachments(client, 'chat-1', 'msg-1', [ID(1), ID(1)]);

    expect(client.chatAttachment.updateMany.mock.calls[0][0].where.id).toEqual({ in: [ID(1)] });
  });

  it('refuses an image that is missing, already sent or from another chat', async () => {
    await expect(linkAttachments(tx(1), 'chat-1', 'msg-1', [ID(1), ID(2)])).rejects.toMatchObject({ statusCode: 422 });
  });

  it('refuses more images than a message may hold', async () => {
    const ids = Array.from({ length: ATTACHMENTS_PER_MESSAGE + 1 }, (_, n) => ID(n + 1));
    const client = tx(ids.length);

    await expect(linkAttachments(client, 'chat-1', 'msg-1', ids)).rejects.toMatchObject({ statusCode: 422 });
    expect(client.chatAttachment.updateMany).not.toHaveBeenCalled();
  });
});
