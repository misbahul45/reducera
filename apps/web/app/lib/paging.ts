export interface PageInfo {
  total: number
  limit: number | null
  nextCursor: number | null
}

export interface PageResponse<T> {
  items: T[]
  page: PageInfo
}

export const DEFAULT_STEP = 12

export function mergePage<T>(current: readonly T[], incoming: readonly T[], keyOf: (item: T) => string): T[] {
  const seen = new Set(current.map(keyOf))
  const fresh = incoming.filter((item) => {
    const key = keyOf(item)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return fresh.length === 0 ? [...current] : [...current, ...fresh]
}

export function visibleSlice<T>(items: readonly T[], count: number): T[] {
  return items.slice(0, Math.max(0, count))
}

export function nextVisibleCount(count: number, total: number, step: number): number {
  return Math.min(total, Math.max(0, count) + Math.max(1, step))
}

export function initialVisibleCount(total: number, step: number): number {
  return Math.min(total, Math.max(1, step))
}

export function hasMoreItems(count: number, total: number): boolean {
  return count < total
}

export function shownText(shown: number, total: number, noun: string): string {
  if (total === 0) return `Tidak ada ${noun} yang cocok.`
  if (shown >= total) return `Menampilkan semua ${total} ${noun}.`
  return `Menampilkan ${shown} dari ${total} ${noun}.`
}

export function feedHasMore(nextCursor: number | null | undefined): boolean {
  return typeof nextCursor === 'number'
}

export function searchMatches(haystack: readonly string[], needle: string): boolean {
  const query = needle.trim().toLowerCase()
  if (query === '') return true
  return haystack.some((text) => text.toLowerCase().includes(query))
}
