import type { GamifyAchievementRule, GamifyLevelRow, GamifyMetricSpec, GamifyRuleField, GamifyRuleView } from '~/interfaces/admin';
import type { Tone } from '~/lib/admin';

export const LADDER_MIN_LEVELS = 2;
export const LADDER_MAX_LEVELS = 30;
export const LADDER_MAX_XP = 10_000_000;
export const ACHIEVEMENT_CODE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const ACHIEVEMENT_SORT_MAX = 10_000;

const NUMBER_PATTERN = /^-?\d+(?:[.,]\d+)?$/;

type Bounds = Pick<GamifyRuleField, 'min' | 'max' | 'integer'>;

export interface ReadValuesResult {
  ok: boolean;
  values: Record<string, number>;
  problems: Record<string, string>;
}

export interface ReadLadderResult {
  rows: GamifyLevelRow[] | null;
  problems: string[];
}

export type LadderChange = 'same' | 'up' | 'down';

export interface LadderPreviewRow {
  xp: number;
  before: number;
  after: number;
  change: LadderChange;
}

export interface AchievementDraft {
  code: string;
  title: string;
  description: string;
  iconName: string;
  metric: string;
  target: string;
  sortOrder: string;
}

export interface AchievementPresentation {
  title: string;
  description: string | null;
  iconName: string | null;
  sortOrder: number;
}

export type AchievementPatch = Partial<{ title: string; description: string; iconName: string; sortOrder: number }>;

export const decimalText = (value: number): string => String(value).replace('.', ',');

