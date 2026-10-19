import { Controller, Get, Query, Req } from '@nestjs/common';
import { z } from 'zod';
import { InternalActing } from '@/common/authz/internal-acting.decorator';
import { InternalOnly } from '@/common/authz/internal-service.guard';
import { ZodPipe } from '@/common/pipes/zod.pipe';
import { ConceptRegistryService } from '../learner-model/concepts/concept-registry.service';
import { LearnerStateService } from '../learner-model/learner-state.service';
import { POLICY_INTENTS } from '../learner-model/strategy/strategy.types';
import { TeachingDecisionService } from '../learner-model/strategy/teaching-decision.service';

export const LearnerStateQueryDto = z
  .object({
    conceptId: z.string().min(1).max(200).optional(),
    lessonId: z.string().min(1).max(200).optional(),
    userStepId: z.string().min(1).max(200).optional(),
    intent: z.enum(POLICY_INTENTS).default('DOUBT'),
  });

type LearnerStateQuery = z.infer<typeof LearnerStateQueryDto>;

const PYTHON_SCHEME = 'PYTHON_DOMAIN';

@Controller('internal')
export class InternalLearnerStateController {
  constructor(
    private readonly registry: ConceptRegistryService,
    private readonly state: LearnerStateService,
    private readonly decisions: TeachingDecisionService,
  ) {}

  @Get('concepts')
  @InternalOnly()
  async concepts() {
    const [concepts, pythonAliases] = await Promise.all([this.registry.listActive(), this.registry.approvedAliases(PYTHON_SCHEME)]);
    return { message: 'Concept registry', data: { concepts, aliases: { [PYTHON_SCHEME]: pythonAliases } } };
  }

  @Get('learner-state')
  @InternalActing()
  async learnerState(@Req() req: { user: { id: string } }, @Query(new ZodPipe(LearnerStateQueryDto)) query: LearnerStateQuery) {
    const userId = req.user.id;
    const lessonConcepts = query.lessonId ? (await this.registry.conceptsForLesson(query.lessonId)).conceptIds : [];
    const stepConcepts = query.userStepId ? await this.state.conceptIdsForUserStep(userId, query.userStepId) : [];
    const wanted = [...new Set([...(query.conceptId ? [query.conceptId] : []), ...lessonConcepts, ...stepConcepts])];
    const [concepts, next, strategy] = await Promise.all([
      wanted.length > 0 ? this.state.conceptStates(userId, wanted) : Promise.resolve([]),
      this.state.nextConcept(userId),
      this.decisions.decide(userId, { conceptIds: wanted, intent: query.intent }),
    ]);
    return { message: 'Learner state', data: { userId, concepts, next, strategy } };
  }
}
