import { Prisma } from '@prisma/client';
import { AppError, AppErrorCode } from '@/common/lib/error';
import { ATTACHMENTS_PER_MESSAGE } from './attachment-rules';

export const linkAttachments = async (tx: Prisma.TransactionClient, chatId: string, messageId: string, attachmentIds: string[]) => {
  const ids = [...new Set(attachmentIds)];
  if (ids.length === 0) return;
  if (ids.length > ATTACHMENTS_PER_MESSAGE) {
    throw new AppError(`A message holds at most ${ATTACHMENTS_PER_MESSAGE} images`, 422, AppErrorCode.VALIDATION_ERROR);
  }
  const linked = await tx.chatAttachment.updateMany({
    where: { id: { in: ids }, chatId, messageId: null },
    data: { messageId },
  });
  if (linked.count !== ids.length) {
    throw new AppError('An image is missing, already sent or belongs to another chat', 422, AppErrorCode.VALIDATION_ERROR);
  }
};
