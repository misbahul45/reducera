import { z } from 'zod';
import { MAX_RUPIAH } from '../engine';
import { PageParamsSchema } from '../paging';

export const MAX_JOURNAL_LINES = 12;
export const SCENARIO_ID_PATTERN = /^[a-z0-9-]{3,80}$/;

export const PRACTICE_STATUSES = ['NEW', 'IN_PROGRESS', 'SOLVED'] as const;
export type PracticeStatusFilter = (typeof PRACTICE_STATUSES)[number];

export const ListScenariosQuerySchema = z.object({
  level: z.coerce.number().int().min(1).max(4).optional(),
  conceptId: z.string().min(1).max(100).optional(),
  difficulty: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']).optional(),
  tag: z.string().min(1).max(40).optional(),
  status: z.enum(PRACTICE_STATUSES).optional(),
  q: z.string().trim().min(1).max(60).optional(),
  ...PageParamsSchema,
});
export type ListScenariosQuery = z.infer<typeof ListScenariosQuerySchema>;

export const ScenarioParamSchema = z.object({ id: z.string().regex(SCENARIO_ID_PATTERN) });

export const MAX_VARIANT_SEED = 999_999;

export const VariantSeedSchema = z.coerce.number().int().min(1).max(MAX_VARIANT_SEED);

export const JournalLineSchema = z.object({
  account: z.string().regex(/^\d{3}$/),
  side: z.enum(['DEBIT', 'CREDIT']),
  amount: z.number().int().min(1).max(MAX_RUPIAH),
});

export const CheckJournalSchema = z.object({
  lines: z.array(JournalLineSchema).min(1).max(MAX_JOURNAL_LINES),
});
export type CheckJournalDto = z.infer<typeof CheckJournalSchema>;

export const SandboxGraphSchema = z.object({
  levels: z.array(
    z.object({
      id: z.number().int().min(1).max(4),
      title: z.string(),
      topics: z.array(
        z.object({
          id: z.string(),
          title: z.string(),
          description: z.string().optional(),
          prerequisites: z.array(z.string()).default([]),
          estimatedMinutes: z.number().int().positive().optional(),
        }),
      ),
    }),
  ),
});
export type SandboxGraph = z.infer<typeof SandboxGraphSchema>;
