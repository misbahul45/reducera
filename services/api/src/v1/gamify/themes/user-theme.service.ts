import { Injectable } from '@nestjs/common';
import { Prisma, UserTheme } from '@prisma/client';
import { PrismaService } from '@/common/config/prisma/prisma.service';
import { AppError, AppErrorCode } from '@/common/lib/error';
import { atmosphereSchema, themeSchemePairSchema, themeVariantsSchema } from './theme.schema';
import {
  GeneratedUserTheme,
  USER_THEME_MOODS,
  UserThemeInput,
  UserThemeMood,
  assembleUserTheme,
  generateUserTheme,
} from './user-theme-palette';

export interface UserThemeView {
  custom: boolean;
  mood: UserThemeMood[];
  intensity: number | null;
  theme: GeneratedUserTheme | null;
}

const NONE: UserThemeView = { custom: false, mood: [], intensity: null, theme: null };

const knownMoods = (stored: ReadonlyArray<string>): UserThemeMood[] => USER_THEME_MOODS.filter((mood) => stored.includes(mood));

const viewOf = (row: UserTheme | null): UserThemeView => {
  if (!row) return NONE;
  const tokens = themeSchemePairSchema.safeParse(row.tokens);
  const atmosphere = atmosphereSchema.safeParse(row.atmosphere);
  const variants = themeVariantsSchema.safeParse(row.variants);
  const mood = knownMoods(row.mood);
  if (!tokens.success || !atmosphere.success || !variants.success || mood.length === 0) return NONE;

  return {
    custom: true,
    mood,
    intensity: row.intensity,
    theme: assembleUserTheme({
      mood,
      tokens: { light: tokens.data.light, dark: tokens.data.dark },
      atmosphere: atmosphere.data,
      variants: variants.data,
      version: row.generatorVersion,
    }),
  };
};

const viewOfGenerated = (theme: GeneratedUserTheme, intensity: number): UserThemeView => ({ custom: true, mood: theme.mood, intensity, theme });

const generate = (input: UserThemeInput): GeneratedUserTheme => {
  try {
    return generateUserTheme(input);
  } catch (error) {
    if (error instanceof RangeError) throw new AppError(error.message, 400, AppErrorCode.VALIDATION_ERROR);
    throw error;
  }
};

const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

@Injectable()
export class UserThemeService {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string) {
    const row = await this.prisma.userTheme.findUnique({ where: { userId } });
    return { message: 'Your theme', data: viewOf(row) };
  }

  async preview(input: UserThemeInput) {
    return { message: 'Theme preview', data: viewOfGenerated(generate(input), input.intensity) };
  }

  async save(userId: string, input: UserThemeInput) {
    const theme = generate(input);
    const values = {
      mood: theme.mood,
      intensity: input.intensity,
      tokens: json(theme.tokens),
      atmosphere: json(theme.atmosphere),
      variants: json(theme.variants),
      generatorVersion: theme.version,
    };
    await this.prisma.userTheme.upsert({ where: { userId }, create: { userId, ...values }, update: values });
    return { message: 'Theme saved', data: viewOfGenerated(theme, input.intensity) };
  }

  async reset(userId: string) {
    await this.prisma.userTheme.deleteMany({ where: { userId } });
    return { message: 'Theme reset to the default', data: NONE };
  }
}
