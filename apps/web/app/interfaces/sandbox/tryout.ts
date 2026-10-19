import type { PageInfo } from '~/lib/paging'

export type SubtestKey =
  | 'penalaran-umum'
  | 'ppu'
  | 'pbm'
  | 'pengetahuan-kuantitatif'
  | 'literasi-indonesia'
  | 'literasi-inggris'
  | 'penalaran-matematika'

export interface TryoutSubtestInfo {
  key: SubtestKey
  title: string
  component: 'TPS' | 'LITERASI'
  officialCount: number
  officialSeconds: number
  secondsPerItem: number
  maxCount: number
  description: string
  conceptIds: string[]
}

export interface TryoutPlanEntry {
  key: SubtestKey
  count: number
}

export interface TryoutPlan {
  examKey: 'utbk-snbt'
  subtests: TryoutPlanEntry[]
}

export interface TryoutPreset {
  id: string
  title: string
  description: string
  subtests: TryoutPlanEntry[]
  itemCount: number
  durationSeconds: number
}

export interface TryoutActiveSummary {
  id: string
  startedAt: string
  deadlineAt: string
  remainingSeconds: number
  total: number
  answered: number
  subtests: TryoutPlanEntry[]
}

export interface TryoutRecentSummary {
  id: string
  startedAt: string
  submittedAt: string | null
  total: number
  correct: number
  percent: number
  usedSeconds: number
  subtests: Array<{ key: SubtestKey; title: string; total: number; percent: number }>
}

export interface TryoutCatalog {
  exam: { key: string; title: string; scoring: string }
  subtests: TryoutSubtestInfo[]
  presets: TryoutPreset[]
  active: TryoutActiveSummary | null
  recent: TryoutRecentSummary[]
}

export interface TryoutPassage {
  id: string
  title: string
  text: string
}

export interface TryoutQuestion {
  id: string
  subtest: SubtestKey
  section: string
  conceptId: string
  stem: string
  passage?: TryoutPassage
  options: string[]
}

export interface TryoutSession {
  id: string
  examKey: string
  status: 'IN_PROGRESS' | 'SUBMITTED'
  startedAt: string
  submittedAt: string | null
  durationSeconds: number
  total: number
  subtests: Array<TryoutPlanEntry & { title: string }>
  deadlineAt: string
  serverNow: string
  remainingSeconds: number
  items: TryoutQuestion[]
  answers: Record<string, number>
}

export interface TryoutSavedAnswers {
  saved: number
  total: number
  remainingSeconds: number
}

export interface TryoutSubtestResult {
  key: SubtestKey
  title: string
  total: number
  answered: number
  correct: number
  percent: number
}

export interface TryoutConceptResult {
  conceptId: string
  title: string
  total: number
  correct: number
  percent: number
}

export interface TryoutReviewItem extends TryoutQuestion {
  chosen: number | null
  answer: number
  correct: boolean
  explanation: string
}

export interface TryoutResult {
  id: string
  examKey: string
  startedAt: string
  submittedAt: string | null
  total: number
  answered: number
  correct: number
  percent: number
  usedSeconds: number
  durationSeconds: number
  timedOut: boolean
  subtests: TryoutSubtestResult[]
  concepts: TryoutConceptResult[]
  weakConceptIds: string[]
  review: TryoutReviewItem[]
}

export type ScoreBand = 'SANGAT_BAIK' | 'BAIK' | 'CUKUP' | 'LATIH'

export type HistorySort = 'NEWEST' | 'OLDEST' | 'HIGHEST' | 'LOWEST'

export interface TryoutHistoryQuery {
  band?: ScoreBand
  subtest?: SubtestKey
  sort?: HistorySort
  limit?: number
  cursor?: number
}

export interface TryoutHistory {
  items: TryoutRecentSummary[]
  page: PageInfo
}
