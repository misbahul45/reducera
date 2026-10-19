import type {
  CheckFinding,
  Difficulty,
  EquationEffect,
  FindingSeverity,
  LineStatus,
  PracticeStatus,
  Recommendation,
  RecommendationReason,
  SandboxAccount,
  SavedLine,
  Scaffold,
  Side,
} from '~/interfaces/sandbox/practice'

export const MAX_ROWS = 12
export const MAX_RUPIAH = 999_999_999_999
export const HINT_STEPS = 3
export const HINT_COOLDOWN_SECONDS = 4

export interface JournalRow {
  id: number
  account: string
  side: Side
  amount: string
}

export const formatRupiah = (value: number): string => `Rp${Math.abs(Math.round(value)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`

export function parseRupiah(text: string): number | null {
  const cleaned = text.replace(/^\s*rp\.?\s*/i, '').replace(/\s+/g, '')
  if (!/^\d{1,3}(\.\d{3})*$|^\d+$/.test(cleaned)) return null
  const value = Number(cleaned.replace(/\./g, ''))
  return Number.isSafeInteger(value) && value >= 1 && value <= MAX_RUPIAH ? value : null
}

export function groupDigits(text: string): string {
  const digits = text.replace(/\D/g, '').replace(/^0+(?=\d)/, '')
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

export const newRow = (id: number, side: Side = 'DEBIT'): JournalRow => ({ id, account: '', side, amount: '' })

export const initialRows = (): JournalRow[] => [newRow(1, 'DEBIT'), newRow(2, 'CREDIT')]

export function rowsFromLines(lines: readonly SavedLine[]): JournalRow[] {
  if (lines.length === 0) return initialRows()
  return lines.slice(0, MAX_ROWS).map((line, index) => ({ id: index + 1, account: line.account, side: line.side, amount: groupDigits(String(line.amount)) }))
}

export const isFilled = (row: JournalRow): boolean => row.account !== '' && parseRupiah(row.amount) !== null

export const isBlank = (row: JournalRow): boolean => row.account === '' && row.amount.trim() === ''

export function toLines(rows: readonly JournalRow[]): SavedLine[] {
  return rows.filter(isFilled).map((row) => ({ account: row.account, side: row.side, amount: parseRupiah(row.amount) as number }))
}

export interface Totals {
  debit: number
  credit: number
  difference: number
  balanced: boolean
}

export function journalTotals(rows: readonly JournalRow[]): Totals {
  const lines = toLines(rows)
  const debit = lines.filter((line) => line.side === 'DEBIT').reduce((sum, line) => sum + line.amount, 0)
  const credit = lines.filter((line) => line.side === 'CREDIT').reduce((sum, line) => sum + line.amount, 0)
  return { debit, credit, difference: Math.abs(debit - credit), balanced: debit > 0 && debit === credit }
}

export function rowProblem(row: JournalRow, index: number): string | null {
  if (isBlank(row)) return null
  const label = `Baris ${index + 1}`
  if (row.account === '') return `${label}: pilih akunnya.`
  if (row.amount.trim() === '') return `${label}: isi jumlahnya.`
  if (parseRupiah(row.amount) === null) return `${label}: jumlah harus bilangan bulat rupiah antara Rp1 dan ${formatRupiah(MAX_RUPIAH)}.`
  return null
}

export function journalProblem(rows: readonly JournalRow[]): string | null {
  for (const [index, row] of rows.entries()) {
    const problem = rowProblem(row, index)
    if (problem) return problem
  }
  if (toLines(rows).length === 0) return 'Isi minimal satu baris jurnal dengan akun dan jumlah.'
  return null
}

export interface AccountGroup {
  label: string
  accounts: SandboxAccount[]
}

const CLASS_ORDER = ['Aset', 'Kewajiban', 'Ekuitas', 'Pendapatan', 'Beban']

export function groupAccounts(accounts: readonly SandboxAccount[]): AccountGroup[] {
  const byClass = new Map<string, SandboxAccount[]>()
  for (const account of accounts) {
    const list = byClass.get(account.class) ?? []
    list.push(account)
    byClass.set(account.class, list)
  }
  const rank = (label: string) => {
    const index = CLASS_ORDER.indexOf(label)
    return index === -1 ? CLASS_ORDER.length : index
  }
  return [...byClass.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
    .map(([label, list]) => ({ label, accounts: [...list].sort((a, b) => a.code.localeCompare(b.code)) }))
}

export const accountLabel = (accounts: readonly SandboxAccount[], code: string): string => {
  const found = accounts.find((account) => account.code === code)
  return found ? `${found.code} ${found.name}` : code
}

export const DIFFICULTY_LABEL: Record<Difficulty, string> = { BEGINNER: 'Pemula', INTERMEDIATE: 'Menengah', ADVANCED: 'Mahir' }

export const LEVEL_LABEL: Record<number, string> = {
  1: 'Level 1 · Dasar',
  2: 'Level 2 · Usaha jasa dan dagang',
  3: 'Level 3 · Penyesuaian dan penutup',
  4: 'Level 4 · Lanjutan',
}

export const levelLabel = (level: number): string => LEVEL_LABEL[level] ?? `Level ${level}`

export const STATUS_LABEL: Record<PracticeStatus, string> = { NEW: 'Baru', IN_PROGRESS: 'Dikerjakan', SOLVED: 'Selesai' }

export type Tone = 'neutral' | 'success' | 'warning' | 'error' | 'info'

export const STATUS_TONE: Record<PracticeStatus, Tone> = { NEW: 'neutral', IN_PROGRESS: 'info', SOLVED: 'success' }

export const SCAFFOLD_LABEL: Record<Scaffold, string> = { HIGH: 'Dipandu penuh', MEDIUM: 'Dipandu sebagian', MINIMAL: 'Mandiri' }

export function scaffoldNote(scaffold: Scaffold, mastery: number, evidenceCount: number): string {
  const percent = Math.round(mastery * 100)
  if (evidenceCount === 0) return 'Belum ada bukti belajar untuk konsep ini, jadi kamu diberi contoh dan panduan lengkap.'
  const basis = `Penguasaanmu atas konsep ini ${percent}% dari ${evidenceCount} bukti.`
  if (scaffold === 'HIGH') return `${basis} Kamu diberi contoh dan panduan lengkap.`
  if (scaffold === 'MEDIUM') return `${basis} Panduan dikurangi, persamaan akuntansi tetap ditampilkan.`
  return `${basis} Kamu berlatih mandiri, petunjuk tetap bisa dibuka.`
}

export const REASON_LABEL: Record<RecommendationReason, string> = {
  START: 'Mulai di sini',
  REMEDIATION: 'Memperbaiki kebiasaan',
  PROGRESSION: 'Langkah berikutnya',
  REVIEW: 'Waktunya mengulang',
}

export const VERDICT_LABEL: Record<LineStatus, string> = {
  CORRECT: 'Tepat',
  REVERSED_SIDE: 'Sisi tertukar',
  WRONG_AMOUNT: 'Jumlah belum tepat',
  WRONG_ACCOUNT: 'Akun belum tepat',
  EXTRA: 'Baris berlebih',
}

export const VERDICT_TONE: Record<LineStatus, Tone> = {
  CORRECT: 'success',
  REVERSED_SIDE: 'warning',
  WRONG_AMOUNT: 'warning',
  WRONG_ACCOUNT: 'error',
  EXTRA: 'error',
}

const SEVERITY_RANK: Record<FindingSeverity, number> = { GLOBAL: 0, FOCUS: 1, POLISH: 2 }

export const sortFindings = (findings: readonly CheckFinding[]): CheckFinding[] =>
  [...findings].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])

