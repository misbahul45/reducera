import { createHash } from 'crypto';
import { LevelRow } from '../me/level-progress';

export const LADDER_MIN_LEVELS = 2;
export const LADDER_MAX_LEVELS = 30;
export const LADDER_MAX_XP = 10_000_000;

const byLevel = (rows: ReadonlyArray<LevelRow>): LevelRow[] => [...rows].sort((a, b) => a.level - b.level);

export const ladderProblems = (rows: ReadonlyArray<LevelRow>): string[] => {
  const problems: string[] = [];
  if (rows.length < LADDER_MIN_LEVELS) problems.push(`A ladder needs at least ${LADDER_MIN_LEVELS} levels`);
  if (rows.length > LADDER_MAX_LEVELS) problems.push(`A ladder has at most ${LADDER_MAX_LEVELS} levels`);

  const ordered = byLevel(rows);
  const numbered = ordered.every((row, index) => row.level === index + 1);
  if (!numbered) problems.push('Levels must be numbered 1, 2, 3 and so on, with no gap and no repeat');

  if (ordered.some((row) => !Number.isInteger(row.xp) || row.xp < 0 || row.xp > LADDER_MAX_XP)) {
    problems.push(`XP must be a whole number from 0 to ${LADDER_MAX_XP}`);
    return problems;
  }

  if (ordered.length > 0 && ordered[0].xp !== 0) problems.push('The first level must start at 0 XP, so a new learner has a level');
  if (numbered) {
    ordered.slice(1).forEach((row, index) => {
      if (row.xp <= ordered[index].xp) problems.push(`Level ${row.level} needs more XP than level ${row.level - 1}`);
    });
  }
  return problems;
};

export const ladderFingerprint = (rows: ReadonlyArray<LevelRow>): string =>
  createHash('sha1')
    .update(byLevel(rows).map((row) => `${row.level}:${row.xp}`).join(','))
    .digest('hex')
    .slice(0, 16);

export const sameLadder = (left: ReadonlyArray<LevelRow>, right: ReadonlyArray<LevelRow>): boolean =>
  left.length === right.length && ladderFingerprint(left) === ladderFingerprint(right);
