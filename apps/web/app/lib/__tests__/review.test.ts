import { describe, expect, it } from 'vitest'
import {
  REMINDER_HOUR_LABEL,
  REVIEW_QUESTIONS,
  agoCopy,
  dueSoonCopy,
  entryHint,
  firstReviewable,
  headline,
  rememberPercent,
  reviewHref,
  reviewParam,
  reminderStatus,
  reviewQuiz,
  sessionCopy,
  type ReviewEntryView,
} from '~/lib/review'

const entry = (overrides: Partial<ReviewEntryView> = {}): ReviewEntryView => ({
  conceptId: 'l1-t01-accounting-equation',
  title: 'Persamaan akuntansi',
  level: 1,
  kind: 'REVIEW',
  score: 0.82,
  evidenceCount: 4,
  daysSince: 12.4,
  retrievability: 0.62,
  intervalDays: 6,
  dueAt: '2026-10-10T00:00:00.000Z',
  overdueDays: 6.4,
  target: { userStepId: 'us-1', stepTemplateId: 'step-1' },
  ...overrides,
})

describe('reviewHref', () => {
  it('opens the step of the learner with the concept to review in the query', () => {
    expect(reviewHref(entry())).toBe('/my-learning/steps/step-1/us-1?ulas=l1-t01-accounting-equation')
  })

  it('falls back to the user step id when the step has no template', () => {
    expect(reviewHref(entry({ target: { userStepId: 'us-9', stepTemplateId: null } }))).toBe('/my-learning/steps/us-9/us-9?ulas=l1-t01-accounting-equation')
  })

  it('has no link when the learner has no step that teaches the concept', () => {
    expect(reviewHref(entry({ target: null }))).toBeNull()
  })

  it('escapes the concept id', () => {
    expect(reviewHref(entry({ conceptId: 'a b&c' }))).toContain('ulas=a%20b%26c')
  })
})

describe('reviewParam', () => {
  it('reads the concept id from the query', () => {
    expect(reviewParam({ ulas: 'c1' })).toBe('c1')
    expect(reviewParam({ ulas: ['c1', 'c2'] })).toBe('c1')
    expect(reviewParam({ ulas: '  c1  ' })).toBe('c1')
  })

  it.each([[{}], [{ ulas: '' }], [{ ulas: '   ' }], [{ ulas: 5 }], [{ ulas: [] }], [{ other: 'x' }]])('is null for %j', (query) => {
    expect(reviewParam(query as Record<string, unknown>)).toBeNull()
  })

  it('cuts an absurdly long value', () => {
    expect(reviewParam({ ulas: 'x'.repeat(500) })?.length).toBe(120)
  })
})

describe('reviewQuiz', () => {
  it('asks for a short quiz about the concept', () => {
    expect(reviewQuiz('Persamaan akuntansi')).toEqual({ type: 'QUIZ', count: REVIEW_QUESTIONS, focus: 'Ulasan singkat: Persamaan akuntansi' })
  })

  it('keeps the focus inside the limit of the server', () => {
    expect(reviewQuiz('x'.repeat(400)).focus?.length).toBe(200)
  })
})

describe('firstReviewable', () => {
  it('skips a concept the learner cannot open', () => {
    const first = entry({ conceptId: 'a', target: null })
    const second = entry({ conceptId: 'b' })

    expect(firstReviewable({ due: [first, second] })?.conceptId).toBe('b')
  })

  it('is null when nothing can be opened', () => {
    expect(firstReviewable({ due: [entry({ target: null })] })).toBeNull()
    expect(firstReviewable({ due: [] })).toBeNull()
  })
})

describe('copy', () => {
  it('describes the session by concepts, questions and minutes', () => {
    expect(sessionCopy({ conceptIds: ['a', 'b', 'c'], questionsPerConcept: 3, totalQuestions: 9, estimatedMinutes: 6 })).toBe('3 konsep · 9 soal · sekitar 6 menit')
    expect(sessionCopy({ conceptIds: [], questionsPerConcept: 3, totalQuestions: 0, estimatedMinutes: 0 })).toBe('')
  })

  it.each([
    [0, 'hari ini'],
    [0.9, 'hari ini'],
    [1, 'kemarin'],
    [1.9, 'kemarin'],
    [12.4, '12 hari lalu'],
  ])('says %f days as %s', (days, expected) => {
    expect(agoCopy(days)).toBe(expected)
  })

  it('shows how much the learner probably remembers, kept between 0 and 100', () => {
    expect(rememberPercent(0.624)).toBe(62)
    expect(rememberPercent(1.4)).toBe(100)
    expect(rememberPercent(-1)).toBe(0)
  })

  it('tells a concept to review from a concept to learn again', () => {
    expect(entryHint(entry())).toBe('Terakhir dikerjakan 12 hari lalu. Kemungkinan masih kamu ingat 62%.')
    expect(entryHint(entry({ kind: 'RELEARN', score: 0.5 }))).toBe('Terakhir dikerjakan 12 hari lalu. Penguasaanmu 50%, ulangi supaya naik.')
  })

  it('says when an upcoming review is due', () => {
    const now = new Date('2026-10-16T00:00:00.000Z')

    expect(dueSoonCopy({ dueAt: '2026-10-16T06:00:00.000Z' }, now)).toBe('hari ini')
    expect(dueSoonCopy({ dueAt: '2026-10-17T00:00:00.000Z' }, now)).toBe('besok')
    expect(dueSoonCopy({ dueAt: '2026-10-20T00:00:00.000Z' }, now)).toBe('4 hari lagi')
    expect(dueSoonCopy({ dueAt: 'not a date' }, now)).toBe('')
  })

  it('has a headline for none, one and many', () => {
    expect(headline({ dueTotal: 0 })).toBe('Belum ada yang perlu diulang')
    expect(headline({ dueTotal: 1 })).toBe('1 konsep siap diulang')
    expect(headline({ dueTotal: 4 })).toBe('4 konsep siap diulang')
  })
})

describe('reminderStatus', () => {
  it('says when the daily reminder comes and that it is at most once a day', () => {
    const text = reminderStatus(true)
    expect(text).toContain(REMINDER_HOUR_LABEL)
    expect(text).toContain('paling banyak sekali sehari')
  })

  it('says plainly that nothing will be sent when the reminder is off', () => {
    expect(reminderStatus(false)).toBe('Pengingat harian mati. Kamu tidak akan menerima notifikasi ulasan.')
  })
})
