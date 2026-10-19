import { DEFAULT_RULE_SET, RewardRuleSet } from '../../rewards/reward-rules';
import { DEFAULT_STREAK_CONFIG } from '../streak-fold';
import { streakConfigFrom } from '../streak-config';

describe('streakConfigFrom', () => {
  it('is the default configuration for the default rule set', () => {
    expect(streakConfigFrom(DEFAULT_RULE_SET)).toEqual(DEFAULT_STREAK_CONFIG);
  });

  it('follows the freeze rule: its cadence and its number held', () => {
    const rules: RewardRuleSet = { ...DEFAULT_RULE_SET, streakFreeze: { version: 2, every: 3, maxHeld: 5 } };

    expect(streakConfigFrom(rules)).toEqual({ freezeEvery: 3, freezeMax: 5 });
  });

  it('holds no freeze when the rule is off, keeping the default cadence so the fold stays well defined', () => {
    const rules: RewardRuleSet = { ...DEFAULT_RULE_SET, streakFreeze: null };

    expect(streakConfigFrom(rules)).toEqual({ freezeEvery: DEFAULT_STREAK_CONFIG.freezeEvery, freezeMax: 0 });
  });
});
