import { describe, expect, it } from 'vitest'
import {
  feedHasMore,
  hasMoreItems,
  initialVisibleCount,
  mergePage,
  nextVisibleCount,
  searchMatches,
  shownText,
  visibleSlice,
} from '~/lib/paging'

const byId = (item: { id: string }) => item.id
const make = (...ids: string[]) => ids.map((id) => ({ id }))

describe('mergePage', () => {
  it('appends new items in order', () => {
    expect(mergePage(make('a', 'b'), make('c', 'd'), byId).map(byId)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('drops an item that already arrived, so a shifted page cannot repeat a row', () => {
    expect(mergePage(make('a', 'b'), make('b', 'c'), byId).map(byId)).toEqual(['a', 'b', 'c'])
  })

  it('drops a repeat inside the incoming page itself', () => {
    expect(mergePage([], make('a', 'a', 'b'), byId).map(byId)).toEqual(['a', 'b'])
  })

  it('keeps the current list when nothing is new and never mutates its input', () => {
    const current = make('a')
    const merged = mergePage(current, make('a'), byId)
    expect(merged).toEqual(current)
    expect(merged).not.toBe(current)
    mergePage(current, make('z'), byId)
    expect(current).toEqual(make('a'))
  })
})

describe('incremental windows', () => {
  it('starts with at most one step and never more than the total', () => {
    expect(initialVisibleCount(40, 12)).toBe(12)
    expect(initialVisibleCount(5, 12)).toBe(5)
    expect(initialVisibleCount(0, 12)).toBe(0)
    expect(initialVisibleCount(10, 0)).toBe(1)
  })

  it('grows by a step up to the total', () => {
    expect(nextVisibleCount(12, 40, 12)).toBe(24)
    expect(nextVisibleCount(36, 40, 12)).toBe(40)
    expect(nextVisibleCount(40, 40, 12)).toBe(40)
    expect(nextVisibleCount(0, 3, 0)).toBe(1)
  })

  it('slices without going negative and says whether more remain', () => {
    expect(visibleSlice([1, 2, 3, 4], 2)).toEqual([1, 2])
    expect(visibleSlice([1, 2, 3, 4], -1)).toEqual([])
    expect(visibleSlice([1, 2], 9)).toEqual([1, 2])
    expect(hasMoreItems(2, 4)).toBe(true)
    expect(hasMoreItems(4, 4)).toBe(false)
  })
})

describe('feeds and texts', () => {
  it('has more only while the server hands out a cursor, and zero is a valid cursor', () => {
    expect(feedHasMore(12)).toBe(true)
    expect(feedHasMore(0)).toBe(true)
    expect(feedHasMore(null)).toBe(false)
    expect(feedHasMore(undefined)).toBe(false)
  })

  it('describes how much is shown', () => {
    expect(shownText(0, 0, 'skenario')).toBe('Tidak ada skenario yang cocok.')
    expect(shownText(12, 40, 'skenario')).toBe('Menampilkan 12 dari 40 skenario.')
    expect(shownText(40, 40, 'skenario')).toBe('Menampilkan semua 40 skenario.')
  })

  it('matches a search text in any field, ignoring case and spaces around it', () => {
    expect(searchMatches(['Pelanggan dari Bandung', 'x'], '  bandung ')).toBe(true)
    expect(searchMatches(['Pelanggan'], 'produk')).toBe(false)
    expect(searchMatches([], '')).toBe(true)
    expect(searchMatches(['a'], '   ')).toBe(true)
  })
})
