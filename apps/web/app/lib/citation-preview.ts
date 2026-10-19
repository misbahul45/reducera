import type { ChatCitation } from '~/interfaces/chats/chatExtras'
import { sourceLabel, viaLabels } from '~/lib/chat'
import { citationAnchor } from '~/lib/chat-markdown'

export const PREVIEW_SNIPPET_LIMIT = 360
export const PREVIEW_GAP = 8

export interface PreviewContent {
  index: number
  title: string
  meta: string
  snippet: string | null
}

interface AnchorBox {
  left: number
  top: number
  bottom: number
}

interface PreviewPlacementInput {
  anchor: AnchorBox
  box: { width: number; height: number }
  bounds: { left: number; top: number; width: number }
  viewportHeight: number
}

export interface PreviewPlacement {
  left: number
  top: number
  side: 'below' | 'above'
}

export function citationIndexFromHref(href: string | null | undefined, prefix: string): number | null {
  if (!href || !href.startsWith('#')) return null
  const stem = citationAnchor(prefix, 0).slice(0, -1)
  const rest = href.slice(1)
  if (!rest.startsWith(stem)) return null
  const digits = rest.slice(stem.length)
  return /^\d{1,2}$/.test(digits) ? Number(digits) : null
}

const tidy = (text: string | undefined): string | null => {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim()
  return flat.length > 0 ? flat : null
}

const shorten = (text: string): string => {
  if (text.length <= PREVIEW_SNIPPET_LIMIT) return text
  const cut = text.slice(0, PREVIEW_SNIPPET_LIMIT)
  const insideWord = !/\s/.test(text[PREVIEW_SNIPPET_LIMIT] ?? ' ')
  const whole = insideWord && cut.includes(' ') ? cut.slice(0, cut.lastIndexOf(' ')) : cut
  return `${whole.trimEnd()}…`
}

export function previewContent(citation: ChatCitation): PreviewContent {
  const snippet = tidy(citation.snippet)
  return {
    index: citation.index,
    title: citation.title,
    meta: [sourceLabel(citation), ...viaLabels(citation)].join(' · '),
    snippet: snippet ? shorten(snippet) : null,
  }
}

export function previewPosition({ anchor, box, bounds, viewportHeight }: PreviewPlacementInput): PreviewPlacement {
  const maxLeft = Math.max(0, bounds.width - box.width)
  const left = Math.min(Math.max(anchor.left - bounds.left, 0), maxLeft)
  const fitsBelow = anchor.bottom + PREVIEW_GAP + box.height <= viewportHeight
  const fitsAbove = anchor.top - PREVIEW_GAP - box.height >= 0
  if (!fitsBelow && fitsAbove) return { left, top: anchor.top - bounds.top - PREVIEW_GAP - box.height, side: 'above' }
  return { left, top: anchor.bottom - bounds.top + PREVIEW_GAP, side: 'below' }
}
