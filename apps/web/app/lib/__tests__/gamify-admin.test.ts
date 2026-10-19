import { describe, expect, it } from 'vitest';
import type { GamifyMetricSpec, GamifyRuleField, GamifyRuleView } from '~/interfaces/admin';
import {
  ACHIEVEMENT_CODE_PATTERN,
  achievementPatch,
  achievementProblems,
  changedFields,
  fieldProblem,
  formatFieldValue,
  ladderPreview,
  levelAt,
  parseNumber,
  rawFromValues,
  readLadder,
  readValues,
  ruleSentence,
  ruleStatus,
  suggestNextXp,
  targetLabel,
} from '~/lib/gamify-admin';

const whole = (overrides: Partial<GamifyRuleField> = {}): GamifyRuleField => ({
  key: 'points', target: 'amount', label: 'XP lulus', hint: 'h', unit: 'XP', min: 1, max: 1000, step: 1, integer: true, ...overrides,
});
const fraction = whole({ key: 'baseline', target: 'param', label: 'Ambang skor', unit: 'skor', min: 0, max: 0.95, step: 0.05, integer: false });

const metrics: GamifyMetricSpec[] = [
  { metric: 'STREAK_DAYS', label: 'Hari streak', unit: 'hari', max: 3650, type: 'STREAK' },
  { metric: 'LEVEL', label: 'Level', unit: 'level', max: 30, type: 'PARTICIPATION' },
];
const icons = ['streak', 'trophy', 'level'];

describe('parseNumber', () => {
  it('reads whole numbers, decimals with a dot or a comma, and nothing else', () => {
    expect(parseNumber('50')).toBe(50);
    expect(parseNumber(' 0,25 ')).toBe(0.25);
    expect(parseNumber('0.25')).toBe(0.25);
    for (const bad of ['', '  ', 'abc', '1e', '1.000.000', 'Infinity', '--1']) expect(parseNumber(bad)).toBeNull();
  });
});

describe('fieldProblem', () => {
  it('accepts a value inside the bounds, both ends included', () => {
    expect(fieldProblem(whole(), '1')).toBeNull();
    expect(fieldProblem(whole(), '1000')).toBeNull();
    expect(fieldProblem(fraction, '0,95')).toBeNull();
    expect(fieldProblem(fraction, '0')).toBeNull();
  });

  it('says why a value is refused, in Indonesian', () => {
    expect(fieldProblem(whole(), '')).toBe('Isi angka.');
    expect(fieldProblem(whole(), 'abc')).toBe('Isi angka yang valid.');
    expect(fieldProblem(whole(), '7,5')).toBe('Harus bilangan bulat.');
    expect(fieldProblem(whole(), '0')).toBe('Minimal 1.');
    expect(fieldProblem(whole(), '1001')).toBe('Maksimal 1000.');
    expect(fieldProblem(fraction, '1')).toBe('Maksimal 0,95.');
    expect(fieldProblem(fraction, '-0,1')).toBe('Minimal 0.');
  });
});

describe('readValues', () => {
  const fields = [whole({ key: 'points' }), whole({ key: 'every', target: 'param', min: 1, max: 365 })];

  it('returns the numbers when every field is valid', () => {
    expect(readValues(fields, { points: '70', every: '14' })).toEqual({ ok: true, values: { points: 70, every: 14 }, problems: {} });
  });

  it('names the fields that are not', () => {
    const result = readValues(fields, { points: '0', every: '' });

    expect(result.ok).toBe(false);
    expect(result.problems).toEqual({ points: 'Minimal 1.', every: 'Isi angka.' });
  });

  it('treats a field that is missing from the form as empty', () => {
    expect(readValues(fields, { points: '70' }).problems).toEqual({ every: 'Isi angka.' });
  });
});

describe('rawFromValues and changedFields', () => {
  const fields = [whole({ key: 'points' }), fraction];

  it('writes decimals with a comma, the way people type them, and reads them back', () => {
    const raw = rawFromValues(fields, { points: 50, baseline: 0.5 });

    expect(raw).toEqual({ points: '50', baseline: '0,5' });
    expect(readValues(fields, raw).values).toEqual({ points: 50, baseline: 0.5 });
  });

  it('lists the fields that differ', () => {
    expect(changedFields(fields, { points: 50, baseline: 0.5 }, { points: 50, baseline: 0.5 })).toEqual([]);
    expect(changedFields(fields, { points: 50, baseline: 0.5 }, { points: 60, baseline: 0.5 })).toEqual(['points']);
    expect(changedFields(fields, { points: 50, baseline: 0.5 }, { points: 60, baseline: 0.4 })).toEqual(['points', 'baseline']);
  });
});

