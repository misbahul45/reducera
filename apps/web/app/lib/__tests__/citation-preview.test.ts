import { describe, expect, it } from 'vitest'
import type { ChatCitation } from '~/interfaces/chats/chatExtras'
import { citationAnchor } from '~/lib/chat-markdown'
import { PREVIEW_GAP, PREVIEW_SNIPPET_LIMIT, citationIndexFromHref, previewContent, previewPosition } from '~/lib/citation-preview'

const topic = (overrides: Partial<ChatCitation> = {}): ChatCitation => ({
  index: 3,
  kind: 'TOPIC',
  title: 'Topik: Persiapan UTBK-SNBT',
  refType: 'TOPIC',
  via: ['LEXICAL'],
  snippet: 'Persiapan Ujian Tulis Berbasis Komputer (UTBK) untuk Seleksi Nasional Berbasis Tes (SNBT).',
  ...overrides,
})

describe('citationIndexFromHref', () => {
  it('reads the number out of the anchor a marker links to', () => {
    expect(citationIndexFromHref('#src-intro-3', 'intro')).toBe(3)
    expect(citationIndexFromHref(`#${citationAnchor('0b9d-4c2e', 12)}`, '0b9d-4c2e')).toBe(12)
  })

  it('follows the same cleaning of the prefix as the anchor itself', () => {
    expect(citationIndexFromHref(`#${citationAnchor('a b/c', 2)}`, 'a b/c')).toBe(2)
  })

  it('refuses a link that is not a marker of this text', () => {
    expect(citationIndexFromHref('#src-other-3', 'intro')).toBeNull()
    expect(citationIndexFromHref('#src-intro-x', 'intro')).toBeNull()
    expect(citationIndexFromHref('#src-intro-3-1', 'intro')).toBeNull()
    expect(citationIndexFromHref('https://example.com/#src-intro-3', 'intro')).toBeNull()
    expect(citationIndexFromHref(null, 'intro')).toBeNull()
    expect(citationIndexFromHref('', 'intro')).toBeNull()
  })
})

describe('previewContent', () => {
  it('shows the title, where it came from and the text taken from the source', () => {
    const content = previewContent(topic())

    expect(content).toMatchObject({
      index: 3,
      title: 'Topik: Persiapan UTBK-SNBT',
      meta: 'Course · database · cocok kata kunci',
      snippet: 'Persiapan Ujian Tulis Berbasis Komputer (UTBK) untuk Seleksi Nasional Berbasis Tes (SNBT).',
    })
  })

  it('names a web source by its address', () => {
    const content = previewContent(topic({ kind: 'WEB', refType: undefined, url: 'https://www.snpmb.id/utbk', via: ['WEB'] }))

    expect(content.meta).toBe('Web · snpmb.id · hasil web')
  })

  it('cuts a long snippet at a word and says so', () => {
    const long = Array.from({ length: 200 }, (_, i) => `kata${i}`).join(' ')

    const { snippet } = previewContent(topic({ snippet: long }))

    expect(snippet!.endsWith('…')).toBe(true)
    expect(snippet!.length).toBeLessThanOrEqual(PREVIEW_SNIPPET_LIMIT + 1)
    expect(snippet!.slice(0, -1)).toBe(long.slice(0, snippet!.length - 1).trimEnd())
    expect(long.startsWith(snippet!.slice(0, -1))).toBe(true)
    expect(snippet!.slice(0, -1).endsWith(' ')).toBe(false)
  })

  it('collapses whitespace and answers null when there is no text', () => {
    expect(previewContent(topic({ snippet: '  satu \n\n dua  ' })).snippet).toBe('satu dua')
    expect(previewContent(topic({ snippet: undefined })).snippet).toBeNull()
    expect(previewContent(topic({ snippet: '   ' })).snippet).toBeNull()
  })
})

describe('previewPosition', () => {
  const bounds = { left: 100, top: 50, width: 600 }
  const box = { width: 320, height: 120 }

  it('opens below the marker, left aligned with it', () => {
    const place = previewPosition({ anchor: { left: 200, top: 300, bottom: 316 }, box, bounds, viewportHeight: 900 })

    expect(place).toEqual({ left: 100, top: 316 - 50 + PREVIEW_GAP, side: 'below' })
  })

  it('keeps the box inside the text column on the right edge', () => {
    const place = previewPosition({ anchor: { left: 690, top: 300, bottom: 316 }, box, bounds, viewportHeight: 900 })

    expect(place.left).toBe(600 - 320)
  })

  it('keeps the box inside the text column on the left edge', () => {
    const place = previewPosition({ anchor: { left: 90, top: 300, bottom: 316 }, box, bounds, viewportHeight: 900 })

    expect(place.left).toBe(0)
  })

  it('opens above when there is no room below and room above', () => {
    const place = previewPosition({ anchor: { left: 200, top: 800, bottom: 816 }, box, bounds, viewportHeight: 900 })

    expect(place.side).toBe('above')
    expect(place.top).toBe(800 - 50 - PREVIEW_GAP - 120)
  })

  it('stays below when neither side has room', () => {
    const place = previewPosition({ anchor: { left: 200, top: 60, bottom: 76 }, box: { width: 320, height: 800 }, bounds, viewportHeight: 300 })

    expect(place.side).toBe('below')
  })

  it('fills a narrow column instead of running out of it', () => {
    const place = previewPosition({ anchor: { left: 120, top: 300, bottom: 316 }, box: { width: 320, height: 120 }, bounds: { left: 100, top: 50, width: 260 }, viewportHeight: 900 })

    expect(place.left).toBe(0)
  })
})
