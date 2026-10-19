import { describe, expect, it } from 'vitest'
import type { TryoutQuestion, TryoutReviewItem, TryoutSubtestInfo } from '~/interfaces/sandbox/tryout'
import {
  BAND_LABEL,
  HISTORY_PAGE_SIZE,
  SORT_LABEL,
  clampCount,
  diffAnswers,
  filterReview,
  formatClock,
  formatDuration,
  formatPercent,
  groupBySubtest,
  initialSelection,
  optionLetter,
  planFromSelection,
  planTotals,
  reviewSubtests,
  remainingFrom,
  scoreBand,
  secondsPerQuestionText,
  selectionFromPreset,
  serverOffsetMs,
  timerTone,
  unansweredIndexes,
} from '~/lib/tryout'

const info = (key: TryoutSubtestInfo['key'], maxCount: number, secondsPerItem: number): TryoutSubtestInfo => ({
  key,
  title: key,
  component: 'TPS',
  officialCount: 20,
  officialSeconds: 20 * secondsPerItem,
  secondsPerItem,
  maxCount,
  description: '',
  conceptIds: [],
})

const SUBTESTS = [info('penalaran-umum', 30, 60), info('ppu', 20, 45), info('penalaran-matematika', 20, 127.5)]

const question = (id: string, subtest: TryoutQuestion['subtest']): TryoutQuestion => ({ id, subtest, section: 's', conceptId: 'c', stem: 'x', options: ['a', 'b', 'c', 'd'] })

describe('time formatting', () => {
  it('formats a countdown clock', () => {
    expect(formatClock(0)).toBe('00:00')
    expect(formatClock(59)).toBe('00:59')
    expect(formatClock(605)).toBe('10:05')
    expect(formatClock(3600)).toBe('1:00:00')
    expect(formatClock(5400)).toBe('1:30:00')
    expect(formatClock(-4)).toBe('00:00')
    expect(formatClock(12.9)).toBe('00:12')
  })

  it('formats a duration in Indonesian words', () => {
    expect(formatDuration(0)).toBe('0 detik')
    expect(formatDuration(45)).toBe('45 detik')
    expect(formatDuration(80)).toBe('1 menit 20 detik')
    expect(formatDuration(1800)).toBe('30 menit')
    expect(formatDuration(5400)).toBe('1 jam 30 menit')
    expect(formatDuration(11700)).toBe('3 jam 15 menit')
  })

  it('warns as the time runs low', () => {
    expect(timerTone(1800)).toBe('normal')
    expect(timerTone(300)).toBe('warning')
    expect(timerTone(61)).toBe('warning')
    expect(timerTone(60)).toBe('danger')
    expect(timerTone(0)).toBe('danger')
  })

  it('counts down against the server clock instead of the device clock', () => {
    const clientNow = 1_000_000
    const offset = serverNowOffset(clientNow, 5000)
    expect(remainingFrom(new Date(clientNow + 5000 + 90_000).toISOString(), offset, clientNow)).toBe(90)
    expect(remainingFrom(new Date(clientNow + 5000 + 90_000).toISOString(), offset, clientNow + 30_000)).toBe(60)
    expect(remainingFrom(new Date(clientNow).toISOString(), offset, clientNow + 60_000)).toBe(0)
    expect(remainingFrom('bukan tanggal', 0, clientNow)).toBe(0)
    expect(serverOffsetMs('bukan tanggal', clientNow)).toBe(0)
  })
})

function serverNowOffset(clientNow: number, ahead: number): number {
  return serverOffsetMs(new Date(clientNow + ahead).toISOString(), clientNow)
}

describe('option letters', () => {
  it('uses letters A to E', () => {
    expect([0, 1, 2, 3, 4].map(optionLetter)).toEqual(['A', 'B', 'C', 'D', 'E'])
    expect(optionLetter(7)).toBe('8')
  })
})

describe('grouping and progress', () => {
  const questions = [question('q1', 'penalaran-umum'), question('q2', 'penalaran-umum'), question('q3', 'ppu'), question('q4', 'penalaran-matematika')]

  it('groups neighbouring questions by subtest and keeps the position', () => {
    const groups = groupBySubtest(questions, { 'penalaran-umum': 'Penalaran Umum', ppu: 'PPU' })
    expect(groups.map((group) => [group.key, group.title, group.items.map((item) => item.index)])).toEqual([
      ['penalaran-umum', 'Penalaran Umum', [0, 1]],
      ['ppu', 'PPU', [2]],
      ['penalaran-matematika', 'penalaran-matematika', [3]],
    ])
  })

  it('lists the questions that still have no answer', () => {
    expect(unansweredIndexes(questions, { q1: 0, q3: 2 })).toEqual([1, 3])
    expect(unansweredIndexes(questions, {})).toEqual([0, 1, 2, 3])
  })
})

describe('diffAnswers', () => {
  it('sends only what changed and clears what was removed', () => {
    expect(diffAnswers({ q1: 1, q2: 2 }, { q1: 1, q2: 3, q3: 0 })).toEqual({ q2: 3, q3: 0 })
    expect(diffAnswers({ q1: 1, q2: 2 }, { q1: 1 })).toEqual({ q2: null })
    expect(diffAnswers({}, {})).toEqual({})
  })

  it('treats the first option as a real answer', () => {
    expect(diffAnswers({}, { q1: 0 })).toEqual({ q1: 0 })
  })
})

