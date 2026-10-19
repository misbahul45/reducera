import { AchievementType } from '@prisma/client';
import { z } from 'zod';
import { ACHIEVEMENT_METRICS, AchievementMetric } from '../achievements/achievement-rule';
import { THEME_ICON_NAMES } from '../themes/theme-icons';

export interface MetricSpec {
  metric: AchievementMetric;
  label: string;
  unit: string;
  max: number;
  type: AchievementType;
}

export const ACHIEVEMENT_METRIC_SPECS: ReadonlyArray<MetricSpec> = [
  { metric: 'ASSESSMENTS_COMPLETED', label: 'Penilaian selesai', unit: 'penilaian', max: 10_000, type: 'QUIZ' },
  { metric: 'CONCEPTS_PASSED', label: 'Konsep lulus', unit: 'konsep', max: 1_000, type: 'SCORE' },
  { metric: 'NODES_MASTERED', label: 'Sub-topik dikuasai', unit: 'sub-topik', max: 1_000, type: 'TOPIC' },
  { metric: 'STREAK_DAYS', label: 'Hari streak', unit: 'hari', max: 3_650, type: 'STREAK' },
  { metric: 'LEVEL', label: 'Level', unit: 'level', max: 30, type: 'PARTICIPATION' },
  { metric: 'XP_TOTAL', label: 'Total XP', unit: 'XP', max: 10_000_000, type: 'PARTICIPATION' },
];

const specOf = (metric: AchievementMetric): MetricSpec => ACHIEVEMENT_METRIC_SPECS.find((spec) => spec.metric === metric) as MetricSpec;

export const achievementTypeFor = (metric: AchievementMetric): AchievementType => specOf(metric).type;

const code = z.string().min(3).max(40).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const title = z.string().trim().min(3).max(60);
const description = z.string().trim().min(10).max(240);
const iconName = z.enum(THEME_ICON_NAMES);
const sortOrder = z.number().int().min(0).max(10_000);
const reason = z.string().trim().min(3).max(500);

const ruleSchema = z
  .object({ metric: z.enum(ACHIEVEMENT_METRICS), value: z.number().int().min(1) })
  .strict()
  .superRefine((rule, ctx) => {
    const max = specOf(rule.metric).max;
    if (rule.value > max) ctx.addIssue({ code: 'custom', path: ['value'], message: `At most ${max} for ${rule.metric}` });
  });

export const createAchievementSchema = z.object({ code, title, description, iconName, rule: ruleSchema, sortOrder, reason }).strict();
export type CreateAchievementInput = z.infer<typeof createAchievementSchema>;

export const updateAchievementSchema = z
  .object({
    title: title.optional(),
    description: description.optional(),
    iconName: iconName.optional(),
    sortOrder: sortOrder.optional(),
    reason,
  })
  .strict()
  .refine((patch) => patch.title !== undefined || patch.description !== undefined || patch.iconName !== undefined || patch.sortOrder !== undefined, {
    message: 'Change at least one of title, description, iconName or sortOrder',
  });
export type UpdateAchievementInput = z.infer<typeof updateAchievementSchema>;
