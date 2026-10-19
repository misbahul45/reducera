import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { AuthenticatedOnly } from '@/common/authz/access';
import { AuthUser } from '@/common/interfaces/auth.interface';
import { ZodPipe } from '@/common/pipes/zod.pipe';
import { RateLimit } from '@/v1/common/rate-limit/rate-limit.guard';
import { GetUser } from '../../auth/auth.decorator';
import {
  SaveAnswersDto,
  SaveAnswersSchema,
  SubmitTryoutDto,
  SubmitTryoutSchema,
  TryoutHistoryQuery,
  TryoutHistoryQuerySchema,
  TryoutIdSchema,
  TryoutPlanDto,
  TryoutPlanSchema,
} from '../dto/tryout.dto';
import { TryoutService } from './tryout.service';

const tryoutId = new ZodPipe(TryoutIdSchema);

@Controller('sandbox/tryout')
export class TryoutController {
  constructor(private readonly tryouts: TryoutService) {}

  @Get()
  @AuthenticatedOnly()
  catalog(@GetUser() user: AuthUser) {
    return this.tryouts.catalog(user.id);
  }

  @Post()
  @AuthenticatedOnly()
  @RateLimit({ scope: 'tryout_start', limitPerMinute: 6 })
  start(@Body(new ZodPipe(TryoutPlanSchema)) dto: TryoutPlanDto, @GetUser() user: AuthUser) {
    return this.tryouts.start(user.id, dto);
  }

  @Get('history')
  @AuthenticatedOnly()
  history(@Query(new ZodPipe(TryoutHistoryQuerySchema)) query: TryoutHistoryQuery, @GetUser() user: AuthUser) {
    return this.tryouts.history(user.id, query);
  }

  @Get(':id')
  @AuthenticatedOnly()
  view(@Param('id', tryoutId) id: string, @GetUser() user: AuthUser) {
    return this.tryouts.view(user.id, id);
  }

  @Put(':id/answers')
  @AuthenticatedOnly()
  @RateLimit({ scope: 'tryout_save', limitPerMinute: 120 })
  saveAnswers(@Param('id', tryoutId) id: string, @Body(new ZodPipe(SaveAnswersSchema)) dto: SaveAnswersDto, @GetUser() user: AuthUser) {
    return this.tryouts.saveAnswers(user.id, id, dto);
  }

  @Post(':id/submit')
  @HttpCode(200)
  @AuthenticatedOnly()
  submit(@Param('id', tryoutId) id: string, @Body(new ZodPipe(SubmitTryoutSchema)) dto: SubmitTryoutDto, @GetUser() user: AuthUser) {
    return this.tryouts.submit(user.id, id, dto);
  }

  @Get(':id/result')
  @AuthenticatedOnly()
  result(@Param('id', tryoutId) id: string, @GetUser() user: AuthUser) {
    return this.tryouts.result(user.id, id);
  }
}
