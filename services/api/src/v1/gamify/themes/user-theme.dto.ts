import { z } from 'zod';
import { USER_THEME_MAX_INTENSITY, USER_THEME_MAX_MOODS, USER_THEME_MOODS } from './user-theme-palette';

export const UserThemeDto = z
  .object({
    mood: z
      .array(z.enum(USER_THEME_MOODS))
      .min(1)
      .max(USER_THEME_MAX_MOODS)
      .refine((moods) => new Set(moods).size === moods.length, { message: 'Moods must be different from each other' }),
    intensity: z.number().int().min(0).max(USER_THEME_MAX_INTENSITY),
  })
  .strict();

export type UserThemeDtoType = z.infer<typeof UserThemeDto>;
