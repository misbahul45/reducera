import { describe, expect, it } from 'vitest'
import type { CheckFinding, SandboxAccount } from '~/interfaces/sandbox/practice'
import {
  MAX_ROWS,
  formatRupiah,
  groupAccounts,
  groupDigits,
  initialRows,
  isBlank,
  journalProblem,
  journalTotals,
  nextHintLabel,
  nextSeed,
  parseRupiah,
  parseSeed,
  progressPercent,
  rowProblem,
  rowsFromLines,
  scaffoldNote,
  scoreText,
  sortFindings,
  toLines,
  variantProgressText,
  type JournalRow,
} from '~/lib/sandbox'

const account = (code: string, name: string, klass: string): SandboxAccount => ({ code, name, type: 'ASSET', group: 'x', class: klass })

const row = (id: number, patch: Partial<JournalRow>): JournalRow => ({ id, account: '', side: 'DEBIT', amount: '', ...patch })

describe('rupiah text', () => {
  it('formats with dots and no decimals', () => {
    expect(formatRupiah(10000000)).toBe('Rp10.000.000')
    expect(formatRupiah(999)).toBe('Rp999')
    expect(formatRupiah(0)).toBe('Rp0')
  })

  it('reads the ways an Indonesian learner types an amount', () => {
    expect(parseRupiah('10.000.000')).toBe(10000000)
    expect(parseRupiah('10000000')).toBe(10000000)
    expect(parseRupiah('Rp 2.500.000')).toBe(2500000)
    expect(parseRupiah('rp500')).toBe(500)
  })

  it('refuses anything that is not a whole rupiah amount in range', () => {
    for (const text of ['', ' ', '0', '10,5', '10.5', '1.00.000', 'abc', '-5', '1e6', '1000000000000']) expect(parseRupiah(text)).toBeNull()
  })

  it('groups digits while typing and drops stray characters and leading zeros', () => {
    expect(groupDigits('1234567')).toBe('1.234.567')
    expect(groupDigits('Rp 1.234')).toBe('1.234')
    expect(groupDigits('0045')).toBe('45')
    expect(groupDigits('abc')).toBe('')
  })
})

describe('journal rows', () => {
  it('starts with one debit and one credit row', () => {
    expect(initialRows().map((item) => item.side)).toEqual(['DEBIT', 'CREDIT'])
  })

  it('restores saved lines with grouped amounts, capped at the maximum', () => {
    const rows = rowsFromLines([{ account: '101', side: 'DEBIT', amount: 1500000 }])
    expect(rows).toEqual([{ id: 1, account: '101', side: 'DEBIT', amount: '1.500.000' }])
    expect(rowsFromLines(Array.from({ length: 20 }, () => ({ account: '101', side: 'DEBIT' as const, amount: 1 })))).toHaveLength(MAX_ROWS)
    expect(rowsFromLines([])).toHaveLength(2)
  })

  it('sends only the rows that are complete', () => {
    const rows = [row(1, { account: '101', amount: '10.000' }), row(2, { account: '301', side: 'CREDIT', amount: '10.000' }), row(3, {}), row(4, { account: '201' })]
    expect(toLines(rows)).toEqual([
      { account: '101', side: 'DEBIT', amount: 10000 },
      { account: '301', side: 'CREDIT', amount: 10000 },
    ])
    expect(isBlank(rows[2]!)).toBe(true)
    expect(isBlank(rows[3]!)).toBe(false)
  })

  it('totals each side and flags a balanced journal only when both sides carry money', () => {
    expect(journalTotals([row(1, { account: '101', amount: '5.000' }), row(2, { account: '301', side: 'CREDIT', amount: '5.000' })])).toEqual({
      debit: 5000,
      credit: 5000,
      difference: 0,
      balanced: true,
    })
    expect(journalTotals([row(1, { account: '101', amount: '5.000' }), row(2, { account: '301', side: 'CREDIT', amount: '4.000' })])).toMatchObject({ difference: 1000, balanced: false })
    expect(journalTotals(initialRows())).toMatchObject({ debit: 0, credit: 0, balanced: false })
  })

  it('points to the row that is half filled', () => {
    expect(rowProblem(row(1, { amount: '5.000' }), 0)).toBe('Baris 1: pilih akunnya.')
    expect(rowProblem(row(1, { account: '101' }), 1)).toBe('Baris 2: isi jumlahnya.')
    expect(rowProblem(row(1, { account: '101', amount: '0' }), 0)).toContain('bilangan bulat rupiah')
    expect(rowProblem(row(1, {}), 0)).toBeNull()
  })

  it('needs at least one complete row and no half filled row', () => {
    expect(journalProblem(initialRows())).toBe('Isi minimal satu baris jurnal dengan akun dan jumlah.')
    expect(journalProblem([row(1, { account: '101', amount: '5.000' }), row(2, { account: '301' })])).toBe('Baris 2: isi jumlahnya.')
    expect(journalProblem([row(1, { account: '101', amount: '5.000' }), row(2, { account: '301', side: 'CREDIT', amount: '5.000' })])).toBeNull()
  })
})

