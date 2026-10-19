import { z } from 'zod';

export const CircularityQueryDto = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .strict();
export type CircularityQueryDtoType = z.infer<typeof CircularityQueryDto>;
