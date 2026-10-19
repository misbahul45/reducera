import { DEFAULT_REWARD_RULE_ROWS, RewardRuleRow, buildRuleSet } from '../../rewards/reward-rules';
import { RULE_CATALOG, publishSchemaFor, ruleDefinition, rowFromValues, valuesFromRow } from '../rule-catalog';

const defaultRow = (code: string): RewardRuleRow => DEFAULT_REWARD_RULE_ROWS.find((r) => r.code === code) as RewardRuleRow;

describe('rule catalog', () => {
  it('has one definition for every default rule and nothing else, in a stable order', () => {
    expect(RULE_CATALOG.map((d) => d.code)).toEqual(DEFAULT_REWARD_RULE_ROWS.map((r) => r.code));
  });

  it('fixes the event type and the reward kind of each rule to the ones of its default row', () => {
    for (const definition of RULE_CATALOG) {
      const row = defaultRow(definition.code);
      expect([definition.code, definition.eventType, definition.rewardKind]).toEqual([row.code, row.eventType, row.rewardKind]);
    }
  });

  it('gives every field a label, a hint and sane bounds', () => {
    for (const definition of RULE_CATALOG) {
      expect(definition.label.length).toBeGreaterThan(0);
      expect(definition.summary.length).toBeGreaterThan(0);
      expect(definition.fields.length).toBeGreaterThan(0);
      for (const field of definition.fields) {
        expect(field.label.length).toBeGreaterThan(0);
        expect(field.hint.length).toBeGreaterThan(0);
        expect(field.min).toBeLessThan(field.max);
        expect(field.step).toBeGreaterThan(0);
      }
    }
  });

  it('has exactly one field that becomes the amount of the row', () => {
    for (const definition of RULE_CATALOG) {
      expect(definition.fields.filter((f) => f.target === 'amount')).toHaveLength(1);
    }
  });

  it('is plain data that survives a JSON round trip', () => {
    expect(JSON.parse(JSON.stringify(RULE_CATALOG))).toEqual(RULE_CATALOG);
  });

  it('finds a definition by code and knows no other', () => {
    expect(ruleDefinition('CONCEPT_PASSED')?.code).toBe('CONCEPT_PASSED');
    expect(ruleDefinition('SOMETHING_ELSE')).toBeUndefined();
    expect(ruleDefinition('constructor')).toBeUndefined();
  });
});

describe('default values', () => {
  it('are accepted by the schema of their rule', () => {
    for (const definition of RULE_CATALOG) {
      const values = valuesFromRow(definition, defaultRow(definition.code));
      expect(publishSchemaFor(definition).safeParse(values).success).toBe(true);
    }
  });

  it('read back the default amount and parameters', () => {
    expect(valuesFromRow(ruleDefinition('MASTERY_PROGRESS')!, defaultRow('MASTERY_PROGRESS'))).toEqual({ cap: 50, perUnit: 100, baseline: 0.5 });
    expect(valuesFromRow(ruleDefinition('CONCEPT_PASSED')!, defaultRow('CONCEPT_PASSED'))).toEqual({ points: 50 });
    expect(valuesFromRow(ruleDefinition('STREAK_BONUS_7')!, defaultRow('STREAK_BONUS_7'))).toEqual({ points: 50, every: 7 });
    expect(valuesFromRow(ruleDefinition('PATH_NODE_MASTERED')!, defaultRow('PATH_NODE_MASTERED'))).toEqual({ stars: 1 });
    expect(valuesFromRow(ruleDefinition('STREAK_FREEZE_EARNED')!, defaultRow('STREAK_FREEZE_EARNED'))).toEqual({ every: 7, maxHeld: 2 });
  });

  it('fall back to the defaults of the rule for parameters a stored row does not carry', () => {
    const stored: RewardRuleRow = { ...defaultRow('MASTERY_PROGRESS'), version: 2, amount: 30, params: null };

    expect(valuesFromRow(ruleDefinition('MASTERY_PROGRESS')!, stored)).toEqual({ cap: 30, perUnit: 100, baseline: 0.5 });
  });
});

