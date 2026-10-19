import { AppError } from '@/common/lib/error';
import { DEFAULT_REWARD_RULE_ROWS, RewardRuleRow, buildRuleSet } from '../../rewards/reward-rules';
import { ruleDefinition } from '../rule-catalog';
import { describeRule, inForce, planActivate, planDeactivate, planPublish } from '../rule-versions';

const definition = ruleDefinition('CONCEPT_PASSED')!;
const freeze = ruleDefinition('STREAK_FREEZE_EARNED')!;

const stored = (version: number, overrides: Partial<RewardRuleRow> = {}): RewardRuleRow => ({
  code: 'CONCEPT_PASSED',
  version,
  eventType: 'ASSESSMENT_COMPLETED',
  rewardKind: 'XP',
  amount: 50,
  dailyCap: null,
  params: null,
  active: true,
  ...overrides,
});

const failure = (run: () => unknown): AppError => {
  try {
    run();
  } catch (error) {
    return error as AppError;
  }
  throw new Error('expected a failure');
};

describe('inForce', () => {
  it('is the built-in default as version 1 when no row exists', () => {
    expect(inForce(definition, [])).toEqual({ version: 1, builtin: true, values: { points: 50 } });
  });

  it('is the highest active version', () => {
    const rows = [stored(1, { active: false }), stored(2, { amount: 60 }), stored(3, { amount: 70, active: false })];

    expect(inForce(definition, rows)).toEqual({ version: 2, builtin: false, values: { points: 60 } });
  });

  it('is null when rows exist and none is active, as the engine reads it', () => {
    const rows = [stored(1, { active: false }), stored(2, { active: false })];

    expect(inForce(definition, rows)).toBeNull();
    expect(buildRuleSet(rows.map((r) => ({ ...r, code: 'CONCEPT_PASSED' }))).conceptPassed).toBeNull();
  });

  it('agrees with the engine about which version is in force', () => {
    const rows = [stored(1), stored(2, { amount: 80 }), stored(3, { amount: 90, active: false })];

    expect(inForce(definition, rows)?.version).toBe(buildRuleSet(rows).conceptPassed?.version);
  });
});

describe('planPublish', () => {
  it('creates the next version, puts it in force and retires every other active version', () => {
    const plan = planPublish(definition, [stored(1)], { baseVersion: 1, values: { points: 80 } });

    expect(plan.create).toEqual([{ code: 'CONCEPT_PASSED', version: 2, eventType: 'ASSESSMENT_COMPLETED', rewardKind: 'XP', amount: 80, dailyCap: null, params: null, active: true }]);
    expect(plan.deactivate).toEqual([1]);
    expect(plan.activate).toEqual([]);
  });

  it('writes the parameters of a rule that has some, and the fixed event type and kind of the catalog', () => {
    const plan = planPublish(freeze, [{ ...DEFAULT_REWARD_RULE_ROWS.find((r) => r.code === 'STREAK_FREEZE_EARNED')! }], { baseVersion: 1, values: { every: 5, maxHeld: 3 } });

    expect(plan.create[0]).toMatchObject({ code: 'STREAK_FREEZE_EARNED', version: 2, eventType: 'STREAK_DAY_QUALIFIED', rewardKind: 'XP', amount: 5, params: { maxHeld: 3 }, dailyCap: null });
  });

  it('writes the built-in default as an already retired version 1 before the first published version', () => {
    const plan = planPublish(definition, [], { baseVersion: 1, values: { points: 80 } });

    expect(plan.create.map((r) => [r.version, r.amount, r.active])).toEqual([[1, 50, false], [2, 80, true]]);
    expect(plan.deactivate).toEqual([]);
  });

  it('numbers the next version after the highest one, retired or not', () => {
    const plan = planPublish(definition, [stored(1, { active: false }), stored(4, { active: false })], { baseVersion: 4, values: { points: 80 } });

    expect(plan.create.map((r) => r.version)).toEqual([5]);
  });

  it('refuses a stale base version with 409', () => {
    const error = failure(() => planPublish(definition, [stored(1), stored(2, { amount: 60 })], { baseVersion: 1, values: { points: 80 } }));

    expect(error.statusCode).toBe(409);
  });

  it('refuses values equal to the version in force, so no version is minted for nothing', () => {
    const error = failure(() => planPublish(definition, [stored(1)], { baseVersion: 1, values: { points: 50 } }));

    expect(error.statusCode).toBe(400);
  });

  it('puts a new version in force when the rule was off, even with the same values as before', () => {
    const plan = planPublish(definition, [stored(1, { active: false })], { baseVersion: 1, values: { points: 50 } });

    expect(plan.create.map((r) => [r.version, r.active])).toEqual([[2, true]]);
    expect(plan.deactivate).toEqual([]);
  });

  it('leaves exactly one active version once applied', () => {
    const rows = [stored(1), stored(2, { amount: 60 })];
    const plan = planPublish(definition, rows, { baseVersion: 2, values: { points: 80 } });

    const after = [...rows.map((r) => ({ ...r, active: r.active && !plan.deactivate.includes(r.version) })), ...plan.create];

    expect(after.filter((r) => r.active).map((r) => r.version)).toEqual([3]);
  });
});

