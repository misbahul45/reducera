import { Module } from '@nestjs/common';
import { ContentsService } from './contents.service';
import { ContentsController } from './contents.controller';
import { PrismaModule } from '@/common/config/prisma/prisma.module';
import { ContentsRepo } from './contents.repo';
import { ContentSimilarityService } from './content-similarity.service';
import { ChatMessagesModule } from '@/v1/chat/chat-messages/chat-messages.module';
import { ContentSseModule } from '@/v1/sse/content-sse/content-sse.module';

@Module({
  controllers: [ContentsController],
  providers: [ContentsService, ContentsRepo, ContentSimilarityService],
  imports: [PrismaModule, ChatMessagesModule, ContentSseModule],
  exports: [ContentsService, ContentsRepo, ContentSimilarityService]
})
export class ContentsModule {}
