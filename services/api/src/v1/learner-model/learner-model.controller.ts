import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import { AuthenticatedOnly } from '@/common/authz/access';
import { ZodPipe } from '@/common/pipes/zod.pipe';
import { GetUser } from '@/v1/auth/auth.decorator';
import { ConceptRegistryService } from './concepts/concept-registry.service';
import { LearnerStateService } from './learner-state.service';
import { ReminderToggle, ReminderToggleDto } from './review/review-reminder.dto';
import { ReviewService } from './review/review.service';
import { StrategyQuery, StrategyQueryDto } from './strategy/strategy.types';
import { StrategyOutcomeService } from './strategy/strategy-outcome.service';
import { TeachingDecisionService } from './strategy/teaching-decision.service';

@Controller('learner-model')
export class LearnerModelController {
  constructor(
    private readonly state: LearnerStateService,
    private readonly decisions: TeachingDecisionService,
    private readonly outcomes: StrategyOutcomeService,
    private readonly review: ReviewService,
    private readonly registry: ConceptRegistryService,
  ) {}

  @Get('concepts')
  @AuthenticatedOnly()
  async concepts() {
    const active = await this.registry.listActive();
    return {
      message: 'Active concepts',
      data: active.map(({ id, title, description, level }) => ({ id, title, description, level })),
    };
  }

  @Get('me/mastery')
  @AuthenticatedOnly()
  async mastery(@GetUser('id') userId: string) {
    return { message: 'Concept mastery', data: await this.state.listMastery(userId) };
  }

  @Get('me/next')
  @AuthenticatedOnly()
  async next(@GetUser('id') userId: string) {
    return { message: 'Next concept', data: await this.state.nextConcept(userId) };
  }

  @Get('me/skill-nodes')
  @AuthenticatedOnly()
  async skillNodes(@GetUser('id') userId: string) {
    return { message: 'Skill nodes', data: await this.state.skillNodes(userId) };
  }

  @Get('me/review')
  @AuthenticatedOnly()
  async reviewQueue(@GetUser('id') userId: string) {
    return { message: 'Concepts due for review', data: await this.review.queue(userId) };
  }

  @Put('me/review/reminders')
  @AuthenticatedOnly()
  async reviewReminders(@GetUser('id') userId: string, @Body(new ZodPipe(ReminderToggleDto)) body: ReminderToggle) {
    return { message: body.enabled ? 'Review reminders on' : 'Review reminders off', data: await this.review.setReminders(userId, body.enabled) };
  }

  @Get('me/strategy')
  @AuthenticatedOnly()
  async strategy(@GetUser('id') userId: string, @Query(new ZodPipe(StrategyQueryDto)) query: StrategyQuery) {
    const conceptId = query.conceptId ?? (await this.state.nextConcept(userId)).conceptId;
    const decision = conceptId ? await this.decisions.decide(userId, { conceptIds: [conceptId], intent: query.intent }) : null;
    return { message: 'Teaching strategy', data: decision };
  }

  @Get('me/strategies')
  @AuthenticatedOnly()
  async strategies(@GetUser('id') userId: string) {
    return { message: 'Strategy evidence', data: await this.outcomes.summary(userId) };
  }
}
