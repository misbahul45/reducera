import { ACHIEVEMENT_METRICS } from '../../achievements/achievement-rule';
import { THEME_ICON_NAMES } from '../../themes/theme-icons';
import { DEFAULT_ACHIEVEMENTS } from '../../seed/default-catalog';
import { ACHIEVEMENT_METRIC_SPECS, achievementTypeFor, createAchievementSchema, updateAchievementSchema } from '../achievement-authoring';

const valid = {
  code: 'streak-14',
  title: 'Dua Minggu Penuh',
  description: 'Pertahankan streak empat belas hari berturut-turut.',
  iconName: 'streak',
  rule: { metric: 'STREAK_DAYS', value: 14 },
  sortOrder: 85,
};

describe('metric specs', () => {
  it('describe every metric the evaluator knows and no other', () => {
    expect(ACHIEVEMENT_METRIC_SPECS.map((m) => m.metric).sort()).toEqual([...ACHIEVEMENT_METRICS].sort());
  });

  it('give each metric a label, a unit and a bound', () => {
    for (const spec of ACHIEVEMENT_METRIC_SPECS) {
      expect(spec.label.length).toBeGreaterThan(0);
      expect(spec.unit.length).toBeGreaterThan(0);
      expect(spec.max).toBeGreaterThanOrEqual(1);
    }
  });

  it('derive the type the seed catalog gave each achievement, so the two never disagree', () => {
    for (const seeded of DEFAULT_ACHIEVEMENTS) {
      expect(achievementTypeFor(seeded.rule.metric)).toBe(seeded.type);
    }
  });
});

describe('createAchievementSchema', () => {
  it('accepts a complete achievement', () => {
    expect(createAchievementSchema.safeParse({ ...valid, reason: 'a new goal for the second week' }).success).toBe(true);
  });

  it('accepts every icon of the vocabulary and refuses any other name', () => {
    for (const iconName of THEME_ICON_NAMES) {
      expect(createAchievementSchema.safeParse({ ...valid, iconName, reason: 'because' }).success).toBe(true);
    }
    expect(createAchievementSchema.safeParse({ ...valid, iconName: 'rocket', reason: 'because' }).success).toBe(false);
  });

  it('refuses a code that is not lower-case words joined by hyphens', () => {
    for (const code of ['Streak-14', 'streak_14', 'streak 14', '-streak', 'streak-', 'a', 'x'.repeat(41), '', 'streak--14']) {
      expect(createAchievementSchema.safeParse({ ...valid, code, reason: 'because' }).success).toBe(false);
    }
    expect(createAchievementSchema.safeParse({ ...valid, code: 'level-15', reason: 'because' }).success).toBe(true);
  });

  it('bounds the texts and the order', () => {
    expect(createAchievementSchema.safeParse({ ...valid, title: 'ab', reason: 'because' }).success).toBe(false);
    expect(createAchievementSchema.safeParse({ ...valid, title: 'x'.repeat(61), reason: 'because' }).success).toBe(false);
    expect(createAchievementSchema.safeParse({ ...valid, description: 'short', reason: 'because' }).success).toBe(false);
    expect(createAchievementSchema.safeParse({ ...valid, description: 'x'.repeat(241), reason: 'because' }).success).toBe(false);
    expect(createAchievementSchema.safeParse({ ...valid, sortOrder: -1, reason: 'because' }).success).toBe(false);
    expect(createAchievementSchema.safeParse({ ...valid, sortOrder: 10001, reason: 'because' }).success).toBe(false);
    expect(createAchievementSchema.safeParse({ ...valid, sortOrder: 1.5, reason: 'because' }).success).toBe(false);
  });

  it('bounds the target by what the metric can reach', () => {
    const level = (value: number) => createAchievementSchema.safeParse({ ...valid, rule: { metric: 'LEVEL', value }, reason: 'because' }).success;
    expect([level(0), level(1), level(30), level(31)]).toEqual([false, true, true, false]);
    expect(createAchievementSchema.safeParse({ ...valid, rule: { metric: 'STREAK_DAYS', value: 3650 }, reason: 'because' }).success).toBe(true);
    expect(createAchievementSchema.safeParse({ ...valid, rule: { metric: 'STREAK_DAYS', value: 3651 }, reason: 'because' }).success).toBe(false);
    expect(createAchievementSchema.safeParse({ ...valid, rule: { metric: 'STREAK_DAYS', value: 2.5 }, reason: 'because' }).success).toBe(false);
  });

  it('refuses an unknown metric and any field it does not know, including the type and the operator', () => {
    expect(createAchievementSchema.safeParse({ ...valid, rule: { metric: 'LOGINS', value: 5 }, reason: 'because' }).success).toBe(false);
    expect(createAchievementSchema.safeParse({ ...valid, type: 'STREAK', reason: 'because' }).success).toBe(false);
    expect(createAchievementSchema.safeParse({ ...valid, active: false, reason: 'because' }).success).toBe(false);
    expect(createAchievementSchema.safeParse({ ...valid, rule: { metric: 'STREAK_DAYS', value: 14, op: '<=' }, reason: 'because' }).success).toBe(false);
  });

  it('needs a reason', () => {
    expect(createAchievementSchema.safeParse(valid).success).toBe(false);
    expect(createAchievementSchema.safeParse({ ...valid, reason: 'no' }).success).toBe(false);
  });
});

describe('updateAchievementSchema', () => {
  it('accepts any presentation field alone, with a reason', () => {
    for (const patch of [{ title: 'Judul Baru' }, { description: 'Deskripsi yang baru dan cukup panjang.' }, { iconName: 'trophy' }, { sortOrder: 5 }]) {
      expect(updateAchievementSchema.safeParse({ ...patch, reason: 'wording' }).success).toBe(true);
    }
  });

  it('refuses an update that changes nothing', () => {
    expect(updateAchievementSchema.safeParse({ reason: 'wording' }).success).toBe(false);
  });

  it('refuses the rule, the code, the type and the state, which an update never changes', () => {
    for (const patch of [{ rule: { metric: 'LEVEL', value: 3 } }, { code: 'other-code' }, { type: 'QUIZ' }, { active: false }]) {
      expect(updateAchievementSchema.safeParse({ title: 'Judul Baru', ...patch, reason: 'wording' }).success).toBe(false);
    }
  });

  it('holds the same bounds as a creation', () => {
    expect(updateAchievementSchema.safeParse({ title: 'ab', reason: 'wording' }).success).toBe(false);
    expect(updateAchievementSchema.safeParse({ iconName: 'rocket', reason: 'wording' }).success).toBe(false);
    expect(updateAchievementSchema.safeParse({ sortOrder: -3, reason: 'wording' }).success).toBe(false);
  });
});
