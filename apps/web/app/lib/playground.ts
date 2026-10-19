export type PlaygroundMode = 'ACCOUNTING' | 'SQL' | 'TRYOUT' | 'TUTOR'

export interface CourseRef {
  slug: string
  title: string
}

export interface PlaygroundDefinition {
  mode: Exclude<PlaygroundMode, 'TUTOR'>
  title: string
  summary: string
  action: string
  to: string
  icon: string
}

export const PLAYGROUNDS: ReadonlyArray<PlaygroundDefinition> = [
  {
    mode: 'ACCOUNTING',
    title: 'Latihan jurnal akuntansi',
    summary: 'Catat transaksi nyata ke dalam jurnal. Setiap pemeriksaan menunjukkan baris mana yang sudah tepat dan mengapa.',
    action: 'Buka latihan jurnal',
    to: '/sandbox/akuntansi',
    icon: 'i-lucide-calculator',
  },
  {
    mode: 'SQL',
    title: 'Latihan SQL',
    summary: 'Tulis dan jalankan SQL pada basis data PostgreSQL contoh, dari memilih data sampai merancang tabel.',
    action: 'Buka latihan SQL',
    to: '/sandbox/sql',
    icon: 'i-lucide-database',
  },
  {
    mode: 'TRYOUT',
    title: 'Tryout UTBK-SNBT',
    summary: 'Buat paket soal dengan waktu mengikuti kerangka resmi, lalu lihat skor tiap subtes dan bagian yang perlu dilatih.',
    action: 'Buat tryout',
    to: '/sandbox/tryout',
    icon: 'i-lucide-timer',
  },
]

const MODE_PATTERNS: ReadonlyArray<readonly [PlaygroundMode, RegExp]> = [
  ['TRYOUT', /\b(utbk|snbt|snpmb|tryout|try out)\b/],
  ['SQL', /\bsql\b|mysql|postgres|basis data|database/],
  ['ACCOUNTING', /\bakuntansi\b|\baccounting\b|\bpembukuan\b|\bjurnal umum\b/],
]

export function modeForCourse(course: CourseRef): PlaygroundMode {
  const text = `${course.slug} ${course.title}`.toLowerCase().replace(/[-_]+/g, ' ')
  const match = MODE_PATTERNS.find(([, pattern]) => pattern.test(text))
  return match ? match[0] : 'TUTOR'
}

export interface CoursePlayground {
  mode: PlaygroundMode
  title: string
  action: string
  to: string
}

export function playgroundForCourse(course: CourseRef): CoursePlayground {
  const mode = modeForCourse(course)
  const found = PLAYGROUNDS.find((playground) => playground.mode === mode)
  if (found) return { mode, title: found.title, action: found.action, to: found.to }
  return { mode: 'TUTOR', title: 'Latihan bersama tutor', action: 'Latihan di course', to: `/my-learning/topics/${encodeURIComponent(course.slug)}` }
}

export type CourseModeFilter = 'ALL' | PlaygroundMode

export const COURSE_MODE_LABEL: Record<CourseModeFilter, string> = {
  ALL: 'Semua jenis',
  ACCOUNTING: 'Jurnal akuntansi',
  SQL: 'SQL',
  TRYOUT: 'Tryout',
  TUTOR: 'Latihan di course',
}

export const COURSE_MODE_ORDER: ReadonlyArray<CourseModeFilter> = ['ALL', 'SQL', 'ACCOUNTING', 'TRYOUT', 'TUTOR']

export interface CourseFilter {
  mode: CourseModeFilter
  q: string
}

export function filterCourses<T extends CourseRef>(courses: readonly T[], filter: CourseFilter): T[] {
  const needle = filter.q.trim().toLowerCase()
  return courses.filter((course) => {
    if (filter.mode !== 'ALL' && modeForCourse(course) !== filter.mode) return false
    return needle === '' || course.title.toLowerCase().includes(needle)
  })
}

export function modeCounts(courses: readonly CourseRef[]): Record<CourseModeFilter, number> {
  const counts: Record<CourseModeFilter, number> = { ALL: courses.length, ACCOUNTING: 0, SQL: 0, TRYOUT: 0, TUTOR: 0 }
  for (const course of courses) counts[modeForCourse(course)] += 1
  return counts
}
export const COURSE_PAGE_STEP = 6
