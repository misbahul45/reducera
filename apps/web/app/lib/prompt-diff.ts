export type DiffKind = 'same' | 'added' | 'removed' | 'gap'

export interface DiffLine {
  kind: DiffKind
  text: string
}

export interface DiffSummary {
  added: number
  removed: number
}

const CONTEXT = 2
const MAX_LINES = 1500

const rows = (text: string): string[] => text.replace(/\r\n/g, '\n').split('\n')

export function lineDiff(before: string, after: string): DiffLine[] {
  const a = rows(before)
  const b = rows(after)
  if (a.length > MAX_LINES || b.length > MAX_LINES) {
    return [...a.map((text): DiffLine => ({ kind: 'removed', text })), ...b.map((text): DiffLine => ({ kind: 'added', text }))]
  }

  const table = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!)
    }
  }

  const lines: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      lines.push({ kind: 'same', text: a[i]! })
      i += 1
      j += 1
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      lines.push({ kind: 'removed', text: a[i]! })
      i += 1
    } else {
      lines.push({ kind: 'added', text: b[j]! })
      j += 1
    }
  }
  while (i < a.length) lines.push({ kind: 'removed', text: a[i++]! })
  while (j < b.length) lines.push({ kind: 'added', text: b[j++]! })
  return lines
}

export function summarize(lines: ReadonlyArray<DiffLine>): DiffSummary {
  return {
    added: lines.filter((line) => line.kind === 'added').length,
    removed: lines.filter((line) => line.kind === 'removed').length,
  }
}

export function withContext(lines: ReadonlyArray<DiffLine>, context: number = CONTEXT): DiffLine[] {
  const keep = new Array<boolean>(lines.length).fill(false)
  lines.forEach((line, index) => {
    if (line.kind === 'same') return
    for (let k = Math.max(0, index - context); k <= Math.min(lines.length - 1, index + context); k += 1) keep[k] = true
  })

  const result: DiffLine[] = []
  let skipped = 0
  lines.forEach((line, index) => {
    if (keep[index]) {
      if (skipped > 0) result.push({ kind: 'gap', text: `${skipped} baris tidak berubah` })
      skipped = 0
      result.push(line)
    } else {
      skipped += 1
    }
  })
  if (skipped > 0 && result.length > 0) result.push({ kind: 'gap', text: `${skipped} baris tidak berubah` })
  return result
}

export const diffMarker = (kind: DiffKind): string => (kind === 'added' ? '+' : kind === 'removed' ? '−' : kind === 'gap' ? '…' : ' ')

export const diffLabel = (kind: DiffKind): string =>
  kind === 'added' ? 'Ditambahkan' : kind === 'removed' ? 'Dihapus' : kind === 'gap' ? 'Bagian dilewati' : 'Tetap'
