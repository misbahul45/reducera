import { z } from 'zod';
import { DEFAULT_REWARD_RULE_ROWS, REWARD_RULES, RewardKindValue, RewardRuleRow } from '../rewards/reward-rules';

export type RuleFieldTarget = 'amount' | 'param';

export interface RuleField {
  key: string;
  target: RuleFieldTarget;
  label: string;
  hint: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  integer: boolean;
}

export interface RuleDefinition {
  code: string;
  label: string;
  summary: string;
  eventType: string;
  rewardKind: RewardKindValue;
  fields: RuleField[];
}

export interface RuleRowValues {
  amount: number;
  params: Record<string, number> | null;
}

const field = (
  key: string,
  target: RuleFieldTarget,
  label: string,
  unit: string,
  hint: string,
  bounds: { min: number; max: number; step?: number; integer?: boolean },
): RuleField => ({
  key,
  target,
  label,
  hint,
  unit,
  min: bounds.min,
  max: bounds.max,
  step: bounds.step ?? 1,
  integer: bounds.integer ?? true,
});

const definition = (
  code: string,
  label: string,
  summary: string,
  fields: RuleField[],
): RuleDefinition => {
  const row = DEFAULT_REWARD_RULE_ROWS.find((r) => r.code === code) as RewardRuleRow;
  return { code, label, summary, eventType: row.eventType, rewardKind: row.rewardKind, fields };
};

export const RULE_CATALOG: ReadonlyArray<RuleDefinition> = [
  definition(
    REWARD_RULES.MASTERY_PROGRESS.id,
    'Progres penguasaan',
    'XP yang dibayar mengikuti kenaikan skor penguasaan sebuah konsep, sampai batas XP per konsep.',
    [
      field('cap', 'amount', 'Batas XP per konsep', 'XP', 'XP terbanyak yang bisa diperoleh satu konsep lewat progres.', { min: 1, max: 500 }),
      field('perUnit', 'param', 'XP per satuan skor', 'XP', 'XP untuk setiap kenaikan skor 1,0 di atas ambang. Skor 0,8 dengan ambang 0,5 dan nilai 100 memberi 30 XP.', { min: 1, max: 1000 }),
      field('baseline', 'param', 'Ambang skor', 'skor', 'Skor di bawah ambang ini tidak menghasilkan XP progres.', { min: 0, max: 0.95, step: 0.05, integer: false }),
    ],
  ),
  definition(
    REWARD_RULES.CONCEPT_PASSED.id,
    'Konsep lulus',
    'XP sekali per konsep saat skor dan jumlah bukti mencapai ambang lulus. Versi aturan baru tidak membayar konsep yang sudah dibayar.',
    [field('points', 'amount', 'XP lulus', 'XP', 'Dibayar satu kali untuk setiap konsep dan setiap pelajar.', { min: 1, max: 1000 })],
  ),
  definition(
    REWARD_RULES.STREAK_BONUS_7.id,
    'Bonus streak',
    'XP tambahan setiap kelipatan hari streak.',
    [
      field('points', 'amount', 'XP bonus', 'XP', 'Dibayar sekali pada hari kelipatan.', { min: 1, max: 1000 }),
      field('every', 'param', 'Setiap berapa hari', 'hari', 'Bonus dibayar saat streak mencapai kelipatan ini.', { min: 1, max: 365 }),
    ],
  ),
  definition(
    REWARD_RULES.PATH_NODE_MASTERED.id,
    'Simpul dikuasai',
    'Bintang saat semua konsep dalam satu sub-topik lulus. Versi aturan baru tidak membayar sub-topik yang sudah dibayar.',
    [field('stars', 'amount', 'Hadiah', 'bintang', 'Dibayar satu kali untuk setiap sub-topik dan setiap pelajar.', { min: 1, max: 10 })],
  ),
  definition(
    REWARD_RULES.STREAK_FREEZE_EARNED.id,
    'Pembeku streak',
    'Satu pembeku menutup satu hari yang terlewat. Aturan ini tidak membayar XP; menonaktifkannya berarti tidak ada pembeku baru.',
    [
      field('every', 'amount', 'Hari streak per pembeku', 'hari', 'Pelajar mendapat satu pembeku pada setiap kelipatan hari streak ini.', { min: 1, max: 60 }),
      field('maxHeld', 'param', 'Pembeku yang boleh disimpan', 'pembeku', 'Pembeku yang sudah penuh tidak bertambah. Nol berarti pembeku tidak pernah didapat.', { min: 0, max: 10 }),
    ],
  ),
];

export const ruleDefinition = (code: string): RuleDefinition | undefined => RULE_CATALOG.find((d) => d.code === code);

const numberSchemaOf = (spec: RuleField): z.ZodType<number> => {
  const base = spec.integer ? z.number().int() : z.number();
  return base.min(spec.min).max(spec.max);
};

export const publishSchemaFor = (rule: RuleDefinition) =>
  z.object(Object.fromEntries(rule.fields.map((spec) => [spec.key, numberSchemaOf(spec)]))).strict();

const defaultParams = (code: string): Record<string, unknown> => {
  const row = DEFAULT_REWARD_RULE_ROWS.find((r) => r.code === code);
  return row && row.params && typeof row.params === 'object' ? (row.params as Record<string, unknown>) : {};
};

const recordOf = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' ? (value as Record<string, unknown>) : {});

export const rowFromValues = (rule: RuleDefinition, values: Record<string, number>): RuleRowValues => {
  const amountField = rule.fields.find((spec) => spec.target === 'amount') as RuleField;
  const paramFields = rule.fields.filter((spec) => spec.target === 'param');
  return {
    amount: values[amountField.key],
    params: paramFields.length > 0 ? Object.fromEntries(paramFields.map((spec) => [spec.key, values[spec.key]])) : null,
  };
};

export const valuesFromRow = (rule: RuleDefinition, row: Pick<RewardRuleRow, 'amount' | 'params'>): Record<string, number> => {
  const stored = recordOf(row.params);
  const fallback = defaultParams(rule.code);
  return Object.fromEntries(
    rule.fields.map((spec) => {
      if (spec.target === 'amount') return [spec.key, row.amount];
      const value = typeof stored[spec.key] === 'number' ? stored[spec.key] : fallback[spec.key];
      return [spec.key, value as number];
    }),
  );
};

export const publishValuesEqual = (rule: RuleDefinition, left: Record<string, number>, right: Record<string, number>): boolean =>
  rule.fields.every((spec) => left[spec.key] === right[spec.key]);
