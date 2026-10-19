import type {
  HistorySort,
  ScoreBand,
  SubtestKey,
  TryoutPlan,
  TryoutPlanEntry,
  TryoutQuestion,
  TryoutReviewItem,
  TryoutSubtestInfo,
} from '~/interfaces/sandbox/tryout'

export const UTBK_COURSE_SLUG = 'utbk-snbt'
export const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E'] as const
export const SAVE_DELAY_MS = 700
export const LOW_TIME_SECONDS = 5 * 60
export const CRITICAL_TIME_SECONDS = 60

export const optionLetter = (index: number): string => OPTION_LETTERS[index] ?? String(index + 1)

export function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const seconds = safe % 60
  const pad = (value: number) => String(value).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`
}

export function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.round(totalSeconds))
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const seconds = safe % 60
  const parts: string[] = []
  if (hours > 0) parts.push(`${hours} jam`)
  if (minutes > 0) parts.push(`${minutes} menit`)
  if (seconds > 0 && hours === 0) parts.push(`${seconds} detik`)
  return parts.length > 0 ? parts.join(' ') : '0 detik'
}

export type TimerTone = 'normal' | 'warning' | 'danger'

export function timerTone(remainingSeconds: number): TimerTone {
  if (remainingSeconds <= CRITICAL_TIME_SECONDS) return 'danger'
  if (remainingSeconds <= LOW_TIME_SECONDS) return 'warning'
  return 'normal'
}

export interface SubtestGroup {
  key: SubtestKey
  title: string
  items: Array<{ index: number; question: TryoutQuestion }>
}

export function groupBySubtest(questions: readonly TryoutQuestion[], titles: Partial<Record<SubtestKey, string>>): SubtestGroup[] {
  const groups: SubtestGroup[] = []
  questions.forEach((question, index) => {
    const last = groups[groups.length - 1]
    if (last && last.key === question.subtest) last.items.push({ index, question })
    else groups.push({ key: question.subtest, title: titles[question.subtest] ?? question.subtest, items: [{ index, question }] })
  })
  return groups
}

export const answeredCount = (answers: Record<string, number>): number => Object.keys(answers).length

export function unansweredIndexes(questions: readonly TryoutQuestion[], answers: Record<string, number>): number[] {
  return questions.flatMap((question, index) => (question.id in answers ? [] : [index]))
}

export type AnswerDiff = Record<string, number | null>

export function diffAnswers(saved: Record<string, number>, current: Record<string, number>): AnswerDiff {
  const diff: AnswerDiff = {}
  for (const [id, choice] of Object.entries(current)) if (saved[id] !== choice) diff[id] = choice
  for (const id of Object.keys(saved)) if (!(id in current)) diff[id] = null
  return diff
}

export const hasChanges = (diff: AnswerDiff): boolean => Object.keys(diff).length > 0

export interface BuilderSelection {
  [key: string]: { selected: boolean; count: number }
}

export function clampCount(value: number, max: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.min(Math.max(1, Math.floor(value)), Math.max(1, max))
}

export function initialSelection(subtests: readonly TryoutSubtestInfo[]): BuilderSelection {
  return Object.fromEntries(subtests.map((subtest) => [subtest.key, { selected: false, count: Math.min(10, subtest.maxCount) }]))
}

export function selectionFromPreset(subtests: readonly TryoutSubtestInfo[], entries: readonly TryoutPlanEntry[]): BuilderSelection {
  const base = initialSelection(subtests)
  for (const entry of entries) base[entry.key] = { selected: true, count: entry.count }
  return base
}

export function planFromSelection(subtests: readonly TryoutSubtestInfo[], selection: BuilderSelection): TryoutPlan {
  return {
    examKey: 'utbk-snbt',
    subtests: subtests.flatMap((subtest) => {
      const state = selection[subtest.key]
      return state?.selected ? [{ key: subtest.key, count: clampCount(state.count, subtest.maxCount) }] : []
    }),
  }
}

export function planTotals(subtests: readonly TryoutSubtestInfo[], plan: TryoutPlan): { items: number; seconds: number } {
  const byKey = new Map(subtests.map((subtest) => [subtest.key, subtest]))
  return plan.subtests.reduce(
    (totals, entry) => ({
      items: totals.items + entry.count,
      seconds: totals.seconds + Math.ceil(entry.count * (byKey.get(entry.key)?.secondsPerItem ?? 60)),
    }),
    { items: 0, seconds: 0 },
  )
}

export type ReviewFilter = 'all' | 'wrong' | 'blank'

export const REVIEW_FILTER_LABEL: Record<ReviewFilter, string> = { all: 'Semua soal', wrong: 'Yang salah', blank: 'Belum dijawab' }

export interface ReviewEntry {
  index: number
  item: TryoutReviewItem
}

export function filterReview(review: readonly TryoutReviewItem[], filter: ReviewFilter, subtest: SubtestKey | 'all' = 'all'): ReviewEntry[] {
  return review.flatMap((item, index) => {
    if (subtest !== 'all' && item.subtest !== subtest) return []
    if (filter === 'wrong' && (item.correct || item.chosen === null)) return []
    if (filter === 'blank' && item.chosen !== null) return []
    return [{ index, item }]
  })
}

export function reviewSubtests(review: readonly TryoutReviewItem[], titles: Partial<Record<SubtestKey, string>>): Array<{ key: SubtestKey; title: string; count: number }> {
  const order: SubtestKey[] = []
  const counts = new Map<SubtestKey, number>()
  for (const item of review) {
    if (!counts.has(item.subtest)) order.push(item.subtest)
    counts.set(item.subtest, (counts.get(item.subtest) ?? 0) + 1)
  }
  return order.map((key) => ({ key, title: titles[key] ?? key, count: counts.get(key) ?? 0 }))
}

export const BAND_LABEL: Record<ScoreBand, string> = {
  SANGAT_BAIK: 'Sangat baik (80% ke atas)',
  BAIK: 'Baik (60% sampai di bawah 80%)',
  CUKUP: 'Cukup (40% sampai di bawah 60%)',
  LATIH: 'Perlu banyak latihan (di bawah 40%)',
}

export const SORT_LABEL: Record<HistorySort, string> = {
  NEWEST: 'Terbaru',
  OLDEST: 'Terlama',
  HIGHEST: 'Skor tertinggi',
  LOWEST: 'Skor terendah',
}

export const HISTORY_PAGE_SIZE = 8

export function scoreBand(percent: number): { label: string; tone: 'success' | 'info' | 'warning' | 'error' } {
  if (percent >= 80) return { label: 'Sangat baik', tone: 'success' }
  if (percent >= 60) return { label: 'Baik', tone: 'info' }
  if (percent >= 40) return { label: 'Cukup, perlu diperkuat', tone: 'warning' }
  return { label: 'Perlu banyak latihan', tone: 'error' }
}

export const formatPercent = (value: number): string => `${String(value).replace('.', ',')}%`

export function secondsPerQuestionText(usedSeconds: number, answered: number): string {
  if (answered <= 0) return 'Belum ada soal yang dijawab'
  return `${formatDuration(Math.round(usedSeconds / answered))} per soal yang dijawab`
}

export function serverOffsetMs(serverNowIso: string, clientNowMs: number): number {
  const serverNow = Date.parse(serverNowIso)
  return Number.isFinite(serverNow) ? serverNow - clientNowMs : 0
}

export function remainingFrom(deadlineIso: string, offsetMs: number, clientNowMs: number): number {
  const deadline = Date.parse(deadlineIso)
  if (!Number.isFinite(deadline)) return 0
  return Math.max(0, Math.ceil((deadline - (clientNowMs + offsetMs)) / 1000))
}
export const REVIEW_PAGE_STEP = 10
