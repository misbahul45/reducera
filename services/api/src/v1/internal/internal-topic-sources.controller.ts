import { Controller, Get, Query, Req } from '@nestjs/common';
import { z } from 'zod';
import { InternalActing } from '@/common/authz/internal-acting.decorator';
import { ZodPipe } from '@/common/pipes/zod.pipe';
import { TopicSourcesService } from './topic-sources.service';

export const TopicSourcesQueryDto = z
  .object({
    lessonId: z.string().uuid().optional(),
    userStepId: z.string().uuid().optional(),
  })
  .strict()
  .refine((value) => value.lessonId !== undefined || value.userStepId !== undefined, { message: 'A lesson or a step is required' });
type TopicSourcesQuery = z.infer<typeof TopicSourcesQueryDto>;

@Controller('internal')
export class InternalTopicSourcesController {
  constructor(private readonly topicSources: TopicSourcesService) {}

  @Get('topic-sources')
  @InternalActing()
  read(@Req() req: { user: { id: string } }, @Query(new ZodPipe(TopicSourcesQueryDto)) query: TopicSourcesQuery) {
    return this.topicSources.read(req.user.id, query);
  }
}
