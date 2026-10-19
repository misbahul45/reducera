import { DEFAULT_LEVELS } from '../../me/level-progress';
import { LADDER_MAX_LEVELS, LADDER_MAX_XP, LADDER_MIN_LEVELS, ladderFingerprint, ladderProblems, sameLadder } from '../level-ladder';

const ladder = (xps: number[]) => xps.map((xp, index) => ({ level: index + 1, xp }));

describe('ladderProblems', () => {
  it('accepts the default ladder and a short valid one', () => {
    expect(ladderProblems(DEFAULT_LEVELS)).toEqual([]);
    expect(ladderProblems(ladder([0, 100]))).toEqual([]);
  });

  it('accepts the levels in any order', () => {
    expect(ladderProblems([{ level: 3, xp: 300 }, { level: 1, xp: 0 }, { level: 2, xp: 100 }])).toEqual([]);
  });

  it('refuses fewer levels than the minimum and more than the maximum', () => {
    expect(ladderProblems(ladder([0]))).toEqual([expect.stringMatching(new RegExp(`at least ${LADDER_MIN_LEVELS}`))]);
    expect(ladderProblems(ladder(Array.from({ length: LADDER_MAX_LEVELS + 1 }, (_, i) => i * 10)))).toEqual([expect.stringMatching(new RegExp(`at most ${LADDER_MAX_LEVELS}`))]);
    expect(ladderProblems(ladder(Array.from({ length: LADDER_MAX_LEVELS }, (_, i) => i * 10)))).toEqual([]);
  });

  it('refuses a first level above zero XP, because a new learner would have no level', () => {
    expect(ladderProblems(ladder([10, 100, 200]))).toEqual([expect.stringMatching(/first level.*0 XP/i)]);
  });

  it('refuses a gap in the level numbers and a level numbered twice', () => {
    expect(ladderProblems([{ level: 1, xp: 0 }, { level: 3, xp: 100 }])).toEqual([expect.stringMatching(/numbered 1, 2, 3/)]);
    expect(ladderProblems([{ level: 1, xp: 0 }, { level: 1, xp: 100 }])).toEqual([expect.stringMatching(/numbered 1, 2, 3/)]);
    expect(ladderProblems([{ level: 2, xp: 0 }, { level: 3, xp: 100 }])).toEqual([expect.stringMatching(/numbered 1, 2, 3/)]);
  });

  it('refuses XP that does not strictly rise with the level, and names the level', () => {
    expect(ladderProblems(ladder([0, 100, 100, 300]))).toEqual([expect.stringMatching(/Level 3 needs more XP/)]);
    expect(ladderProblems(ladder([0, 200, 100, 300]))).toEqual([expect.stringMatching(/Level 3 needs more XP/)]);
  });

  it('refuses XP that is negative, fractional or beyond the maximum', () => {
    expect(ladderProblems([{ level: 1, xp: -1 }, { level: 2, xp: 100 }]).length).toBeGreaterThan(0);
    expect(ladderProblems([{ level: 1, xp: 0 }, { level: 2, xp: 10.5 }]).length).toBeGreaterThan(0);
    expect(ladderProblems([{ level: 1, xp: 0 }, { level: 2, xp: LADDER_MAX_XP + 1 }]).length).toBeGreaterThan(0);
    expect(ladderProblems([{ level: 1, xp: 0 }, { level: 2, xp: LADDER_MAX_XP }])).toEqual([]);
  });
});

describe('ladderFingerprint', () => {
  it('is the same for the same ladder in any order and changes with any value', () => {
    const base = ladder([0, 100, 250]);

    expect(ladderFingerprint([...base].reverse())).toBe(ladderFingerprint(base));
    expect(ladderFingerprint(ladder([0, 100, 251]))).not.toBe(ladderFingerprint(base));
    expect(ladderFingerprint(ladder([0, 100]))).not.toBe(ladderFingerprint(base));
  });
});

describe('sameLadder', () => {
  it('compares level by level regardless of order', () => {
    expect(sameLadder(ladder([0, 100]), [{ level: 2, xp: 100 }, { level: 1, xp: 0 }])).toBe(true);
    expect(sameLadder(ladder([0, 100]), ladder([0, 101]))).toBe(false);
    expect(sameLadder(ladder([0, 100]), ladder([0, 100, 200]))).toBe(false);
  });
});
