import { describe, expect, it } from 'vitest'
import { diffLabel, diffMarker, lineDiff, summarize, withContext } from '~/lib/prompt-diff'

const kinds = (before: string, after: string) => lineDiff(before, after).map((line) => `${diffMarker(line.kind)}${line.text}`)

describe('lineDiff', () => {
  it('marks identical text as unchanged', () => {
    expect(kinds('a\nb', 'a\nb')).toEqual([' a', ' b'])
  })

  it('finds an added line in the middle', () => {
    expect(kinds('a\nc', 'a\nb\nc')).toEqual([' a', '+b', ' c'])
  })

  it('finds a removed line', () => {
    expect(kinds('a\nb\nc', 'a\nc')).toEqual([' a', '−b', ' c'])
  })

  it('shows a changed line as a removal followed by an addition', () => {
    expect(kinds('a\nold\nc', 'a\nnew\nc')).toEqual([' a', '−old', '+new', ' c'])
  })

  it('handles an empty side', () => {
    expect(kinds('', 'a')).toEqual(['−', '+a'])
    expect(kinds('a', '')).toEqual(['−a', '+'])
  })

  it('treats Windows line endings like Unix ones', () => {
    expect(kinds('a\r\nb', 'a\nb')).toEqual([' a', ' b'])
  })

  it('does not hang on a very large input and falls back to a full replacement', () => {
    const big = Array.from({ length: 2000 }, (_, index) => `line ${index}`).join('\n')
    const lines = lineDiff(big, `${big}\nextra`)

    expect(lines.filter((line) => line.kind === 'removed')).toHaveLength(2000)
    expect(lines.filter((line) => line.kind === 'added')).toHaveLength(2001)
  })

  it('keeps the lines that the two texts share in order', () => {
    const lines = lineDiff('one\ntwo\nthree\nfour', 'one\nthree\nfive\nfour')

    expect(lines.filter((line) => line.kind === 'same').map((line) => line.text)).toEqual(['one', 'three', 'four'])
  })
})

describe('summarize', () => {
  it('counts added and removed lines', () => {
    expect(summarize(lineDiff('a\nb\nc', 'a\nx\ny\nc'))).toEqual({ added: 2, removed: 1 })
    expect(summarize(lineDiff('a', 'a'))).toEqual({ added: 0, removed: 0 })
  })
})

describe('withContext', () => {
  const many = Array.from({ length: 20 }, (_, index) => `l${index}`)

  it('keeps two lines around a change and folds the rest into gaps', () => {
    const after = many.map((line, index) => (index === 10 ? 'changed' : line)).join('\n')
    const folded = withContext(lineDiff(many.join('\n'), after))

    expect(folded.map((line) => `${diffMarker(line.kind)}${line.text}`)).toEqual([
      '…8 baris tidak berubah',
      ' l8',
      ' l9',
      '−l10',
      '+changed',
      ' l11',
      ' l12',
      '…7 baris tidak berubah',
    ])
  })

  it('has no gap when everything is close to a change', () => {
    const folded = withContext(lineDiff('a\nb\nc', 'a\nx\nc'))

    expect(folded.some((line) => line.kind === 'gap')).toBe(false)
  })

  it('is empty when nothing changed', () => {
    expect(withContext(lineDiff('a\nb', 'a\nb'))).toEqual([])
  })
})

describe('labels', () => {
  it('names every kind for a screen reader', () => {
    expect(['added', 'removed', 'same', 'gap'].map((kind) => diffLabel(kind as never))).toEqual(['Ditambahkan', 'Dihapus', 'Tetap', 'Bagian dilewati'])
  })
})
