import { z } from 'zod';

const reason = z.string().trim().min(3).max(500);

export const ReasonDto = z.object({ reason }).strict();
export type ReasonDtoType = z.infer<typeof ReasonDto>;

export const PublishRuleDto = z
  .object({
    baseVersion: z.number().int().min(1),
    values: z.record(z.string().min(1).max(40), z.number()),
    reason,
  })
  .strict();
export type PublishRuleDtoType = z.infer<typeof PublishRuleDto>;

export const RuleVersionParam = z.coerce.number().int().min(1);

export const ReplaceLevelsDto = z
  .object({
    baseFingerprint: z.string().min(1).max(64),
    levels: z.array(z.object({ level: z.number().int(), xp: z.number().int() }).strict()).max(100),
    reason,
  })
  .strict();
export type ReplaceLevelsDtoType = z.infer<typeof ReplaceLevelsDto>;
