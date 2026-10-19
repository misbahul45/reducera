import { z } from 'zod';
import { BENCHMARK_DATASET, DEVELOPMENT_DATASET } from './benchmark/benchmark-dataset';
import { PROMPT_NAMES } from './prompt-contracts';

export const ProposePromptDto = z
  .object({
    name: z.enum(PROMPT_NAMES),
    body: z.string().min(1).max(40000),
    modelName: z.string().min(1).max(100).default('router-default'),
    temperature: z.number().min(0).max(2).optional(),
    parentVersionId: z.string().uuid().optional(),
    rationale: z.string().min(3).max(1000),
  })
  .strict();
export type ProposePromptDtoType = z.infer<typeof ProposePromptDto>;

export const StartCanaryDto = z
  .object({
    percent: z.number().int().min(1).max(50),
    reason: z.string().min(3).max(500),
  })
  .strict();
export type StartCanaryDtoType = z.infer<typeof StartCanaryDto>;

export const ApprovePromptDto = z
  .object({
    reason: z.string().min(3).max(500),
    acknowledgeUnmeasured: z.literal(true),
  })
  .strict();
export type ApprovePromptDtoType = z.infer<typeof ApprovePromptDto>;

export const PromptReasonDto = z.object({ reason: z.string().min(3).max(500) }).strict();
export type PromptReasonDtoType = z.infer<typeof PromptReasonDto>;

export const PromptListQueryDto = z.object({ name: z.enum(PROMPT_NAMES).optional() });
export type PromptListQueryDtoType = z.infer<typeof PromptListQueryDto>;

export const ResolvePromptQueryDto = z.object({ name: z.enum(PROMPT_NAMES) });
export type ResolvePromptQueryDtoType = z.infer<typeof ResolvePromptQueryDto>;

export const ProposeImprovementDto = z.object({ name: z.enum(PROMPT_NAMES) }).strict();
export type ProposeImprovementDtoType = z.infer<typeof ProposeImprovementDto>;

export const StartBenchmarkDto = z
  .object({
    name: z.enum(PROMPT_NAMES),
    candidatePromptId: z.string().uuid().optional(),
    datasetName: z.enum([BENCHMARK_DATASET, DEVELOPMENT_DATASET]).default(BENCHMARK_DATASET),
    repeats: z.number().int().min(1).max(5).default(1),
    judge: z.boolean().default(true),
  })
  .strict();
export type StartBenchmarkDtoType = z.infer<typeof StartBenchmarkDto>;

export const BenchmarkDecisionDto = z
  .object({
    decision: z.enum(['ACCEPTED', 'REJECTED', 'DEFERRED']),
    rationale: z.string().min(10).max(1000),
  })
  .strict();
export type BenchmarkDecisionDtoType = z.infer<typeof BenchmarkDecisionDto>;