describe('formatFieldValue', () => {
  it('shows the value with its unit and a decimal comma', () => {
    expect(formatFieldValue(whole(), 50)).toBe('50 XP');
    expect(formatFieldValue(fraction, 0.5)).toBe('0,5 skor');
  });
});

describe('ruleStatus', () => {
  const rule = (overrides: Partial<GamifyRuleView>): GamifyRuleView => ({
    code: 'CONCEPT_PASSED', label: 'Konsep lulus', summary: 's', eventType: 'ASSESSMENT_COMPLETED', rewardKind: 'XP',
    fields: [whole()], inForce: { version: 2, builtin: false, values: { points: 80 } }, latestVersion: 2, versions: [], ...overrides,
  });

  it('says which version is in force', () => {
    expect(ruleStatus(rule({}))).toEqual({ label: 'Aktif · versi 2', tone: 'success' });
  });

  it('marks the built-in default and a rule that is off', () => {
    expect(ruleStatus(rule({ inForce: { version: 1, builtin: true, values: { points: 50 } } }))).toEqual({ label: 'Bawaan · versi 1', tone: 'neutral' });
    expect(ruleStatus(rule({ inForce: null }))).toEqual({ label: 'Mati', tone: 'error' });
  });
});

describe('ruleSentence', () => {
  it('lists the values of a version with their labels', () => {
    const fields = [whole({ key: 'points', label: 'XP bonus' }), whole({ key: 'every', target: 'param', label: 'Setiap berapa hari', unit: 'hari', max: 365 })];

    expect(ruleSentence(fields, { points: 70, every: 14 })).toBe('XP bonus 70 XP · Setiap berapa hari 14 hari');
  });
});

describe('readLadder', () => {
  it('numbers the levels from 1 and accepts a valid ladder', () => {
    expect(readLadder(['0', '100', '250'])).toEqual({ rows: [{ level: 1, xp: 0 }, { level: 2, xp: 100 }, { level: 3, xp: 250 }], problems: [] });
  });

  it('refuses a ladder that is too short or too long', () => {
    expect(readLadder(['0']).problems).toEqual(['Tangga butuh minimal 2 level.']);
    expect(readLadder(Array.from({ length: 31 }, (_, i) => String(i * 10))).problems).toEqual(['Tangga paling banyak 30 level.']);
  });

  it('refuses a first level above zero, because a new learner would have no level', () => {
    expect(readLadder(['10', '100']).problems).toEqual(['Level 1 harus mulai dari 0 XP.']);
  });

  it('names the level whose XP does not rise', () => {
    expect(readLadder(['0', '100', '100']).problems).toEqual(['Level 3 butuh XP lebih besar dari level 2.']);
    expect(readLadder(['0', '200', '100', '300']).problems).toEqual(['Level 3 butuh XP lebih besar dari level 2.']);
  });

  it('names the level whose XP is not a whole number in range', () => {
    expect(readLadder(['0', '']).problems).toEqual(['Level 2: isi XP dengan bilangan bulat dari 0 sampai 10000000.']);
    expect(readLadder(['0', '10,5']).problems).toEqual(['Level 2: isi XP dengan bilangan bulat dari 0 sampai 10000000.']);
    expect(readLadder(['0', '10000001']).problems).toEqual(['Level 2: isi XP dengan bilangan bulat dari 0 sampai 10000000.']);
  });

  it('returns no rows while any problem stands', () => {
    expect(readLadder(['0', 'x']).rows).toBeNull();
  });
});

describe('suggestNextXp', () => {
  it('repeats the last step, and starts at 100 when there is only one level', () => {
    expect(suggestNextXp(['0', '100', '250'])).toBe('400');
    expect(suggestNextXp(['0'])).toBe('100');
    expect(suggestNextXp([])).toBe('0');
  });

  it('falls back to a step of 100 when the last values are not usable', () => {
    expect(suggestNextXp(['0', 'x'])).toBe('100');
  });
});

