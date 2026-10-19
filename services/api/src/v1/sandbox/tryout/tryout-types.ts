export const SUBTEST_KEYS = [
  'penalaran-umum',
  'ppu',
  'pbm',
  'pengetahuan-kuantitatif',
  'literasi-indonesia',
  'literasi-inggris',
  'penalaran-matematika',
] as const;

export type SubtestKey = (typeof SUBTEST_KEYS)[number];

export interface TryoutPassage {
  id: string;
  title: string;
  text: string;
}

export interface TryoutItem {
  id: string;
  subtest: SubtestKey;
  section: string;
  conceptId: string;
  stem: string;
  passage?: TryoutPassage;
  options: string[];
  answer: number;
  explanation: string;
}

export type ItemDraft = Omit<TryoutItem, 'id'>;

export type TryoutItemView = Omit<TryoutItem, 'answer' | 'explanation'>;

export interface PlanEntry {
  key: SubtestKey;
  count: number;
}

export interface TryoutPlan {
  examKey: string;
  subtests: PlanEntry[];
}

export interface SubtestInfo {
  key: SubtestKey;
  title: string;
  component: 'TPS' | 'LITERASI';
  officialCount: number;
  officialSeconds: number;
  secondsPerItem: number;
  maxCount: number;
  description: string;
  conceptIds: string[];
}
