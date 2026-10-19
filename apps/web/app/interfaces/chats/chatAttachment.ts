export interface ChatAttachment {
  id: string
  name: string
  mime: string
  size: number
}

export type AttachmentIssue = 'type' | 'size' | 'limit'

export type PendingImageStatus = 'uploading' | 'ready' | 'failed'

export interface PendingImage {
  key: string
  name: string
  previewUrl: string
  status: PendingImageStatus
  id?: string
}
