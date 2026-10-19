import type {
  ChatAction,
  ChatCitation,
  CitationRefType,
  CitationVia,
  ImproveInstruction,
  RunnableAction,
} from '~/interfaces/chats/chatExtras'

export const MESSAGE_MAX = 2000
export const SAVEABLE_MIN = 20

const BUSY = ['PENDING', 'PROCESSING']
const INSTRUCTIONS: readonly ImproveInstruction[] = ['SIMPLIFY', 'EXAMPLE', 'DEEPEN', 'SHORTEN']
const REF_TYPES: readonly CitationRefType[] = ['RESOURCE', 'CONCEPT', 'TOPIC', 'SUBTOPIC']
const VIA: readonly CitationVia[] = ['LEXICAL', 'SEMANTIC', 'WEB', 'SCOPE']

export const isBusy = (status: string | null | undefined): boolean => BUSY.includes(status ?? '')

export const IMPROVE_LABELS: Record<ImproveInstruction, string> = {
  SIMPLIFY: 'Sederhanakan materi',
  EXAMPLE: 'Tambah contoh',
  DEEPEN: 'Perdalam materi',
  SHORTEN: 'Ringkas materi',
}

const IMPROVE_REQUEST: Record<ImproveInstruction, string> = {
  SIMPLIFY: 'Tolong sederhanakan materi ini.',
  EXAMPLE: 'Tolong tambahkan contoh ke materi ini.',
  DEEPEN: 'Tolong perdalam materi ini.',
  SHORTEN: 'Tolong ringkas materi ini.',
}

export const isRunnable = (action: ChatAction): action is RunnableAction =>
  action.type === 'QUIZ' || action.type === 'IMPROVE_MATERIAL'

export function actionLabel(action: ChatAction): string {
  switch (action.type) {
    case 'QUIZ':
      return `Buat ${action.count} soal latihan`
    case 'IMPROVE_MATERIAL':
      return IMPROVE_LABELS[action.instruction]
    case 'NOTE':
      return 'Simpan ke catatan'
    case 'OPEN_QUIZ':
      return 'Kerjakan soal latihan'
    case 'OPEN_MATERIAL':
      return 'Lihat materi terbaru'
  }
}

export function actionRequestText(action: RunnableAction): string {
  return action.type === 'QUIZ'
    ? `Tolong buatkan ${action.count} soal latihan${action.focus ? ` tentang ${action.focus}` : ''}.`
    : IMPROVE_REQUEST[action.instruction]
}

export const QUICK_ACTIONS: readonly RunnableAction[] = [
  { type: 'QUIZ', count: 5 },
  { type: 'IMPROVE_MATERIAL', instruction: 'SIMPLIFY' },
  { type: 'IMPROVE_MATERIAL', instruction: 'EXAMPLE' },
]

export const STARTERS: readonly string[] = [
  'Jelaskan bagian ini dengan bahasa yang lebih mudah',
  'Kasih aku contoh dari dunia kerja',
  'Aku masih bingung, bisa mulai dari dasarnya?',
]

export function greeting(name: string | null | undefined): string {
  const who = (name ?? '').trim()
  return who
    ? `Hai ${who}! Aku CORE, teman belajarmu. Lagi bingung di bagian mana? Tanya apa saja, atau minta aku bikinkan soal latihan.`
    : 'Hai! Aku CORE, teman belajarmu. Lagi bingung di bagian mana? Tanya apa saja, atau minta aku bikinkan soal latihan.'
}

export function safeHref(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null
  } catch {
    return null
  }
}

export function hostOf(url: string | null | undefined): string {
  const href = safeHref(url)
  return href ? new URL(href).host.replace(/^www\./, '') : ''
}

const text = (value: unknown, max: number): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim().slice(0, max) : undefined

