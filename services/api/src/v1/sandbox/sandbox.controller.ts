import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { AuthenticatedOnly } from '@/common/authz/access';
import { AuthUser } from '@/common/interfaces/auth.interface';
import { ZodPipe } from '@/common/pipes/zod.pipe';
import { GetUser } from '../auth/auth.decorator';
import {
  CheckJournalDto,
  CheckJournalSchema,
  ListScenariosQuery,
  ListScenariosQuerySchema,
  SandboxGraphSchema,
  ScenarioParamSchema,
  VariantSeedSchema,
} from './dto/sandbox.dto';
import { SandboxContentService } from './sandbox-content.service';
import { SandboxPracticeService } from './sandbox-practice.service';

const scenarioId = new ZodPipe(ScenarioParamSchema.shape.id);
const variantSeed = new ZodPipe(VariantSeedSchema);

@Controller('sandbox')
export class SandboxController {
  constructor(
    private readonly practice: SandboxPracticeService,
    private readonly content: SandboxContentService,
  ) {}

  @Get('scenarios')
  @AuthenticatedOnly()
  list(@Query(new ZodPipe(ListScenariosQuerySchema)) query: ListScenariosQuery, @GetUser() user: AuthUser) {
    return this.practice.catalog(user.id, query);
  }

  @Get('accounts')
  @AuthenticatedOnly()
  accounts() {
    return this.practice.accounts();
  }

  @Get('graph')
  @AuthenticatedOnly()
  graph() {
    return SandboxGraphSchema.parse(this.content.getGraph());
  }

  @Get('signals')
  @AuthenticatedOnly()
  signals(@GetUser() user: AuthUser) {
    return this.practice.signals(user.id);
  }

  @Get('scenarios/:id')
  @AuthenticatedOnly()
  detail(@Param('id', scenarioId) id: string, @GetUser() user: AuthUser) {
    return this.practice.detail(user.id, id);
  }

  @Post('scenarios/:id/check')
  @HttpCode(200)
  @AuthenticatedOnly()
  check(@Param('id', scenarioId) id: string, @Body(new ZodPipe(CheckJournalSchema)) dto: CheckJournalDto, @GetUser() user: AuthUser) {
    return this.practice.check(user.id, id, dto);
  }

  @Post('scenarios/:id/hint')
  @HttpCode(200)
  @AuthenticatedOnly()
  hint(@Param('id', scenarioId) id: string, @GetUser() user: AuthUser) {
    return this.practice.hint(user.id, id);
  }

  @Post('scenarios/:id/reveal')
  @HttpCode(200)
  @AuthenticatedOnly()
  reveal(@Param('id', scenarioId) id: string, @GetUser() user: AuthUser) {
    return this.practice.reveal(user.id, id);
  }

  @Get('scenarios/:id/variants/:seed')
  @AuthenticatedOnly()
  variant(@Param('id', scenarioId) id: string, @Param('seed', variantSeed) seed: number, @GetUser() user: AuthUser) {
    return this.practice.variantDetail(user.id, id, seed);
  }

  @Post('scenarios/:id/variants/:seed/check')
  @HttpCode(200)
  @AuthenticatedOnly()
  checkVariant(
    @Param('id', scenarioId) id: string,
    @Param('seed', variantSeed) seed: number,
    @Body(new ZodPipe(CheckJournalSchema)) dto: CheckJournalDto,
    @GetUser() user: AuthUser,
  ) {
    return this.practice.checkVariant(user.id, id, seed, dto);
  }

  @Post('scenarios/:id/variants/:seed/reveal')
  @HttpCode(200)
  @AuthenticatedOnly()
  revealVariant(@Param('id', scenarioId) id: string, @Param('seed', variantSeed) seed: number, @GetUser() user: AuthUser) {
    return this.practice.revealVariant(user.id, id, seed);
  }
}
