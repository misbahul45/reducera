import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { memoryStorage } from 'multer';
import { ZodPipe } from '@/common/pipes/zod.pipe';
import { RequireOwnership, RequireParentOwnership } from '@/v1/common/guards/ownership.decorator';
import { RateLimit } from '@/v1/common/rate-limit/rate-limit.guard';
import { ATTACHMENT_MAX_BYTES } from './attachment-rules';
import { UploadAttachmentQueryDto, UploadAttachmentQueryDtoType } from './chat-attachments.dto';
import { ChatAttachmentsService, IncomingImage } from './chat-attachments.service';

const CACHE_SECONDS = 3600;

@Controller('chat-attachments')
export class ChatAttachmentsController {
  constructor(private readonly attachments: ChatAttachmentsService) {}

  @Post()
  @RequireParentOwnership('chat', 'chatId', 'query')
  @RateLimit({ scope: 'chat_attachment', limitPerMinute: 12 })
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: ATTACHMENT_MAX_BYTES, files: 1, fields: 0 } }))
  upload(@Query(new ZodPipe(UploadAttachmentQueryDto)) query: UploadAttachmentQueryDtoType, @UploadedFile() file: IncomingImage | undefined) {
    return this.attachments.upload(query.chatId, file);
  }

  @Get(':id/content')
  @RequireOwnership('chat-attachment')
  async content(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const image = await this.attachments.read(id);
    res.status(200);
    res.setHeader('Content-Type', image.mime);
    res.setHeader('Content-Length', String(image.bytes.length));
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cache-Control', `private, max-age=${CACHE_SECONDS}, immutable`);
    res.end(image.bytes);
  }

  @Delete(':id')
  @HttpCode(200)
  @RequireOwnership('chat-attachment')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.attachments.removePending(id);
  }
}