export function normalizeCitations(value: unknown): ChatCitation[] {
  if (!Array.isArray(value)) return []
  const found: ChatCitation[] = []
  for (const item of value) {
    if (item === null || typeof item !== 'object') continue
    const raw = item as Record<string, unknown>
    const index = Number(raw.index)
    const title = text(raw.title, 200)
    if (!Number.isInteger(index) || index < 1 || index > 50 || !title) continue
    if (raw.kind !== 'MATERIAL' && raw.kind !== 'WEB' && raw.kind !== 'TOPIC') continue
    if (found.some((citation) => citation.index === index)) continue
    found.push({
      index,
      kind: raw.kind,
      title,
      snippet: text(raw.snippet, 300),
      lessonId: text(raw.lessonId, 64),
      url: raw.kind === 'WEB' ? (safeHref(text(raw.url, 500)) ?? undefined) : undefined,
      refType: REF_TYPES.includes(raw.refType as CitationRefType) ? (raw.refType as CitationRefType) : undefined,
      refId: text(raw.refId, 64),
      via: Array.isArray(raw.via) ? raw.via.filter((item): item is CitationVia => VIA.includes(item as CitationVia)) : undefined,
    })
  }
  return found
}

export function normalizeActions(value: unknown): ChatAction[] {
  if (!Array.isArray(value)) return []
  const found: ChatAction[] = []
  for (const item of value.slice(0, 4)) {
    if (item === null || typeof item !== 'object') continue
    const raw = item as Record<string, unknown>
    if (raw.type === 'QUIZ') {
      const count = Number(raw.count)
      if (Number.isInteger(count) && count >= 3 && count <= 10) found.push({ type: 'QUIZ', count, focus: text(raw.focus, 200) })
    } else if (raw.type === 'IMPROVE_MATERIAL') {
      if (INSTRUCTIONS.includes(raw.instruction as ImproveInstruction)) {
        found.push({ type: 'IMPROVE_MATERIAL', instruction: raw.instruction as ImproveInstruction, focus: text(raw.focus, 200) })
      }
    } else if (raw.type === 'NOTE') {
      const title = text(raw.title, 200)
      const body = text(raw.body, 8000)
      if (title && body) found.push({ type: 'NOTE', title, body })
    } else if (raw.type === 'OPEN_QUIZ') {
      const quizId = text(raw.quizId, 64)
      if (quizId) found.push({ type: 'OPEN_QUIZ', quizId })
    } else if (raw.type === 'OPEN_MATERIAL') {
      found.push({ type: 'OPEN_MATERIAL' })
    }
  }
  return found
}

export function canSave(message: { role: string; status: string; text?: string | null }): boolean {
  return message.role === 'ASSISTANT' && message.status === 'COMPLETED' && (message.text ?? '').trim().length >= SAVEABLE_MIN
}

export const canSend = (draft: string, busy: boolean, imageCount = 0): boolean =>
  !busy && (draft.trim().length > 0 || imageCount > 0) && draft.length <= MESSAGE_MAX

const REF_LABELS: Record<CitationRefType, string> = {
  RESOURCE: 'Sumber course',
  CONCEPT: 'Konsep course',
  SUBTOPIC: 'Bagian course',
  TOPIC: 'Course',
}

export function sourceLabel(citation: Pick<ChatCitation, 'kind' | 'refType' | 'url'>): string {
  if (citation.kind === 'WEB') return `Web · ${hostOf(citation.url)}`
  if (citation.kind === 'TOPIC') return `${citation.refType ? REF_LABELS[citation.refType] : 'Sumber course'} · database`
  return 'Materi ReduCera'
}

const VIA_LABELS: Record<CitationVia, string> = {
  LEXICAL: 'cocok kata kunci',
  SEMANTIC: 'cocok makna',
  WEB: 'hasil web',
  SCOPE: 'konteks pelajaran',
}

export const viaLabels = (citation: Pick<ChatCitation, 'via'>): string[] => (citation.via ?? []).map((item) => VIA_LABELS[item])

export function groundingNote(citations: readonly ChatCitation[]): string {
  const topic = citations.filter((citation) => citation.kind === 'TOPIC').length
  if (citations.length === 0) return 'Tidak ada sumber course yang dikutip untuk teks ini.'
  return topic > 0 ? `${citations.length} sumber dikutip, ${topic} dari database course.` : `${citations.length} sumber dikutip.`
}
