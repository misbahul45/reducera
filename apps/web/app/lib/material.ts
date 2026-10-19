export interface MaterialVersion {
  id: string
  data: string
  createdAt: string
  isLatest: boolean
  number: number
}

export function materialVersions(items: ReadonlyArray<{ id: string; data: string; createdAt: string | Date }>): MaterialVersion[] {
  const ordered = [...items]
    .filter((item) => typeof item.data === 'string' && item.data.trim().length > 0)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  return ordered.map((item, index) => ({
    id: item.id,
    data: item.data,
    createdAt: String(item.createdAt),
    isLatest: index === 0,
    number: ordered.length - index,
  }))
}

export const versionLabel = (version: Pick<MaterialVersion, 'isLatest' | 'number'>): string =>
  version.isLatest ? 'Versi terbaru' : `Versi ${version.number}`