export function parseNumber(raw: string): number | null {
  const text = raw.trim();
  if (!NUMBER_PATTERN.test(text)) return null;
  const value = Number(text.replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

export function fieldProblem(bounds: Bounds, raw: string): string | null {
  if (raw.trim() === '') return 'Isi angka.';
  const value = parseNumber(raw);
  if (value === null) return 'Isi angka yang valid.';
  if (bounds.integer && !Number.isInteger(value)) return 'Harus bilangan bulat.';
  if (value < bounds.min) return `Minimal ${decimalText(bounds.min)}.`;
  if (value > bounds.max) return `Maksimal ${decimalText(bounds.max)}.`;
  return null;
}

export function readValues(fields: ReadonlyArray<GamifyRuleField>, raw: Record<string, string>): ReadValuesResult {
  const values: Record<string, number> = {};
  const problems: Record<string, string> = {};
  for (const field of fields) {
    const text = raw[field.key] ?? '';
    const problem = fieldProblem(field, text);
    if (problem) problems[field.key] = problem;
    else values[field.key] = parseNumber(text) as number;
  }
  return { ok: Object.keys(problems).length === 0, values, problems };
}

export function rawFromValues(fields: ReadonlyArray<GamifyRuleField>, values: Record<string, number>): Record<string, string> {
  return Object.fromEntries(fields.map((field) => [field.key, typeof values[field.key] === 'number' ? decimalText(values[field.key] as number) : '']));
}

export function changedFields(fields: ReadonlyArray<GamifyRuleField>, before: Record<string, number>, after: Record<string, number>): string[] {
  return fields.filter((field) => before[field.key] !== after[field.key]).map((field) => field.key);
}

export const formatFieldValue = (field: Pick<GamifyRuleField, 'unit'>, value: number): string => `${decimalText(value)} ${field.unit}`;

export function ruleSentence(fields: ReadonlyArray<GamifyRuleField>, values: Record<string, number>): string {
  return fields
    .filter((field) => typeof values[field.key] === 'number')
    .map((field) => `${field.label} ${formatFieldValue(field, values[field.key] as number)}`)
    .join(' · ');
}

export function ruleStatus(rule: Pick<GamifyRuleView, 'inForce'>): { label: string; tone: Tone } {
  if (!rule.inForce) return { label: 'Mati', tone: 'error' };
  if (rule.inForce.builtin) return { label: `Bawaan · versi ${rule.inForce.version}`, tone: 'neutral' };
  return { label: `Aktif · versi ${rule.inForce.version}`, tone: 'success' };
}

const xpProblem = (index: number) => `Level ${index + 1}: isi XP dengan bilangan bulat dari 0 sampai ${LADDER_MAX_XP}.`;

export function readLadder(raws: ReadonlyArray<string>): ReadLadderResult {
  const problems: string[] = [];
  if (raws.length < LADDER_MIN_LEVELS) problems.push(`Tangga butuh minimal ${LADDER_MIN_LEVELS} level.`);
  if (raws.length > LADDER_MAX_LEVELS) problems.push(`Tangga paling banyak ${LADDER_MAX_LEVELS} level.`);

  const parsed = raws.map((raw) => parseNumber(raw));
  const unreadable = parsed.flatMap((value, index) =>
    value === null || !Number.isInteger(value) || value < 0 || value > LADDER_MAX_XP ? [index] : [],
  );
  if (unreadable.length > 0) {
    problems.push(...unreadable.map(xpProblem));
    return { rows: null, problems };
  }

  const xps = parsed as number[];
  if (xps.length > 0 && xps[0] !== 0) problems.push('Level 1 harus mulai dari 0 XP.');
  xps.forEach((xp, index) => {
    if (index > 0 && xp <= (xps[index - 1] as number)) problems.push(`Level ${index + 1} butuh XP lebih besar dari level ${index}.`);
  });

  return { rows: problems.length > 0 ? null : xps.map((xp, index) => ({ level: index + 1, xp })), problems };
}

export function suggestNextXp(raws: ReadonlyArray<string>): string {
  if (raws.length === 0) return '0';
  const last = parseNumber(raws[raws.length - 1] as string);
  const previous = raws.length > 1 ? parseNumber(raws[raws.length - 2] as string) : null;
  const step = last !== null && previous !== null && last > previous ? last - previous : 100;
  return String(Math.min((last ?? 0) + step, LADDER_MAX_XP));
}

export function levelAt(rows: ReadonlyArray<GamifyLevelRow>, xp: number): number {
  const ordered = [...rows].sort((a, b) => a.level - b.level);
  let reached = ordered[0]?.level ?? 1;
  for (const row of ordered) {
    if (row.xp <= xp) reached = row.level;
  }
  return reached;
}

export function ladderPreview(before: ReadonlyArray<GamifyLevelRow>, after: ReadonlyArray<GamifyLevelRow>, samples: ReadonlyArray<number>): LadderPreviewRow[] {
  return samples.map((xp) => {
    const from = levelAt(before, xp);
    const to = levelAt(after, xp);
    return { xp, before: from, after: to, change: to === from ? 'same' : to > from ? 'up' : 'down' };
  });
}

export const LADDER_CHANGE_LABEL: Record<LadderChange, string> = {
  same: 'Tetap',
  up: 'Naik',
  down: 'Turun',
};

const numberBounds = (max: number, min = 1): Bounds => ({ min, max, integer: true });

export function achievementProblems(
  draft: AchievementDraft,
  metrics: ReadonlyArray<GamifyMetricSpec>,
  icons: ReadonlyArray<string>,
  options: { editing?: boolean } = {},
): Record<string, string> {
  const problems: Record<string, string> = {};
  const title = draft.title.trim();
  const description = draft.description.trim();

  if (!options.editing) {
    if (draft.code.length < 3 || draft.code.length > 40 || !ACHIEVEMENT_CODE_PATTERN.test(draft.code)) {
      problems.code = 'Kode 3 sampai 40 karakter: huruf kecil, angka, dan tanda hubung.';
    }
    const spec = metrics.find((item) => item.metric === draft.metric);
    if (!spec) problems.metric = 'Pilih ukuran yang tersedia.';
    else {
      const target = fieldProblem(numberBounds(spec.max), draft.target);
      if (target) problems.target = target;
    }
  }
  if (title.length < 3 || title.length > 60) problems.title = 'Judul 3 sampai 60 karakter.';
  if (description.length < 10 || description.length > 240) problems.description = 'Deskripsi 10 sampai 240 karakter.';
  if (!icons.includes(draft.iconName)) problems.iconName = 'Pilih ikon yang tersedia.';
  const order = fieldProblem(numberBounds(ACHIEVEMENT_SORT_MAX, 0), draft.sortOrder);
  if (order) problems.sortOrder = order;
  return problems;
}

export function achievementPatch(
  current: AchievementPresentation,
  draft: Pick<AchievementDraft, 'title' | 'description' | 'iconName' | 'sortOrder'>,
): AchievementPatch {
  const patch: AchievementPatch = {};
  const title = draft.title.trim();
  const description = draft.description.trim();
  const order = parseNumber(draft.sortOrder);
  if (title !== current.title) patch.title = title;
  if (description !== (current.description ?? '')) patch.description = description;
  if (draft.iconName !== (current.iconName ?? '')) patch.iconName = draft.iconName;
  if (order !== null && order !== current.sortOrder) patch.sortOrder = order;
  return patch;
}

export function targetLabel(rule: GamifyAchievementRule | null, metrics: ReadonlyArray<GamifyMetricSpec>): string {
  if (!rule) return 'Tanpa aturan';
  const spec = metrics.find((item) => item.metric === rule.metric);
  return spec ? `${spec.label} ≥ ${rule.value} ${spec.unit}` : `${rule.metric} ≥ ${rule.value}`;
}
