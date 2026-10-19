import { Injectable } from '@nestjs/common';
import { MessageStatus } from '@prisma/client';
import { PrismaService } from '@/common/config/prisma/prisma.service';
import { AppError, AppErrorCode } from '@/common/lib/error';
import { ATTACHMENT_VIEW_SELECT } from './chat-attachments/attachment-rules';

export const MESSAGE_TEXT_LIMIT = 1200;
export const MATERIAL_TEXT_LIMIT = 3000;
export const MATERIAL_COUNT = 2;
export const NAME_LIMIT = 30;

export const firstName = (name: string | null | undefined): string | null => {
  const token = (name ?? '').trim().split(/\s+/)[0] ?? '';
  const clean = token.replace(/[^\p{L}\p{M}'-]/gu, '').slice(0, NAME_LIMIT);
  return clean.length > 0 ? clean : null;
};

@Injectable()
export class ChatContextService {
  constructor(private readonly prisma: PrismaService) {}

  async read(chatId: string, options: { limit: number; beforeMessageId?: string }) {
    const chat = await this.prisma.chat.findUnique({
      where: { id: chatId },
      select: { userStep: { select: { title: true, user: { select: { name: true } } } } },
    });
    if (!chat) throw new AppError('Chat not found', 404, AppErrorCode.NOT_FOUND);

    const before = options.beforeMessageId
      ? await this.prisma.chatMessage.findFirst({ where: { id: options.beforeMessageId, chatId }, select: { createdAt: true } })
      : null;

    const [recent, materials] = await Promise.all([
      this.prisma.chatMessage.findMany({
        where: {
          chatId,
          status: MessageStatus.COMPLETED,
          OR: [{ text: { not: null } }, { attachments: { some: {} } }],
          ...(before ? { createdAt: { lt: before.createdAt } } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: options.limit,
        select: {
          id: true,
          role: true,
          text: true,
          createdAt: true,
          attachments: { select: ATTACHMENT_VIEW_SELECT, orderBy: { createdAt: 'asc' } },
        },
      }),
      this.prisma.content.findMany({
        where: { chatId },
        orderBy: { createdAt: 'desc' },
        take: MATERIAL_COUNT,
        select: { id: true, data: true, createdAt: true },
      }),
    ]);

    return {
      message: 'Successfully retrieved chat context',
      data: {
        learnerName: firstName(chat.userStep.user.name),
        stepTitle: chat.userStep.title,
        messages: recent.reverse().map((row) => ({
          id: row.id,
          role: row.role,
          text: (row.text ?? '').slice(0, MESSAGE_TEXT_LIMIT),
          createdAt: row.createdAt,
          attachments: row.attachments,
        })),
        materials: materials.reverse().map((row) => ({ id: row.id, text: (row.data ?? '').slice(0, MATERIAL_TEXT_LIMIT) })),
      },
    };
  }
}
