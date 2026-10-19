import { describe, expect, it } from 'vitest'
import { materialVersions, versionLabel } from '~/lib/material'

describe('materialVersions', () => {
  it('puts the newest first and numbers the versions from the oldest', () => {
    const versions = materialVersions([
      { id: 'a', data: 'lama', createdAt: '2026-10-12T01:00:00Z' },
      { id: 'c', data: 'baru', createdAt: '2026-10-12T03:00:00Z' },
      { id: 'b', data: 'tengah', createdAt: '2026-10-12T02:00:00Z' },
    ])

    expect(versions.map((v) => v.id)).toEqual(['c', 'b', 'a'])
    expect(versions.map((v) => v.number)).toEqual([3, 2, 1])
    expect(versions.map((v) => v.isLatest)).toEqual([true, false, false])
  })

  it('ignores a version without text', () => {
    expect(materialVersions([{ id: 'a', data: '   ', createdAt: '2026-10-12T01:00:00Z' }])).toEqual([])
  })

  it('has nothing when there are no contents yet', () => {
    expect(materialVersions([])).toEqual([])
  })

  it('names the versions in Indonesian', () => {
    expect(versionLabel({ isLatest: true, number: 3 })).toBe('Versi terbaru')
    expect(versionLabel({ isLatest: false, number: 2 })).toBe('Versi 2')
  })
})