describe('publish schema', () => {
  const mastery = publishSchemaFor(ruleDefinition('MASTERY_PROGRESS')!);
  const freeze = publishSchemaFor(ruleDefinition('STREAK_FREEZE_EARNED')!);

  it('accepts values inside the bounds, including both ends', () => {
    expect(mastery.safeParse({ cap: 1, perUnit: 1, baseline: 0 }).success).toBe(true);
    expect(mastery.safeParse({ cap: 500, perUnit: 1000, baseline: 0.95 }).success).toBe(true);
    expect(freeze.safeParse({ every: 1, maxHeld: 0 }).success).toBe(true);
    expect(freeze.safeParse({ every: 60, maxHeld: 10 }).success).toBe(true);
  });

  it('rejects values outside the bounds', () => {
    expect(mastery.safeParse({ cap: 0, perUnit: 100, baseline: 0.5 }).success).toBe(false);
    expect(mastery.safeParse({ cap: 501, perUnit: 100, baseline: 0.5 }).success).toBe(false);
    expect(mastery.safeParse({ cap: 50, perUnit: 1001, baseline: 0.5 }).success).toBe(false);
    expect(mastery.safeParse({ cap: 50, perUnit: 100, baseline: 1 }).success).toBe(false);
    expect(mastery.safeParse({ cap: 50, perUnit: 100, baseline: -0.1 }).success).toBe(false);
    expect(freeze.safeParse({ every: 0, maxHeld: 2 }).success).toBe(false);
    expect(freeze.safeParse({ every: 7, maxHeld: 11 }).success).toBe(false);
    expect(freeze.safeParse({ every: 7, maxHeld: -1 }).success).toBe(false);
  });

  it('rejects a whole-number field that is fractional, and a value that is not a finite number', () => {
    expect(freeze.safeParse({ every: 7.5, maxHeld: 2 }).success).toBe(false);
    for (const bad of ['7', null, NaN, Infinity, true, {}]) {
      expect(freeze.safeParse({ every: bad, maxHeld: 2 }).success).toBe(false);
    }
  });

  it('accepts a fraction for the one field that is not a whole number', () => {
    expect(mastery.safeParse({ cap: 50, perUnit: 100, baseline: 0.25 }).success).toBe(true);
  });

  it('rejects an unknown field and a missing field', () => {
    expect(freeze.safeParse({ every: 7, maxHeld: 2, dailyCap: 3 }).success).toBe(false);
    expect(freeze.safeParse({ every: 7 }).success).toBe(false);
    expect(freeze.safeParse({}).success).toBe(false);
  });
});

describe('rowFromValues', () => {
  it('puts the amount field in the amount and the others in the parameters', () => {
    expect(rowFromValues(ruleDefinition('MASTERY_PROGRESS')!, { cap: 30, perUnit: 200, baseline: 0.4 })).toEqual({ amount: 30, params: { perUnit: 200, baseline: 0.4 } });
    expect(rowFromValues(ruleDefinition('STREAK_BONUS_7')!, { points: 70, every: 14 })).toEqual({ amount: 70, params: { every: 14 } });
    expect(rowFromValues(ruleDefinition('STREAK_FREEZE_EARNED')!, { every: 5, maxHeld: 3 })).toEqual({ amount: 5, params: { maxHeld: 3 } });
  });

  it('writes no parameters for a rule that has none', () => {
    expect(rowFromValues(ruleDefinition('CONCEPT_PASSED')!, { points: 80 })).toEqual({ amount: 80, params: null });
    expect(rowFromValues(ruleDefinition('PATH_NODE_MASTERED')!, { stars: 2 })).toEqual({ amount: 2, params: null });
  });

  it('round trips with valuesFromRow', () => {
    const samples: Array<[string, Record<string, number>]> = [
      ['MASTERY_PROGRESS', { cap: 120, perUnit: 80, baseline: 0.6 }],
      ['CONCEPT_PASSED', { points: 10 }],
      ['STREAK_BONUS_7', { points: 25, every: 3 }],
      ['PATH_NODE_MASTERED', { stars: 4 }],
      ['STREAK_FREEZE_EARNED', { every: 10, maxHeld: 0 }],
    ];
    for (const [code, values] of samples) {
      const definition = ruleDefinition(code)!;
      const row = { ...defaultRow(code), version: 2, ...rowFromValues(definition, values) };
      expect(valuesFromRow(definition, row)).toEqual(values);
    }
  });
});

describe('what the form writes is what the engine reads', () => {
  const read = (code: string, values: Record<string, number>) => {
    const definition = ruleDefinition(code)!;
    const row: RewardRuleRow = { ...defaultRow(code), version: 2, ...rowFromValues(definition, values) };
    return buildRuleSet([row]);
  };

  it('for the mastery progress rule', () => {
    expect(read('MASTERY_PROGRESS', { cap: 30, perUnit: 200, baseline: 0.4 }).masteryProgress).toEqual({ version: 2, cap: 30, perUnit: 200, baseline: 0.4 });
  });

  it('for the pass reward, the streak bonus and the star', () => {
    expect(read('CONCEPT_PASSED', { points: 80 }).conceptPassed).toEqual({ version: 2, points: 80 });
    expect(read('STREAK_BONUS_7', { points: 70, every: 14 }).streakBonus).toEqual({ version: 2, points: 70, every: 14 });
    expect(read('PATH_NODE_MASTERED', { stars: 3 }).nodeMastered).toEqual({ version: 2, stars: 3 });
  });

  it('for the freeze, including the value zero', () => {
    expect(read('STREAK_FREEZE_EARNED', { every: 5, maxHeld: 3 }).streakFreeze).toEqual({ version: 2, every: 5, maxHeld: 3 });
    expect(read('STREAK_FREEZE_EARNED', { every: 5, maxHeld: 0 }).streakFreeze).toEqual({ version: 2, every: 5, maxHeld: 0 });
  });
});
