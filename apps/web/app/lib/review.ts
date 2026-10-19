import type { QuizAction } from '~/interfaces/chats/chatExtras'

export const REVIEW_QUERY_KEY = 'ulas'
export const REVIEW_QUESTIONS = 3
const FOCUS_MAX = 200

export type ReviewKind = 'REVIEW' | 'RELEARN'

export interface ReviewEntryView {
  conceptId: string
  title: string
  level: number
  kind: ReviewKind
  score: number
  evidenceCount: number
  daysSince: number
  retrievability: number
  intervalDays: number
  dueAt: string
  overdueDays: number
  target: { userStepId: string; stepTemplateId: string | null } | null
}

export interface ReviewSessionView {
  conceptIds: string[]
  questionsPerConcept: number
  totalQuestions: number
  estimatedMinutes: number
}

export interface ReviewView {
  reminders: boolean
  policyVersion: string
  generatedAt: string
  dueTotal: number
  due: ReviewEntryView[]
  upcoming: ReviewEntryView[]
  session: ReviewSessionView
}

export const reviewHref = (entry: Pick<ReviewEntryView, 'conceptId' | 'target'>): string | null =>
  entry.target
    ? `/my-learning/steps/${entry.target.stepTemplateId ?? entry.target.userStepId}/${entry.target.userStepId}?${REVIEW_QUERY_KEY}=${encodeURIComponent(entry.conceptId)}`
    : null

export const reviewParam = (query: Record<string, unknown>): string | null => {
  const raw = query[REVIEW_QUERY_KEY]
  const value = Array.isArray(raw) ? raw[0] : raw
  return typeof value === 'string' && value.trim().length > 0 ? value.trim().slice(0, 120) : null
}

export const reviewQuiz = (title: string): QuizAction => ({
  type: 'QUIZ',
  count: REVIEW_QUESTIONS,
  focus: `Ulasan singkat: ${title}`.slice(0, FOCUS_MAX),
})

export const firstReviewable = (view: Pick<ReviewView, 'due'>): ReviewEntryView | null =>
  view.due.find((entry) => entry.target !== null) ?? null

export function sessionCopy(session: ReviewSessionView): string {
  if (session.conceptIds.length === 0) return ''
  const concepts = `${session.conceptIds.length} konsep`
  return `${concepts} · ${session.totalQuestions} soal · sekitar ${session.estimatedMinutes} menit`
}

export function agoCopy(days: number): string {
  if (days < 1) return 'hari ini'
  const whole = Math.floor(days)
  return whole === 1 ? 'kemarin' : `${whole} hari lalu`
}

export const rememberPercent = (retrievability: number): number => Math.max(0, Math.min(100, Math.round(retrievability * 100)))

export function entryHint(entry: ReviewEntryView): string {
  const last = `Terakhir dikerjakan ${agoCopy(entry.daysSince)}.`
  if (entry.kind === 'RELEARN') return `${last} Penguasaanmu ${Math.round(entry.score * 100)}%, ulangi supaya naik.`
  return `${last} Kemungkinan masih kamu ingat ${rememberPercent(entry.retrievability)}%.`
}

export function dueSoonCopy(entry: Pick<ReviewEntryView, 'dueAt'>, now: Date): string {
  const days = (new Date(entry.dueAt).getTime() - now.getTime()) / 86_400_000
  if (!Number.isFinite(days)) return ''
  if (days <= 0.5) return 'hari ini'
  if (days < 1.5) return 'besok'
  return `${Math.round(days)} hari lagi`
}

export function headline(view: Pick<ReviewView, 'dueTotal'>): string {
  if (view.dueTotal === 0) return 'Belum ada yang perlu diulang'
  return view.dueTotal === 1 ? '1 konsep siap diulang' : `${view.dueTotal} konsep siap diulang`
}

export const REMINDER_HOUR_LABEL = '18.00 WIB'

export const reminderStatus = (enabled: boolean): string =>
  enabled
    ? `Pengingat harian aktif: kamu diberi tahu pukul ${REMINDER_HOUR_LABEL} jika ada konsep yang perlu diulang, paling banyak sekali sehari.`
    : 'Pengingat harian mati. Kamu tidak akan menerima notifikasi ulasan.'