describe('levelAt and ladderPreview', () => {
  const before = [{ level: 1, xp: 0 }, { level: 2, xp: 100 }, { level: 3, xp: 300 }];
  const after = [{ level: 1, xp: 0 }, { level: 2, xp: 200 }, { level: 3, xp: 250 }];

  it('finds the highest level whose XP the learner has reached', () => {
    expect([levelAt(before, 0), levelAt(before, 99), levelAt(before, 100), levelAt(before, 299), levelAt(before, 300), levelAt(before, 9999)]).toEqual([1, 1, 2, 2, 3, 3]);
  });

  it('shows what a learner with sample XP would see before and after, and which way it moves', () => {
    expect(ladderPreview(before, after, [50, 150, 260, 500])).toEqual([
      { xp: 50, before: 1, after: 1, change: 'same' },
      { xp: 150, before: 2, after: 1, change: 'down' },
      { xp: 260, before: 2, after: 3, change: 'up' },
      { xp: 500, before: 3, after: 3, change: 'same' },
    ]);
  });
});

describe('achievement drafts', () => {
  const draft = { code: 'streak-14', title: 'Dua Minggu Penuh', description: 'Pertahankan streak empat belas hari berturut-turut.', iconName: 'streak', metric: 'STREAK_DAYS', target: '14', sortOrder: '85' };

  it('accepts a complete draft', () => {
    expect(achievementProblems(draft, metrics, icons)).toEqual({});
  });

  it('keeps the same code pattern as the server', () => {
    for (const ok of ['streak-14', 'level-5', 'abc']) expect(ACHIEVEMENT_CODE_PATTERN.test(ok)).toBe(true);
    for (const bad of ['Streak-14', 'streak_14', '-a', 'a-', 'a--b', 'ab']) expect(ACHIEVEMENT_CODE_PATTERN.test(bad) && bad.length >= 3).toBe(false);
  });

  it('names each field that is not valid', () => {
    const problems = achievementProblems(
      { code: 'No Good', title: 'ab', description: 'short', iconName: 'rocket', metric: 'LEVEL', target: '99', sortOrder: '-1' },
      metrics,
      icons,
    );

    expect(Object.keys(problems).sort()).toEqual(['code', 'description', 'iconName', 'sortOrder', 'target', 'title']);
    expect(problems.target).toBe('Maksimal 30.');
  });

  it('refuses a metric the form does not offer', () => {
    expect(achievementProblems({ ...draft, metric: 'LOGINS' }, metrics, icons).metric).toBe('Pilih ukuran yang tersedia.');
  });

  it('ignores the code and the target when editing, because those never change', () => {
    expect(achievementProblems({ ...draft, code: '', target: '' }, metrics, icons, { editing: true })).toEqual({});
  });
});

describe('achievementPatch', () => {
  const current = { code: 'streak-14', title: 'Dua Minggu Penuh', description: 'Pertahankan streak empat belas hari berturut-turut.', iconName: 'streak', sortOrder: 85 };

  it('keeps only the presentation fields that changed', () => {
    expect(achievementPatch(current, { title: 'Dua Pekan Penuh', description: current.description, iconName: 'trophy', sortOrder: '85' })).toEqual({ title: 'Dua Pekan Penuh', iconName: 'trophy' });
  });

  it('is empty when nothing changed, and reads the order as a number', () => {
    expect(achievementPatch(current, { title: current.title, description: current.description, iconName: 'streak', sortOrder: '85' })).toEqual({});
    expect(achievementPatch(current, { title: current.title, description: current.description, iconName: 'streak', sortOrder: '90' })).toEqual({ sortOrder: 90 });
  });
});

describe('targetLabel', () => {
  it('reads the rule the way a learner would', () => {
    expect(targetLabel({ metric: 'STREAK_DAYS', op: '>=', value: 14 }, metrics)).toBe('Hari streak ≥ 14 hari');
    expect(targetLabel(null, metrics)).toBe('Tanpa aturan');
    expect(targetLabel({ metric: 'LOGINS', op: '>=', value: 3 }, metrics)).toBe('LOGINS ≥ 3');
  });
});