export function scoreText(score: number): string {
  const percent = Math.round(score * 100)
  if (percent >= 100) return 'Jurnalmu tepat'
  if (percent >= 70) return `Hampir tepat (${percent}%)`
  if (percent >= 40) return `Sebagian sudah benar (${percent}%)`
  return `Belum tepat (${percent}%)`
}

export function equationText(effect: EquationEffect): string {
  const sign = (value: number) => (value === 0 ? 'tetap' : `${value > 0 ? 'naik' : 'turun'} ${formatRupiah(value)}`)
  return `Aset ${sign(effect.asset)} · Kewajiban ${sign(effect.liability)} · Ekuitas ${sign(effect.equity)}`
}

export function progressPercent(solved: number, total: number): number {
  return total <= 0 ? 0 : Math.round((solved / total) * 100)
}

export function recommendationLink(recommendation: Pick<Recommendation, 'scenarioId'>): string {
  return `/sandbox/${encodeURIComponent(recommendation.scenarioId)}`
}

export function nextHintLabel(level: number, canOpenMore: boolean, cooldown = 0): string {
  if (!canOpenMore) return 'Semua petunjuk sudah dibuka'
  if (cooldown > 0) return `Baca dulu, petunjuk berikutnya dalam ${cooldown} detik`
  return level === 0 ? 'Buka petunjuk pertama' : `Buka petunjuk ${level + 1} dari ${HINT_STEPS}`
}

export const MAX_SEED = 999_999

export function parseSeed(value: unknown): number | null {
  const text = Array.isArray(value) ? value[0] : value
  if (typeof text !== 'string' || !/^\d{1,6}$/.test(text)) return null
  const seed = Number(text)
  return seed >= 1 && seed <= MAX_SEED ? seed : null
}

export function nextSeed(current: number | null, count: number): number {
  const total = Math.max(1, count)
  return current === null ? 1 : (current % total) + 1
}

export function variantProgressText(seed: number, count: number): string {
  const position = ((seed - 1) % Math.max(1, count)) + 1
  return `Variasi ${position} dari ${Math.max(1, count)}`
}
