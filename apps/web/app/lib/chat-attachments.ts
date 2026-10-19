import type { AttachmentIssue, ChatAttachment, PendingImage } from '~/interfaces/chats/chatAttachment'

export const ATTACHMENT_MAX_BYTES = 4 * 1024 * 1024
export const ATTACHMENTS_PER_MESSAGE = 3
export const ATTACHMENT_MIMES: readonly string[] = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
export const ATTACHMENT_ACCEPT = ATTACHMENT_MIMES.join(',')
export const IMAGE_ONLY_QUERY = 'Tolong lihat gambar yang aku kirim dan bantu aku memahaminya.'

const ISSUE_TEXT: Record<AttachmentIssue, string> = {
  type: 'Hanya gambar PNG, JPEG, WebP, atau GIF yang bisa dikirim.',
  size: 'Gambar terlalu besar. Maksimal 4 MB per gambar.',
  limit: `Satu pesan maksimal ${ATTACHMENTS_PER_MESSAGE} gambar.`,
}

export const issueText = (issue: AttachmentIssue): string => ISSUE_TEXT[issue]

export function checkImage(file: { type: string; size: number }, alreadyAttached: number): AttachmentIssue | null {
  if (!ATTACHMENT_MIMES.includes(file.type)) return 'type'
  if (file.size <= 0 || file.size > ATTACHMENT_MAX_BYTES) return 'size'
  if (alreadyAttached >= ATTACHMENTS_PER_MESSAGE) return 'limit'
  return null
}

export function imageFiles(source: ArrayLike<File> | Iterable<File> | null | undefined): File[] {
  return source ? Array.from(source).filter((file) => file.type.startsWith('image/')) : []
}

export function pastedImages(items: ArrayLike<{ kind: string; type: string; getAsFile: () => File | null }> | null | undefined): File[] {
  return Array.from(items ?? [])
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null)
}

export const readyIds = (pending: readonly PendingImage[]): string[] =>
  pending.flatMap((image) => (image.status === 'ready' && image.id ? [image.id] : []))

export const isUploading = (pending: readonly PendingImage[]): boolean => pending.some((image) => image.status === 'uploading')

export const queryFor = (text: string, imageCount: number): string => {
  const trimmed = text.trim()
  if (trimmed) return trimmed
  return imageCount > 0 ? IMAGE_ONLY_QUERY : ''
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export const attachmentAlt = (attachment: Pick<ChatAttachment, 'name'>): string => `Gambar terlampir: ${attachment.name}`

export const attachmentPath = (id: string): string => `/chat/chat-attachments/${encodeURIComponent(id)}/content`
