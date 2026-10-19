import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/common/config/prisma/prisma.service';
import { AppError, AppErrorCode } from '@/common/lib/error';
import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_VIEW_SELECT,
  ATTACHMENTS_PER_CHAT,
  AttachmentView,
  PENDING_ATTACHMENT_TTL_MS,
  PENDING_ATTACHMENTS_PER_CHAT,
  cleanAttachmentName,
  sniffImage,
} from './attachment-rules';

export interface IncomingImage {
  originalname?: string;
  buffer?: Buffer;
}

@Injectable()
export class ChatAttachmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async upload(chatId: string, file: IncomingImage | undefined) {
    if (!file?.buffer || file.buffer.length === 0) {
      throw new AppError('Attach an image file', 422, AppErrorCode.VALIDATION_ERROR);
    }
    if (file.buffer.length > ATTACHMENT_MAX_BYTES) {
      throw new AppError('The image is larger than 4 MB', 413, AppErrorCode.VALIDATION_ERROR);
    }
    const mime = sniffImage(file.buffer);
    if (!mime) {
      throw new AppError('Only PNG, JPEG, WebP and GIF images are accepted', 422, AppErrorCode.VALIDATION_ERROR);
    }

    await this.prisma.chatAttachment.deleteMany({
      where: { chatId, messageId: null, createdAt: { lt: new Date(Date.now() - PENDING_ATTACHMENT_TTL_MS) } },
    });

    const [total, pending] = await Promise.all([
      this.prisma.chatAttachment.count({ where: { chatId } }),
      this.prisma.chatAttachment.count({ where: { chatId, messageId: null } }),
    ]);
    if (total >= ATTACHMENTS_PER_CHAT || pending >= PENDING_ATTACHMENTS_PER_CHAT) {
      throw new AppError('The image limit of this chat is reached', 409, AppErrorCode.ATTACHMENT_LIMIT_REACHED);
    }

    const created = await this.prisma.chatAttachment.create({
      data: { chatId, name: cleanAttachmentName(file.originalname), mime, size: file.buffer.length, data: new Uint8Array(file.buffer) },
      select: ATTACHMENT_VIEW_SELECT,
    });
    return { message: 'Image attached', data: created satisfies AttachmentView };
  }

  async read(id: string) {
    const row = await this.prisma.chatAttachment.findUnique({
      where: { id },
      select: { id: true, name: true, mime: true, size: true, data: true },
    });
    if (!row) throw new AppError('Image not found', 404, AppErrorCode.NOT_FOUND);
    return { id: row.id, name: row.name, mime: row.mime, size: row.size, bytes: Buffer.from(row.data) };
  }

  async readEncoded(id: string) {
    const { bytes, ...meta } = await this.read(id);
    return { message: 'Successfully retrieved the image', data: { ...meta, base64: bytes.toString('base64') } };
  }

  async removePending(id: string) {
    const removed = await this.prisma.chatAttachment.deleteMany({ where: { id, messageId: null } });
    if (removed.count === 0) {
      throw new AppError('Only an image that is not sent yet can be removed', 409, AppErrorCode.INVALID_STATE_TRANSITION);
    }
    return { message: 'Image removed', data: null };
  }
}
