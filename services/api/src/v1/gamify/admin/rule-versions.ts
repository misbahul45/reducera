import { AppError, AppErrorCode } from '@/common/lib/error';
import { DEFAULT_REWARD_RULE_ROWS, RewardRuleRow } from '../rewards/reward-rules';
import { RuleDefinition, RuleField, publishValuesEqual, rowFromValues, valuesFromRow } from './rule-catalog';

export interface StoredRule extends RewardRuleRow {
  createdAt?: Date | null;
}

export interface RuleInForce {
  version: number;
  builtin: boolean;
  values: Record<string, number>;
}

export interface RuleVersionView {
  version: number;
  active: boolean;
  inForce: boolean;
  builtin: boolean;
  values: Record<string, number>;
  createdAt: Date | null;
}

export interface RuleView {
  code: string;
  label: string;
  summary: string;
  eventType: string;
  rewardKind: string;
  fields: RuleField[];
  inForce: RuleInForce | null;
  latestVersion: number;
  versions: RuleVersionView[];
}

export interface WritePlan {
  create: RewardRuleRow[];
  activate: number[];
  deactivate: number[];
}

export interface PublishInput {
  baseVersion: number;
  values: Record<string, number>;
}

const builtinRow = (code: string): RewardRuleRow => DEFAULT_REWARD_RULE_ROWS.find((row) => row.code === code) as RewardRuleRow;

const conflict = (message: string) => new AppError(message, 409, AppErrorCode.INVALID_STATE_TRANSITION);

const effective = (code: string, rows: ReadonlyArray<StoredRule>): { rows: ReadonlyArray<StoredRule>; builtin: boolean } =>
  rows.length > 0 ? { rows, builtin: false } : { rows: [builtinRow(code)], builtin: true };

const highestActive = (rows: ReadonlyArray<StoredRule>): StoredRule | null =>
  [...rows].filter((row) => row.active).sort((a, b) => b.version - a.version)[0] ?? null;

const latestOf = (rows: ReadonlyArray<StoredRule>): number => rows.reduce((top, row) => Math.max(top, row.version), 0);

const retiredBuiltin = (code: string): RewardRuleRow => ({ ...builtinRow(code), active: false });

export const inForce = (rule: RuleDefinition, stored: ReadonlyArray<StoredRule>): RuleInForce | null => {
  const { rows, builtin } = effective(rule.code, stored);
  const row = highestActive(rows);
  return row ? { version: row.version, builtin, values: valuesFromRow(rule, row) } : null;
};

export const planPublish = (rule: RuleDefinition, stored: ReadonlyArray<StoredRule>, input: PublishInput): WritePlan => {
  const { rows } = effective(rule.code, stored);
  const latest = latestOf(rows);
  if (input.baseVersion !== latest) {
    throw conflict(`The rule is now at version ${latest}; reload it and publish again`);
  }
  const current = inForce(rule, stored);
  if (current && publishValuesEqual(rule, current.values, input.values)) {
    throw new AppError('These values are the same as the version in force', 400, AppErrorCode.VALIDATION_ERROR);
  }

  const next: RewardRuleRow = {
    code: rule.code,
    version: latest + 1,
    eventType: rule.eventType,
    rewardKind: rule.rewardKind,
    dailyCap: null,
    active: true,
    ...rowFromValues(rule, input.values),
  };
  return {
    create: stored.length === 0 ? [retiredBuiltin(rule.code), next] : [next],
    activate: [],
    deactivate: stored.filter((row) => row.active).map((row) => row.version),
  };
};

export const planActivate = (rule: RuleDefinition, stored: ReadonlyArray<StoredRule>, version: number): WritePlan => {
  const { rows } = effective(rule.code, stored);
  const target = rows.find((row) => row.version === version);
  if (!target) throw new AppError(`Version ${version} of ${rule.code} does not exist`, 404, AppErrorCode.NOT_FOUND);
  const others = rows.filter((row) => row.version !== version && row.active).map((row) => row.version);
  if (target.active && others.length === 0) throw conflict(`Version ${version} is already the version in force`);
  return { create: [], activate: target.active ? [] : [version], deactivate: others };
};

export const planDeactivate = (rule: RuleDefinition, stored: ReadonlyArray<StoredRule>): WritePlan => {
  const { rows } = effective(rule.code, stored);
  const active = rows.filter((row) => row.active).map((row) => row.version);
  if (active.length === 0) throw conflict(`${rule.code} is already off`);
  return stored.length === 0 ? { create: [retiredBuiltin(rule.code)], activate: [], deactivate: [] } : { create: [], activate: [], deactivate: active };
};

export const describeRule = (rule: RuleDefinition, stored: ReadonlyArray<StoredRule>): RuleView => {
  const { rows, builtin } = effective(rule.code, stored);
  const current = highestActive(rows);
  return {
    code: rule.code,
    label: rule.label,
    summary: rule.summary,
    eventType: rule.eventType,
    rewardKind: rule.rewardKind,
    fields: rule.fields,
    inForce: inForce(rule, stored),
    latestVersion: latestOf(rows),
    versions: [...rows]
      .sort((a, b) => b.version - a.version)
      .map((row) => ({
        version: row.version,
        active: row.active,
        inForce: current !== null && row.version === current.version,
        builtin,
        values: valuesFromRow(rule, row),
        createdAt: row.createdAt ?? null,
      })),
  };
};