describe('the plan builder', () => {
  it('clamps a count to the limit and to at least one', () => {
    expect(clampCount(5, 20)).toBe(5)
    expect(clampCount(99, 20)).toBe(20)
    expect(clampCount(0, 20)).toBe(1)
    expect(clampCount(-3, 20)).toBe(1)
    expect(clampCount(7.9, 20)).toBe(7)
    expect(clampCount(Number.NaN, 20)).toBe(1)
    expect(clampCount(5, 0)).toBe(1)
  })

  it('starts with nothing selected and at most ten questions per subtest', () => {
    const selection = initialSelection(SUBTESTS)
    expect(Object.values(selection).every((state) => !state.selected)).toBe(true)
    expect(selection.ppu.count).toBe(10)
    expect(initialSelection([info('ppu', 6, 45)]).ppu.count).toBe(6)
  })

  it('builds a plan from the selected subtests in the order of the exam', () => {
    const selection = initialSelection(SUBTESTS)
    selection['penalaran-matematika'] = { selected: true, count: 500 }
    selection['penalaran-umum'] = { selected: true, count: 12 }
    expect(planFromSelection(SUBTESTS, selection)).toEqual({
      examKey: 'utbk-snbt',
      subtests: [
        { key: 'penalaran-umum', count: 12 },
        { key: 'penalaran-matematika', count: 20 },
      ],
    })
  })

  it('applies a preset to the selection', () => {
    const selection = selectionFromPreset(SUBTESTS, [{ key: 'ppu', count: 5 }])
    expect(selection.ppu).toEqual({ selected: true, count: 5 })
    expect(selection['penalaran-umum'].selected).toBe(false)
  })

  it('adds up the questions and the time from the official seconds per question', () => {
    const plan = planFromSelection(SUBTESTS, selectionFromPreset(SUBTESTS, [{ key: 'penalaran-umum', count: 30 }, { key: 'ppu', count: 4 }, { key: 'penalaran-matematika', count: 3 }]))
    expect(planTotals(SUBTESTS, plan)).toEqual({ items: 37, seconds: 1800 + 180 + 383 })
    expect(planTotals(SUBTESTS, { examKey: 'utbk-snbt', subtests: [] })).toEqual({ items: 0, seconds: 0 })
  })
})

describe('results', () => {
  const review = (chosen: number | null, correct: boolean): TryoutReviewItem => ({ ...question('q', 'ppu'), chosen, answer: 1, correct, explanation: 'x' })

  it('filters the review', () => {
    const items = [review(1, true), review(2, false), review(null, false), review(0, false)]
    expect(filterReview(items, 'all').map((entry) => entry.index)).toEqual([0, 1, 2, 3])
    expect(filterReview(items, 'wrong').map((entry) => entry.index)).toEqual([1, 3])
    expect(filterReview(items, 'blank').map((entry) => entry.index)).toEqual([2])
  })

  it('names the score band without pretending to be the official score', () => {
    expect(scoreBand(85).tone).toBe('success')
    expect(scoreBand(60).label).toBe('Baik')
    expect(scoreBand(45.5).tone).toBe('warning')
    expect(scoreBand(10).tone).toBe('error')
  })

  it('writes a percent with a decimal comma', () => {
    expect(formatPercent(66.7)).toBe('66,7%')
    expect(formatPercent(100)).toBe('100%')
  })

  it('describes the pace per answered question', () => {
    expect(secondsPerQuestionText(600, 0)).toBe('Belum ada soal yang dijawab')
    expect(secondsPerQuestionText(600, 20)).toBe('30 detik per soal yang dijawab')
  })
})

describe('review by subtest', () => {
  const entry = (subtest: TryoutReviewItem['subtest'], chosen: number | null, correct: boolean): TryoutReviewItem => ({ ...question('q', subtest), chosen, answer: 1, correct, explanation: 'x' })
  const items = [entry('ppu', 1, true), entry('ppu', 2, false), entry('pbm', null, false), entry('pbm', 0, false), entry('penalaran-umum', 1, true)]

  it('narrows the review to one subtest and combines it with the status filter', () => {
    expect(filterReview(items, 'all', 'pbm').map((row) => row.index)).toEqual([2, 3])
    expect(filterReview(items, 'wrong', 'pbm').map((row) => row.index)).toEqual([3])
    expect(filterReview(items, 'blank', 'pbm').map((row) => row.index)).toEqual([2])
    expect(filterReview(items, 'wrong', 'ppu').map((row) => row.index)).toEqual([1])
    expect(filterReview(items, 'all', 'all')).toHaveLength(5)
    expect(filterReview(items, 'all', 'literasi-inggris')).toEqual([])
  })

  it('lists the subtests that appear, in order, with their counts', () => {
    expect(reviewSubtests(items, { ppu: 'PPU', pbm: 'PBM' })).toEqual([
      { key: 'ppu', title: 'PPU', count: 2 },
      { key: 'pbm', title: 'PBM', count: 2 },
      { key: 'penalaran-umum', title: 'penalaran-umum', count: 1 },
    ])
  })
})

describe('history filter labels', () => {
  it('names every band and every sort order', () => {
    expect(Object.keys(BAND_LABEL)).toEqual(['SANGAT_BAIK', 'BAIK', 'CUKUP', 'LATIH'])
    expect(Object.keys(SORT_LABEL)).toEqual(['NEWEST', 'OLDEST', 'HIGHEST', 'LOWEST'])
    expect(BAND_LABEL.LATIH).toContain('40%')
    expect(HISTORY_PAGE_SIZE).toBeGreaterThan(0)
  })
})