describe('account groups', () => {
  it('orders the classes the way a chart of accounts reads and sorts codes inside', () => {
    const groups = groupAccounts([account('501', 'Beban A', 'Beban'), account('102', 'Bank', 'Aset'), account('101', 'Kas', 'Aset'), account('201', 'Utang', 'Kewajiban'), account('401', 'Jasa', 'Pendapatan')])
    expect(groups.map((group) => group.label)).toEqual(['Aset', 'Kewajiban', 'Pendapatan', 'Beban'])
    expect(groups[0]!.accounts.map((item) => item.code)).toEqual(['101', '102'])
  })
})

describe('feedback copy', () => {
  it('words the score in steps and never says correct below full marks', () => {
    expect(scoreText(1)).toBe('Jurnalmu tepat')
    expect(scoreText(0.85)).toBe('Hampir tepat (85%)')
    expect(scoreText(0.5)).toBe('Sebagian sudah benar (50%)')
    expect(scoreText(0.1)).toBe('Belum tepat (10%)')
  })

  it('shows the global problems first', () => {
    const findings: CheckFinding[] = [
      { code: 'WRONG_AMOUNT', severity: 'POLISH', message: 'c', lineIndexes: [] },
      { code: 'UNBALANCED', severity: 'GLOBAL', message: 'a', lineIndexes: [] },
      { code: 'REVERSED_SIDE', severity: 'FOCUS', message: 'b', lineIndexes: [] },
    ]
    expect(sortFindings(findings).map((item) => item.message)).toEqual(['a', 'b', 'c'])
  })

  it('explains the scaffold from the learner numbers', () => {
    expect(scaffoldNote('HIGH', 0.5, 0)).toContain('Belum ada bukti belajar')
    expect(scaffoldNote('MEDIUM', 0.52, 4)).toContain('52% dari 4 bukti')
    expect(scaffoldNote('MINIMAL', 0.9, 8)).toContain('mandiri')
  })

  it('labels the hint button by how many hints are open', () => {
    expect(nextHintLabel(0, true)).toBe('Buka petunjuk pertama')
    expect(nextHintLabel(1, true)).toBe('Buka petunjuk 2 dari 3')
    expect(nextHintLabel(3, false)).toBe('Semua petunjuk sudah dibuka')
  })

  it('asks the learner to read the hint first while the cooldown runs', () => {
    expect(nextHintLabel(1, true, 3)).toBe('Baca dulu, petunjuk berikutnya dalam 3 detik')
    expect(nextHintLabel(3, false, 3)).toBe('Semua petunjuk sudah dibuka')
    expect(nextHintLabel(1, true, 0)).toBe('Buka petunjuk 2 dari 3')
  })

  it('computes progress without dividing by zero', () => {
    expect(progressPercent(3, 40)).toBe(8)
    expect(progressPercent(0, 0)).toBe(0)
  })
})

describe('variant seeds', () => {
  it('reads a seed from the address and refuses anything else', () => {
    expect(parseSeed('7')).toBe(7)
    expect(parseSeed(['12', '3'])).toBe(12)
    expect(parseSeed('999999')).toBe(999999)
    for (const value of [undefined, '', '0', '-1', '1.5', 'abc', '1000000', '0007x']) expect(parseSeed(value)).toBeNull()
  })

  it('walks through the variants in order and starts over after the last one', () => {
    expect(nextSeed(null, 8)).toBe(1)
    expect(nextSeed(1, 8)).toBe(2)
    expect(nextSeed(8, 8)).toBe(1)
    expect(nextSeed(5, 4)).toBe(2)
    expect(nextSeed(3, 0)).toBe(1)
  })

  it('says which variation the learner is on', () => {
    expect(variantProgressText(3, 8)).toBe('Variasi 3 dari 8')
    expect(variantProgressText(11, 8)).toBe('Variasi 3 dari 8')
    expect(variantProgressText(1, 0)).toBe('Variasi 1 dari 1')
  })
})
