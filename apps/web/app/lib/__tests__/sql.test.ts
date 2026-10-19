import { describe, expect, it } from 'vitest'
import type { SqlExerciseSummary, SqlStatementOutput } from '~/interfaces/sandbox/sql'
import {
  VERDICT_HEADLINE,
  cellText,
  filterExercises,
  groupExercises,
  hintButtonLabel,
  isNumericCell,
  nextExerciseId,
  outputSummary,
  progressPercent,
  sqlLevelLabel,
  verdictTone,
} from '~/lib/sql'

const exercise = (id: string, level: number, status: 'NEW' | 'IN_PROGRESS' | 'SOLVED' = 'NEW'): SqlExerciseSummary => ({
  id,
  datasetId: 'toko-online',
  level,
  subTopic: 'x',
  title: id,
  task: 'tugas',
  ordered: false,
  hintCount: 3,
  progress: { status, attempts: 0, hintLevel: 0, hints: [], revealed: false, solvedAt: null, lastSql: null },
})

const output = (patch: Partial<SqlStatementOutput>): SqlStatementOutput => ({
  sql: 'SELECT 1',
  verb: 'select',
  kind: 'query',
  columns: ['a'],
  rows: [['1']],
  rowCount: 1,
  truncated: false,
  elapsedMs: 1,
  ...patch,
})

describe('groupExercises', () => {
  it('groups neighbours of the same level in order', () => {
    const groups = groupExercises([exercise('a', 1), exercise('b', 1), exercise('c', 2), exercise('d', 3), exercise('e', 3)])
    expect(groups.map((group) => [group.level, group.exercises.map((item) => item.id)])).toEqual([
      [1, ['a', 'b']],
      [2, ['c']],
      [3, ['d', 'e']],
    ])
    expect(groups[0].label).toBe(sqlLevelLabel(1))
  })

  it('returns nothing for no exercises', () => {
    expect(groupExercises([])).toEqual([])
  })
})

describe('nextExerciseId', () => {
  const list = [exercise('a', 1, 'SOLVED'), exercise('b', 1), exercise('c', 2, 'SOLVED'), exercise('d', 2, 'IN_PROGRESS')]

  it('moves to the next unsolved exercise after the current one', () => {
    expect(nextExerciseId(list, 'a')).toBe('b')
    expect(nextExerciseId(list, 'b')).toBe('d')
  })

  it('wraps around to an earlier unsolved exercise', () => {
    expect(nextExerciseId(list, 'd')).toBe('b')
  })

  it('starts from the top without a current exercise', () => {
    expect(nextExerciseId(list, null)).toBe('b')
  })

  it('answers null when everything else is solved', () => {
    expect(nextExerciseId([exercise('a', 1, 'SOLVED'), exercise('b', 1, 'SOLVED')], 'a')).toBeNull()
    expect(nextExerciseId([], null)).toBeNull()
  })
})

describe('result cells', () => {
  it('shows NULL for a missing value and the text otherwise', () => {
    expect(cellText(null)).toBe('NULL')
    expect(cellText('Bandung')).toBe('Bandung')
    expect(cellText('')).toBe('')
  })

  it('recognises numbers so they can be right aligned', () => {
    expect(isNumericCell('12')).toBe(true)
    expect(isNumericCell('-3.50')).toBe(true)
    expect(isNumericCell('2025-04-01')).toBe(false)
    expect(isNumericCell('12a')).toBe(false)
    expect(isNumericCell(null)).toBe(false)
  })
})

describe('outputSummary', () => {
  it('counts the rows of a query and tells when the list is cut', () => {
    expect(outputSummary(output({ rowCount: 5, rows: [['1'], ['2'], ['3'], ['4'], ['5']] }))).toBe('SELECT: 5 baris')
    expect(outputSummary(output({ rowCount: 200, truncated: true, rows: Array.from({ length: 200 }, () => ['1']) }))).toBe('SELECT: 200 baris, 200 baris pertama ditampilkan')
  })

  it('reports the rows a change touched', () => {
    expect(outputSummary(output({ verb: 'insert', kind: 'command', columns: [], rows: [], rowCount: 1 }))).toBe('INSERT: 1 baris terpengaruh')
    expect(outputSummary(output({ verb: 'delete', kind: 'command', columns: [], rows: [], rowCount: 0 }))).toBe('DELETE: 0 baris terpengaruh')
  })

  it('reports a definition statement without a count', () => {
    expect(outputSummary(output({ verb: 'create', kind: 'command', columns: [], rows: [], rowCount: null }))).toBe('CREATE berhasil dijalankan')
  })
})

