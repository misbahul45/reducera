import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { TraceId } from '@/common/authz/trace-id.decorator';
import { AuthUser } from '@/common/interfaces/auth.interface';
import { ZodPipe } from '@/common/pipes/zod.pipe';
import { GetUser, Roles } from '../auth/auth.decorator';
import { BenchmarkService } from './benchmark/benchmark.service';
import {
  ApprovePromptDto,
  ApprovePromptDtoType,
  BenchmarkDecisionDto,
  BenchmarkDecisionDtoType,
  StartBenchmarkDto,
  StartBenchmarkDtoType,
  ProposeImprovementDto,
  ProposeImprovementDtoType,
  ProposePromptDto,
  ProposePromptDtoType,
  PromptListQueryDto,
  PromptListQueryDtoType,
  PromptReasonDto,
  PromptReasonDtoType,
  ResolvePromptQueryDto,
  ResolvePromptQueryDtoType,
  StartCanaryDto,
  StartCanaryDtoType,
} from './optimization.dto';
import { PromptProposalService } from './prompt-proposal.service';
import { PromptRegistryService } from './prompt-registry.service';

@Controller('admin/optimization')
export class AdminOptimizationController {
  constructor(
    private readonly registry: PromptRegistryService,
    private readonly proposals: PromptProposalService,
    private readonly benchmarks: BenchmarkService,
  ) {}

  @Roles(Role.ADMIN)
  @Post('benchmarks')
  startBenchmark(@Body(new ZodPipe(StartBenchmarkDto)) dto: StartBenchmarkDtoType, @GetUser() user: AuthUser, @TraceId() traceId: string) {
    return this.benchmarks.start(user, dto, traceId);
  }

  @Roles(Role.ADMIN)
  @Get('benchmarks')
  listBenchmarks(@GetUser() user: AuthUser) {
    return this.benchmarks.list(user);
  }

  @Roles(Role.ADMIN)
  @Get('benchmarks/:id')
  benchmark(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: AuthUser) {
    return this.benchmarks.detail(user, id);
  }

  @Roles(Role.ADMIN)
  @Get('benchmarks/:id/cases/:caseId')
  benchmarkCase(@Param('id', ParseUUIDPipe) id: string, @Param('caseId') caseId: string, @GetUser() user: AuthUser) {
    return this.benchmarks.caseDetail(user, id, caseId);
  }

  @Roles(Role.ADMIN)
  @Post('benchmarks/:id/propose-improvement')
  proposeFromBenchmark(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: AuthUser, @TraceId() traceId: string) {
    return this.proposals.proposeFromBenchmark(user, id, traceId);
  }

  @Roles(Role.ADMIN)
  @Post('benchmarks/:id/decision')
  decideBenchmark(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(BenchmarkDecisionDto)) dto: BenchmarkDecisionDtoType,
    @GetUser() user: AuthUser,
    @TraceId() traceId: string,
  ) {
    return this.registry.decideBenchmarkRun(user, id, dto, traceId);
  }

  @Roles(Role.ADMIN)
  @Get('prompts')
  list(@Query(new ZodPipe(PromptListQueryDto)) query: PromptListQueryDtoType, @GetUser() user: AuthUser) {
    return this.registry.list(user, query.name);
  }

  @Roles(Role.ADMIN)
  @Get('prompts/builtin')
  builtin(@Query(new ZodPipe(ResolvePromptQueryDto)) query: ResolvePromptQueryDtoType, @GetUser() user: AuthUser) {
    return this.registry.builtin(user, query.name);
  }

  @Roles(Role.ADMIN)
  @Get('runs')
  runs(@GetUser() user: AuthUser) {
    return this.registry.runs(user);
  }

  @Roles(Role.ADMIN)
  @Post('prompts')
  propose(@Body(new ZodPipe(ProposePromptDto)) dto: ProposePromptDtoType, @GetUser() user: AuthUser, @TraceId() traceId: string) {
    return this.registry.propose(user, dto, traceId);
  }

  @Roles(Role.ADMIN)
  @Post('prompts/propose-improvement')
  proposeImprovement(@Body(new ZodPipe(ProposeImprovementDto)) dto: ProposeImprovementDtoType, @GetUser() user: AuthUser, @TraceId() traceId: string) {
    return this.proposals.proposeImprovement(user, dto, traceId);
  }

  @Roles(Role.ADMIN)
  @Post('prompts/:id/canary')
  startCanary(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(StartCanaryDto)) dto: StartCanaryDtoType,
    @GetUser() user: AuthUser,
    @TraceId() traceId: string,
  ) {
    return this.registry.startCanary(user, id, dto, traceId);
  }

  @Roles(Role.ADMIN)
  @Post('prompts/:id/evaluate')
  evaluate(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: AuthUser, @TraceId() traceId: string) {
    return this.registry.evaluate(user, id, traceId);
  }

  @Roles(Role.ADMIN)
  @Post('prompts/:id/approve')
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(ApprovePromptDto)) dto: ApprovePromptDtoType,
    @GetUser() user: AuthUser,
    @TraceId() traceId: string,
  ) {
    return this.registry.approve(user, id, dto, traceId);
  }

  @Roles(Role.ADMIN)
  @Post('prompts/:id/reject')
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(PromptReasonDto)) dto: PromptReasonDtoType,
    @GetUser() user: AuthUser,
    @TraceId() traceId: string,
  ) {
    return this.registry.reject(user, id, dto.reason, traceId);
  }

  @Roles(Role.ADMIN)
  @Post('prompts/:id/rollback')
  rollback(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(PromptReasonDto)) dto: PromptReasonDtoType,
    @GetUser() user: AuthUser,
    @TraceId() traceId: string,
  ) {
    return this.registry.rollback(user, id, dto.reason, traceId);
  }
}
