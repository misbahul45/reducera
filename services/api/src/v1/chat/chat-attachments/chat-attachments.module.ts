import { Module } from '@nestjs/common';
import { PrismaModule } from '@/common/config/prisma/prisma.module';
import { RateLimitModule } from '@/v1/common/rate-limit/rate-limit.module';
import { ChatAttachmentsController } from './chat-attachments.controller';
import { ChatAttachmentsService } from './chat-attachments.service';

@Module({
  imports: [PrismaModule, RateLimitModule],
  controllers: [ChatAttachmentsController],
  providers: [ChatAttachmentsService],
  exports: [ChatAttachmentsService],
})
export class ChatAttachmentsModule {}
