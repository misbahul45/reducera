export const NOTE_TITLE_MAX = 200
export const NOTE_BODY_MAX = 8000
const DRAFT_TITLE_MAX = 80

export interface NoteView {
  id: string
  title: string
  body: string
  source: 'MANUAL' | 'CHAT'
  userStepId: string | null
  userStepTitle: string | null
  stepTemplateId: string | null
  chatMessageId: string | null
  createdAt: string
  updatedAt: string
}

export function noteProblem(title: string, body: string): string | null {
  if (title.trim().length === 0) return 'Judul catatan wajib diisi.'
  if (title.trim().length > NOTE_TITLE_MAX) return `Judul maksimal ${NOTE_TITLE_MAX} karakter.`
  if (body.trim().length === 0) return 'Isi catatan wajib diisi.'
  if (body.trim().length > NOTE_BODY_MAX) return `Isi maksimal ${NOTE_BODY_MAX} karakter.`
  return null
}

export function stripMarkdown(value: string): string {
  return value
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s?\[\d{1,2}(?:\s*,\s*\d{1,2})*\]/g, '')
    .replace(/^[#>\-*+\d.\s]+/gm, '')
    .replace(/[*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function draftFromReply(reply: string): { title: string; body: string } {
  const plain = stripMarkdown(reply)
  const sentence = plain.split(/(?<=[.!?])\s+/)[0] ?? plain
  const title = (sentence.length > DRAFT_TITLE_MAX ? `${sentence.slice(0, DRAFT_TITLE_MAX - 1).trimEnd()}…` : sentence) || 'Catatan dari CORE'
  return { title, body: reply.replace(/\s?\[\d{1,2}(?:\s*,\s*\d{1,2})*\]/g, '').trim().slice(0, NOTE_BODY_MAX) }
}

export function stepLink(note: Pick<NoteView, 'userStepId' | 'stepTemplateId'>): string | null {
  return note.userStepId ? `/my-learning/steps/${note.stepTemplateId ?? note.userStepId}/${note.userStepId}` : null
}

export function noteDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta' }).format(date)
}
