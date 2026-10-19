import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AiClientModule } from '@/common/ai-client/ai-client.module';
import { PrismaModule } from '@/common/config/prisma/prisma.module';
import { AdminOptimizationController } from './admin-optimization.controller';
import { BenchmarkService } from './benchmark/benchmark.service';
import { PromptBenchmarkProcessor } from './benchmark/benchmark.processor';
import { PROMPT_BENCHMARK_QUEUE } from './benchmark/benchmark.types';
import { PROMPT_EVALUATION_QUEUE, PromptEvaluationProcessor } from './prompt-evaluation.processor';
import { PromptEvaluationScheduler } from './prompt-evaluation.scheduler';
import { PromptEvidenceService } from './prompt-evidence';
import { PromptMetricsService } from './prompt-metrics.service';
import { PromptProposalService } from './prompt-proposal.service';
import { PromptRegistryService } from './prompt-registry.service';

@Module({
  imports: [PrismaModule, AiClientModule, BullModule.registerQueue({ name: PROMPT_EVALUATION_QUEUE }, { name: PROMPT_BENCHMARK_QUEUE })],
  controllers: [AdminOptimizationController],
  providers: [
    PromptRegistryService,
    PromptMetricsService,
    PromptEvidenceService,
    PromptProposalService,
    PromptEvaluationProcessor,
    PromptEvaluationScheduler,
    BenchmarkService,
    PromptBenchmarkProcessor,
  ],
  exports: [PromptRegistryService],
})
export class OptimizationModule {}
