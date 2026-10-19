import type { SqlCell, SqlExerciseSummary, SqlPracticeStatus, SqlStatementOutput, SqlVerdict } from '~/interfaces/sandbox/sql'

export const SQL_STATUS_LABEL: Record<SqlPracticeStatus, string> = { NEW: 'Baru', IN_PROGRESS: 'Dikerjakan', SOLVED: 'Selesai' }

export type SqlTone = 'neutral' | 'success' | 'warning' | 'error' | 'info'

export const SQL_STATUS_TONE: Record<SqlPracticeStatus, SqlTone> = { NEW: 'neutral', IN_PROGRESS: 'info', SOLVED: 'success' }

export const SQL_LEVEL_LABEL: Record<number, string> = {
  1: 'Level 1 · Memilih dan menyaring data',
  2: 'Level 2 · Mengubah data',
  3: 'Level 3 · Menggabungkan dan meringkas data',
  4: 'Level 4 · Merancang tabel',
}

export const sqlLevelLabel = (level: number): string => SQL_LEVEL_LABEL[level] ?? `Level ${level}`

export interface ExerciseGroup {
  level: number
  label: string
  exercises: SqlExerciseSummary[]
}

export function groupExercises(exercises: readonly SqlExerciseSummary[]): ExerciseGroup[] {
  const groups: ExerciseGroup[] = []
  for (const exercise of exercises) {
    const last = groups[groups.length - 1]
    if (last && last.level === exercise.level) last.exercises.push(exercise)
    else groups.push({ level: exercise.level, label: sqlLevelLabel(exercise.level), exercises: [exercise] })
  }
  return groups
}

export function nextExerciseId(exercises: readonly SqlExerciseSummary[], currentId: string | null): string | null {
  if (exercises.length === 0) return null
  const start = currentId ? exercises.findIndex((exercise) => exercise.id === currentId) : -1
  const ordered = [...exercises.slice(start + 1), ...exercises.slice(0, start + 1)]
  const pending = ordered.find((exercise) => exercise.id !== currentId && exercise.progress.status !== 'SOLVED')
  return pending ? pending.id : null
}

export const cellText = (cell: SqlCell): string => (cell === null ? 'NULL' : cell)

export const isNumericCell = (cell: SqlCell): boolean => cell !== null && /^-?\d+(?:\.\d+)?$/.test(cell)

export function outputSummary(output: SqlStatementOutput): string {
  const verb = output.verb.toUpperCase()
  if (output.columns.length > 0) {
    const shown = output.rows.length
    const suffix = output.truncated ? `, ${shown} baris pertama ditampilkan` : ''
    return `${verb}: ${output.rowCount ?? shown} baris${suffix}`
  }
  if (output.rowCount !== null && output.rowCount !== undefined && ['INSERT', 'UPDATE', 'DELETE'].includes(verb)) {
    return `${verb}: ${output.rowCount} baris terpengaruh`
  }
  return `${verb} berhasil dijalankan`
}

export const VERDICT_HEADLINE: Record<SqlVerdict, string> = {
  MATCH: 'Jawabanmu tepat',
  NO_RESULT: 'Belum ada tabel hasil',
  COLUMN_COUNT: 'Jumlah kolom belum sesuai',
  ROW_COUNT: 'Jumlah baris belum sesuai',
  VALUES: 'Isi hasil belum sesuai',
  ORDER: 'Urutan belum sesuai',
  ERROR: 'SQL belum bisa dijalankan',
  REJECTED: 'Pernyataan ini tidak tersedia',
}

export const verdictTone = (verdict: SqlVerdict): SqlTone => {
  if (verdict === 'MATCH') return 'success'
  if (verdict === 'ERROR' || verdict === 'REJECTED') return 'error'
  return 'warning'
}

export const hintButtonLabel = (level: number, total: number): string => {
  if (level >= total) return 'Semua petunjuk terbuka'
  return level === 0 ? 'Minta petunjuk' : `Petunjuk berikutnya (${level}/${total})`
}

export const progressPercent = (solved: number, total: number): number => (total <= 0 ? 0 : Math.round((solved / total) * 100))

export const STARTER_SQL = 'SELECT * FROM pelanggan;'

export const EXPLORE_ID = 'bebas'

export type SqlStatusFilter = 'ALL' | SqlPracticeStatus

export const SQL_STATUS_FILTER_LABEL: Record<SqlStatusFilter, string> = { ALL: 'Semua status', NEW: 'Baru', IN_PROGRESS: 'Dikerjakan', SOLVED: 'Selesai' }

export interface ExerciseFilter {
  q: string
  status: SqlStatusFilter
  level: number | null
}

export function filterExercises(exercises: readonly SqlExerciseSummary[], filter: ExerciseFilter): SqlExerciseSummary[] {
  const needle = filter.q.trim().toLowerCase()
  return exercises.filter((exercise) => {
    if (filter.status !== 'ALL' && exercise.progress.status !== filter.status) return false
    if (filter.level !== null && exercise.level !== filter.level) return false
    return needle === '' || [exercise.title, exercise.task, exercise.subTopic].some((text) => text.toLowerCase().includes(needle))
  })
}

export const EXERCISE_PAGE_STEP = 8
export const OUTPUT_ROW_STEP = 50
