import { HistorySort, ScoreBand } from '../dto/tryout.dto';

export const HISTORY_SCAN_LIMIT = 200;
export const HISTORY_PAGE_SIZE = 10;

export interface HistoryEntry {
  id: string;
  startedAt: Date;
  submittedAt: Date | null;
  total: number;
  correct: number;
  percent: number;
  usedSeconds: number;
  subtests: Array<{ key: string; title: string; total: number; percent: number }>;
}

export const bandOf = (percent: number): ScoreBand => {
  if (percent >= 80) return 'SANGAT_BAIK';
  if (percent >= 60) return 'BAIK';
  if (percent >= 40) return 'CUKUP';
  return 'LATIH';
};

const finishedAt = (entry: HistoryEntry): number => (entry.submittedAt ?? entry.startedAt).getTime();

const COMPARERS: Record<HistorySort, (a: HistoryEntry, b: HistoryEntry) => number> = {
  NEWEST: (a, b) => finishedAt(b) - finishedAt(a),
  OLDEST: (a, b) => finishedAt(a) - finishedAt(b),
  HIGHEST: (a, b) => b.percent - a.percent || finishedAt(b) - finishedAt(a),
  LOWEST: (a, b) => a.percent - b.percent || finishedAt(b) - finishedAt(a),
};

export const filterHistory = (entries: readonly HistoryEntry[], filter: { band?: ScoreBand; subtest?: string; sort: HistorySort }): HistoryEntry[] =>
  entries
    .filter((entry) => !filter.band || bandOf(entry.percent) === filter.band)
    .filter((entry) => !filter.subtest || entry.subtests.some((subtest) => subtest.key === filter.subtest))
    .sort(COMPARERS[filter.sort]);
