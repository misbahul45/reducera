import { Body, Controller, Param, ParseUUIDPipe, Put, Req, UseInterceptors } from '@nestjs/common';
import { z } from 'zod';
import { InternalActing } from '@/common/authz/internal-acting.decorator';
import { RequireIdempotencyKey } from '@/common/idempotency/require-idempotency-key.decorator';
import { IdempotentWriteInterceptor } from '@/common/idempotency/idempotent-write.interceptor';
import { ZodPipe } from '@/common/pipes/zod.pipe';
import { ChatCitationsSchema } from '../chat/chat-message-extras';
import { LessonIntroductionService } from './lesson-introduction.service';

export const SaveIntroductionDto = z
  .object({
    introduction: z.string().trim().min(20).max(20000),
    citations: ChatCitationsSchema,
  })
  .strict();
type SaveIntroductionType = z.infer<typeof SaveIntroductionDto>;

@Controller('internal')
@UseInterceptors(IdempotentWriteInterceptor)
export class InternalLessonIntroductionController {
  constructor(private readonly introductions: LessonIntroductionService) {}

  @Put('lessons/:lessonId/introduction')
  @InternalActing()
  @RequireIdempotencyKey()
  save(
    @Param('lessonId', ParseUUIDPipe) lessonId: string,
    @Req() req: { user: { id: string } },
    @Body(new ZodPipe(SaveIntroductionDto)) body: SaveIntroductionType,
  ) {
    return this.introductions.save(req.user.id, lessonId, body);
  }
}
