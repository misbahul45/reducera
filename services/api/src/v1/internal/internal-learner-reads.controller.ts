import { Controller, Get, Param, ParseUUIDPipe, Query, Req } from '@nestjs/common';
import { InternalActing, InternalOwnership } from '@/common/authz/internal-acting.decorator';
import { resolveActingUserScope } from '@/common/authz/acting-scope';
import { Query as QueryInterface } from '@/common/interfaces';
import { UserStepsService } from '../learning/user-steps/user-steps.service';
import { LearningStylesService } from '../learning/learning-styles/learning-styles.service';
import { PersonalityQuizzesService } from '../learning/personality-quizzes/personality-quizzes.service';
import { ContentSimilarityService } from '../chat/contents/content-similarity.service';
import { ChatContextService } from '../chat/chat-context.service';
import { ChatAttachmentsService } from '../chat/chat-attachments/chat-attachments.service';
import { ZodPipe } from '@/common/pipes/zod.pipe';
import { z } from 'zod';

const ChatContextQueryDto = z
  .object({
    limit: z.coerce.number().int().min(1).max(30).default(12),
    beforeMessageId: z.string().uuid().optional(),
  })
  .strict();
type ChatContextQuery = z.infer<typeof ChatContextQueryDto>;

@Controller('internal')
export class InternalLearnerReadsController {
  constructor(
    private readonly userStepsService: UserStepsService,
    private readonly learningStylesService: LearningStylesService,
    private readonly personalityQuizzesService: PersonalityQuizzesService,
    private readonly contentSimilarityService: ContentSimilarityService,
    private readonly chatContextService: ChatContextService,
    private readonly chatAttachmentsService: ChatAttachmentsService,
  ) {}

  @Get('user-steps/:id')
  @InternalActing()
  @InternalOwnership('user-step')
  findUserStep(@Param('id') id: string, @Query() query: QueryInterface) {
    return this.userStepsService.findOne(id, query);
  }

  @Get('learning-styles/:id')
  @InternalActing()
  @InternalOwnership('learning-style')
  findLearningStyle(@Param('id') id: string, @Query() query: QueryInterface) {
    return this.learningStylesService.findOne(id, query);
  }

  @Get('personality-quizzes')
  @InternalActing()
  findPersonalityQuizzes(@Req() req: { user: { id: string } }, @Query() query: QueryInterface) {
    const userId = resolveActingUserScope(req.user.id, query.userId);
    return this.personalityQuizzesService.findAll(userId, query);
  }

  @Get('contents/similarity')
  @InternalActing()
  @InternalOwnership('chat', { field: 'chatId', source: 'query' })
  findSimilarContents(@Query('chatId') chatId: string, @Query('query') query: string) {
    return this.contentSimilarityService.findSimilar(chatId, query);
  }

  @Get('chats/:chatId/context')
  @InternalActing()
  @InternalOwnership('chat', { field: 'chatId' })
  readChatContext(@Param('chatId') chatId: string, @Query(new ZodPipe(ChatContextQueryDto)) query: ChatContextQuery) {
    return this.chatContextService.read(chatId, query);
  }

  @Get('chat-attachments/:id/content')
  @InternalActing()
  @InternalOwnership('chat-attachment')
  readChatAttachment(@Param('id', ParseUUIDPipe) id: string) {
    return this.chatAttachmentsService.readEncoded(id);
  }
}