describe('planActivate', () => {
  it('puts an older version back in force and retires the others, which is a rollback', () => {
    const plan = planActivate(definition, [stored(1, { active: false }), stored(2, { amount: 60 })], 1);

    expect(plan).toEqual({ create: [], activate: [1], deactivate: [2] });
  });

  it('revives a rule that was off', () => {
    const plan = planActivate(definition, [stored(1, { active: false }), stored(2, { active: false })], 2);

    expect(plan).toEqual({ create: [], activate: [2], deactivate: [] });
  });

  it('refuses a version that is already the only one in force with 409', () => {
    expect(failure(() => planActivate(definition, [stored(1, { active: false }), stored(2)], 2)).statusCode).toBe(409);
    expect(failure(() => planActivate(definition, [], 1)).statusCode).toBe(409);
  });

  it('refuses a version that does not exist with 404', () => {
    expect(failure(() => planActivate(definition, [stored(1)], 7)).statusCode).toBe(404);
  });

  it('normalizes a version that is active but shadowed by a higher active one', () => {
    const plan = planActivate(definition, [stored(1), stored(2, { amount: 60 })], 1);

    expect(plan).toEqual({ create: [], activate: [], deactivate: [2] });
  });
});

describe('planDeactivate', () => {
  it('retires every active version, which turns the rule off', () => {
    expect(planDeactivate(definition, [stored(1, { active: false }), stored(2)])).toEqual({ create: [], activate: [], deactivate: [2] });
  });

  it('writes the built-in default as a retired version 1 when no row exists, so the rule stays off', () => {
    const plan = planDeactivate(definition, []);

    expect(plan.create.map((r) => [r.version, r.active])).toEqual([[1, false]]);
    expect(plan.deactivate).toEqual([]);
  });

  it('refuses a rule that is already off with 409', () => {
    expect(failure(() => planDeactivate(definition, [stored(1, { active: false })])).statusCode).toBe(409);
  });
});

describe('describeRule', () => {
  it('lists the versions newest first with their values and which one is in force', () => {
    const view = describeRule(definition, [stored(1, { active: false }), stored(2, { amount: 60 })].map((r) => ({ ...r, createdAt: new Date('2026-10-16T00:00:00Z') })));

    expect(view.code).toBe('CONCEPT_PASSED');
    expect(view.inForce).toEqual({ version: 2, builtin: false, values: { points: 60 } });
    expect(view.latestVersion).toBe(2);
    expect(view.versions.map((v) => [v.version, v.active, v.inForce, v.values])).toEqual([
      [2, true, true, { points: 60 }],
      [1, false, false, { points: 50 }],
    ]);
  });

  it('shows the built-in default as version 1 when no row exists', () => {
    const view = describeRule(definition, []);

    expect(view.latestVersion).toBe(1);
    expect(view.versions).toEqual([{ version: 1, active: true, inForce: true, builtin: true, values: { points: 50 }, createdAt: null }]);
  });

  it('says the rule is off when every row is retired', () => {
    const view = describeRule(definition, [{ ...stored(1, { active: false }), createdAt: new Date('2026-10-16T00:00:00Z') }]);

    expect(view.inForce).toBeNull();
  });

  it('carries the fields the form is generated from', () => {
    const view = describeRule(definition, []);

    expect(view.fields).toEqual(definition.fields);
    expect([view.label, view.summary, view.eventType, view.rewardKind]).toEqual([definition.label, definition.summary, definition.eventType, definition.rewardKind]);
  });
});
