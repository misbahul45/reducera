import { Controller, Get, Query, Req } from '@nestjs/common';
import { InternalActing } from '@/common/authz/internal-acting.decorator';
import { ZodPipe } from '@/common/pipes/zod.pipe';
import { ResolvePromptQueryDto, ResolvePromptQueryDtoType } from '../optimization/optimization.dto';
import { PromptRegistryService } from '../optimization/prompt-registry.service';

@Controller('internal/prompts')
export class InternalPromptsController {
  constructor(private readonly registry: PromptRegistryService) {}

  @Get('resolve')
  @InternalActing()
  async resolve(@Req() req: { user: { id: string } }, @Query(new ZodPipe(ResolvePromptQueryDto)) query: ResolvePromptQueryDtoType) {
    return { message: 'Prompt template', data: await this.registry.resolve(req.user.id, query.name) };
  }
}
