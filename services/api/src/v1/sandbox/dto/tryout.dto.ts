import { z } from 'zod';
import { PageParamsSchema } from '../paging';
import { SUBTEST_KEYS } from '../tryout/tryout-types';

const MAX_ITEMS = 160;

export const TryoutPlanSchema = z
  .object({
    examKey: z.literal('utbk-snbt'),
    subtests: z
      .array(
        z
          .object({
            key: z.enum(SUBTEST_KEYS),
            count: z.number().int().min(1).max(MAX_ITEMS),
          })
          .strict(),
      )
      .min(1)
      .max(SUBTEST_KEYS.length),
  })
  .strict();
export type TryoutPlanDto = z.infer<typeof TryoutPlanSchema>;

const AnswersSchema = z
  .record(z.string().regex(/^q\d{1,3}$/), z.number().int().min(0).max(4).nullable())
  .refine((answers) => Object.keys(answers).length <= MAX_ITEMS, { message: 'Too many answers' });

export const SaveAnswersSchema = z.object({ answers: AnswersSchema }).strict();
export type SaveAnswersDto = z.infer<typeof SaveAnswersSchema>;

export const SubmitTryoutSchema = z.object({ answers: AnswersSchema.optional() }).strict();
export type SubmitTryoutDto = z.infer<typeof SubmitTryoutSchema>;

export const TryoutIdSchema = z.string().uuid();

export const SCORE_BANDS = ['SANGAT_BAIK', 'BAIK', 'CUKUP', 'LATIH'] as const;
export type ScoreBand = (typeof SCORE_BANDS)[number];

export const HISTORY_SORTS = ['NEWEST', 'OLDEST', 'HIGHEST', 'LOWEST'] as const;
export type HistorySort = (typeof HISTORY_SORTS)[number];

export const TryoutHistoryQuerySchema = z
  .object({
    band: z.enum(SCORE_BANDS).optional(),
    subtest: z.enum(SUBTEST_KEYS).optional(),
    sort: z.enum(HISTORY_SORTS).default('NEWEST'),
    ...PageParamsSchema,
  })
  .strict();
export type TryoutHistoryQuery = z.infer<typeof TryoutHistoryQuerySchema>;
