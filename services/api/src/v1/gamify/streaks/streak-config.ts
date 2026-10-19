import { RewardRuleSet } from '../rewards/reward-rules';
import { DEFAULT_STREAK_CONFIG, StreakConfig } from './streak-fold';

export const streakConfigFrom = (rules: RewardRuleSet): StreakConfig =>
  rules.streakFreeze
    ? { freezeEvery: rules.streakFreeze.every, freezeMax: rules.streakFreeze.maxHeld }
    : { freezeEvery: DEFAULT_STREAK_CONFIG.freezeEvery, freezeMax: 0 };