describe('verdicts and hints', () => {
  it('has a headline for every verdict and a tone that matches', () => {
    for (const verdict of Object.keys(VERDICT_HEADLINE) as Array<keyof typeof VERDICT_HEADLINE>) expect(VERDICT_HEADLINE[verdict].length).toBeGreaterThan(5)
    expect(verdictTone('MATCH')).toBe('success')
    expect(verdictTone('ERROR')).toBe('error')
    expect(verdictTone('REJECTED')).toBe('error')
    expect(verdictTone('VALUES')).toBe('warning')
    expect(verdictTone('ORDER')).toBe('warning')
  })

  it('labels the hint button by progress', () => {
    expect(hintButtonLabel(0, 3)).toBe('Minta petunjuk')
    expect(hintButtonLabel(1, 3)).toBe('Petunjuk berikutnya (1/3)')
    expect(hintButtonLabel(3, 3)).toBe('Semua petunjuk terbuka')
  })

  it('rounds progress to a whole percent', () => {
    expect(progressPercent(0, 0)).toBe(0)
    expect(progressPercent(1, 3)).toBe(33)
    expect(progressPercent(16, 16)).toBe(100)
  })
})

describe('filterExercises', () => {
  const list = [
    { ...exercise('pelanggan-bandung', 1, 'SOLVED'), title: 'Pelanggan dari Bandung', subTopic: 'Memilih data', task: 'Tampilkan pelanggan kota Bandung.' },
    { ...exercise('produk-mahal', 1), title: 'Produk di atas 200.000', subTopic: 'Memilih data', task: 'Tampilkan produk mahal.' },
    { ...exercise('tambah', 2, 'IN_PROGRESS'), title: 'Tambah pelanggan baru', subTopic: 'Mengubah data', task: 'Tambahkan satu baris.' },
    { ...exercise('join', 3), title: 'Pesanan selesai', subTopic: 'Menggabungkan tabel', task: 'Gabungkan pelanggan dan pesanan.' },
  ]
  const ids = (items: SqlExerciseSummary[]) => items.map((item) => item.id)

  it('keeps everything without a filter', () => {
    expect(ids(filterExercises(list, { q: '', status: 'ALL', level: null }))).toEqual(['pelanggan-bandung', 'produk-mahal', 'tambah', 'join'])
  })

  it('filters by status and by level', () => {
    expect(ids(filterExercises(list, { q: '', status: 'SOLVED', level: null }))).toEqual(['pelanggan-bandung'])
    expect(ids(filterExercises(list, { q: '', status: 'NEW', level: null }))).toEqual(['produk-mahal', 'join'])
    expect(ids(filterExercises(list, { q: '', status: 'ALL', level: 2 }))).toEqual(['tambah'])
  })

  it('searches the title, the task and the sub topic', () => {
    expect(ids(filterExercises(list, { q: 'pelanggan', status: 'ALL', level: null }))).toEqual(['pelanggan-bandung', 'tambah', 'join'])
    expect(ids(filterExercises(list, { q: 'MENGGABUNGKAN', status: 'ALL', level: null }))).toEqual(['join'])
    expect(ids(filterExercises(list, { q: 'satu baris', status: 'ALL', level: null }))).toEqual(['tambah'])
  })

  it('combines the filters and may end with nothing', () => {
    expect(ids(filterExercises(list, { q: 'pelanggan', status: 'NEW', level: 3 }))).toEqual(['join'])
    expect(filterExercises(list, { q: 'pelanggan', status: 'SOLVED', level: 3 })).toEqual([])
  })
})
