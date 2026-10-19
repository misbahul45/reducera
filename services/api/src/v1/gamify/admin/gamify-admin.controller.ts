import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { TraceId } from '@/common/authz/trace-id.decorator';
import { AuthUser } from '@/common/interfaces/auth.interface';
import { ZodPipe } from '@/common/pipes/zod.pipe';
import { GetUser, Roles } from '@/v1/auth/auth.decorator';
import { CreateAchievementInput, UpdateAchievementInput, createAchievementSchema, updateAchievementSchema } from './achievement-authoring';
import { AchievementsAdminService } from './achievements-admin.service';
import { PublishRuleDto, PublishRuleDtoType, ReasonDto, ReasonDtoType, ReplaceLevelsDto, ReplaceLevelsDtoType, RuleVersionParam } from './gamify-admin.dto';
import { LevelsAdminService } from './levels-admin.service';
import { RulesAdminService } from './rules-admin.service';

@Controller('admin/gamify')
export class GamifyAdminController {
  constructor(
    private readonly rules: RulesAdminService,
    private readonly levels: LevelsAdminService,
    private readonly achievements: AchievementsAdminService,
  ) {}

  @Roles(Role.ADMIN)
  @Get('rules')
  listRules(@GetUser() user: AuthUser) {
    return this.rules.list(user);
  }

  @Roles(Role.ADMIN)
  @Post('rules/:code/versions')
  publishRule(
    @Param('code') code: string,
    @Body(new ZodPipe(PublishRuleDto)) dto: PublishRuleDtoType,
    @GetUser() user: AuthUser,
    @TraceId() traceId: string,
  ) {
    return this.rules.publish(user, code, dto, traceId);
  }

  @Roles(Role.ADMIN)
  @Post('rules/:code/versions/:version/activate')
  @HttpCode(200)
  activateRule(
    @Param('code') code: string,
    @Param('version', new ZodPipe(RuleVersionParam)) version: number,
    @Body(new ZodPipe(ReasonDto)) dto: ReasonDtoType,
    @GetUser() user: AuthUser,
    @TraceId() traceId: string,
  ) {
    return this.rules.activate(user, code, version, dto, traceId);
  }

  @Roles(Role.ADMIN)
  @Post('rules/:code/deactivate')
  @HttpCode(200)
  deactivateRule(@Param('code') code: string, @Body(new ZodPipe(ReasonDto)) dto: ReasonDtoType, @GetUser() user: AuthUser, @TraceId() traceId: string) {
    return this.rules.deactivate(user, code, dto, traceId);
  }

  @Roles(Role.ADMIN)
  @Get('levels')
  listLevels(@GetUser() user: AuthUser) {
    return this.levels.list(user);
  }

  @Roles(Role.ADMIN)
  @Post('levels/replace')
  @HttpCode(200)
  replaceLevels(@Body(new ZodPipe(ReplaceLevelsDto)) dto: ReplaceLevelsDtoType, @GetUser() user: AuthUser, @TraceId() traceId: string) {
    return this.levels.replace(user, dto, traceId);
  }

  @Roles(Role.ADMIN)
  @Get('achievements')
  listAchievements(@GetUser() user: AuthUser) {
    return this.achievements.list(user);
  }

  @Roles(Role.ADMIN)
  @Post('achievements')
  createAchievement(@Body(new ZodPipe(createAchievementSchema)) dto: CreateAchievementInput, @GetUser() user: AuthUser, @TraceId() traceId: string) {
    return this.achievements.create(user, dto, traceId);
  }

  @Roles(Role.ADMIN)
  @Patch('achievements/:code')
  updateAchievement(
    @Param('code') code: string,
    @Body(new ZodPipe(updateAchievementSchema)) dto: UpdateAchievementInput,
    @GetUser() user: AuthUser,
    @TraceId() traceId: string,
  ) {
    return this.achievements.update(user, code, dto, traceId);
  }

  @Roles(Role.ADMIN)
  @Post('achievements/:code/activate')
  @HttpCode(200)
  activateAchievement(@Param('code') code: string, @Body(new ZodPipe(ReasonDto)) dto: ReasonDtoType, @GetUser() user: AuthUser, @TraceId() traceId: string) {
    return this.achievements.activate(user, code, dto, traceId);
  }

  @Roles(Role.ADMIN)
  @Post('achievements/:code/deactivate')
  @HttpCode(200)
  deactivateAchievement(@Param('code') code: string, @Body(new ZodPipe(ReasonDto)) dto: ReasonDtoType, @GetUser() user: AuthUser, @TraceId() traceId: string) {
    return this.achievements.deactivate(user, code, dto, traceId);
  }
}
