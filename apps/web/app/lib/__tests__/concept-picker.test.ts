import { describe, expect, it } from 'vitest'
import { MAX_CONCEPT_TAGS, filterConcepts, pickerStatus, sameSet, statusLabel, titleFor, toggleConcept, type ConceptChoice } from '~/lib/concept-picker'

const choice = (id: string, title: string, description: string | null = null): ConceptChoice => ({ id, title, description, level: 1 })

const options = [choice('a', 'Persamaan akuntansi', 'Aset sama dengan kewajiban plus modal'), choice('b', 'Jurnal penyesuaian'), choice('c', 'Neraca saldo', 'Daftar saldo akun')]

describe('toggleConcept', () => {
  it('adds a concept and removes it again', () => {
    expect(toggleConcept([], 'a')).toEqual(['a'])
    expect(toggleConcept(['a', 'b'], 'a')).toEqual(['b'])
  })

  it('does not go past the maximum but still lets one be removed', () => {
    const full = ['1', '2', '3', '4', '5']

    expect(toggleConcept(full, '6')).toEqual(full)
    expect(toggleConcept(full, '3')).toEqual(['1', '2', '4', '5'])
    expect(MAX_CONCEPT_TAGS).toBe(5)
  })

  it('never changes the list it was given', () => {
    const selected = ['a']

    toggleConcept(selected, 'b')

    expect(selected).toEqual(['a'])
  })

  it('honours another maximum', () => {
    expect(toggleConcept(['a'], 'b', 1)).toEqual(['a'])
  })
})

describe('filterConcepts', () => {
  it('returns everything for an empty query', () => {
    expect(filterConcepts(options, '')).toHaveLength(3)
    expect(filterConcepts(options, '   ')).toHaveLength(3)
  })

  it('matches the title or the description, ignoring case', () => {
    expect(filterConcepts(options, 'JURNAL').map((item) => item.id)).toEqual(['b'])
    expect(filterConcepts(options, 'saldo').map((item) => item.id)).toEqual(['c'])
    expect(filterConcepts(options, 'kewajiban').map((item) => item.id)).toEqual(['a'])
  })

  it('finds nothing for an unknown word', () => {
    expect(filterConcepts(options, 'astronomi')).toEqual([])
  })
})

describe('copy', () => {
  it('reports how many concepts are chosen', () => {
    expect(pickerStatus(0)).toBe('Belum ada konsep dipilih. Boleh sampai 5.')
    expect(pickerStatus(2)).toBe('2 dari 5 konsep dipilih.')
    expect(pickerStatus(5)).toBe('5 dari 5 konsep dipilih. Batas tercapai.')
  })

  it('names a concept and falls back to its id when it is no longer listed', () => {
    expect(titleFor(options, 'b')).toBe('Jurnal penyesuaian')
    expect(titleFor(options, 'retired')).toBe('retired')
  })

  it('labels the review state of a saved tag', () => {
    const links = [
      { conceptId: 'a', status: 'APPROVED' as const },
      { conceptId: 'b', status: 'PROPOSED' as const },
      { conceptId: 'c', status: 'REJECTED' as const },
    ]

    expect(statusLabel(links, 'a')).toBe('Disetujui')
    expect(statusLabel(links, 'b')).toBe('Menunggu ditinjau')
    expect(statusLabel(links, 'c')).toBe('Ditolak')
    expect(statusLabel(links, 'z')).toBe('')
    expect(statusLabel(undefined, 'a')).toBe('')
  })
})

describe('sameSet', () => {
  it('ignores order', () => {
    expect(sameSet(['a', 'b'], ['b', 'a'])).toBe(true)
  })

  it('tells different sets apart', () => {
    expect(sameSet(['a'], ['a', 'b'])).toBe(false)
    expect(sameSet(['a', 'b'], ['a', 'c'])).toBe(false)
    expect(sameSet([], [])).toBe(true)
  })
})
