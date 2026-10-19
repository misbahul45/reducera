export const MAX_CONCEPT_TAGS = 5

export interface ConceptChoice {
  id: string
  title: string
  description: string | null
  level: number
}

export interface TagLink {
  conceptId: string
  status: 'PROPOSED' | 'APPROVED' | 'REJECTED'
}

export function toggleConcept(selected: readonly string[], id: string, max: number = MAX_CONCEPT_TAGS): string[] {
  if (selected.includes(id)) return selected.filter((item) => item !== id)
  return selected.length >= max ? [...selected] : [...selected, id]
}

export function filterConcepts(options: readonly ConceptChoice[], query: string): ConceptChoice[] {
  const needle = query.trim().toLowerCase()
  if (needle.length === 0) return [...options]
  return options.filter((option) => `${option.title} ${option.description ?? ''}`.toLowerCase().includes(needle))
}

export function pickerStatus(count: number, max: number = MAX_CONCEPT_TAGS): string {
  if (count === 0) return `Belum ada konsep dipilih. Boleh sampai ${max}.`
  return count >= max ? `${count} dari ${max} konsep dipilih. Batas tercapai.` : `${count} dari ${max} konsep dipilih.`
}

export function titleFor(options: readonly ConceptChoice[], id: string): string {
  return options.find((option) => option.id === id)?.title ?? id
}

const STATUS_LABEL: Record<TagLink['status'], string> = {
  PROPOSED: 'Menunggu ditinjau',
  APPROVED: 'Disetujui',
  REJECTED: 'Ditolak',
}

export function statusLabel(links: readonly TagLink[] | undefined, id: string): string {
  const link = links?.find((item) => item.conceptId === id)
  return link ? STATUS_LABEL[link.status] : ''
}

export function sameSet(first: readonly string[], second: readonly string[]): boolean {
  return first.length === second.length && [...first].sort().join('\u0000') === [...second].sort().join('\u0000')
}
