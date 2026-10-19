import { describe, expect, it } from 'vitest'
import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENTS_PER_MESSAGE,
  IMAGE_ONLY_QUERY,
  attachmentAlt,
  attachmentPath,
  checkImage,
  formatSize,
  imageFiles,
  isUploading,
  issueText,
  pastedImages,
  queryFor,
  readyIds,
} from '~/lib/chat-attachments'
import { canSend } from '~/lib/chat'
import type { PendingImage } from '~/interfaces/chats/chatAttachment'

const file = (name: string, type: string, size = 10) => ({ name, type, size }) as File
const pending = (status: PendingImage['status'], id?: string): PendingImage => ({ key: `${status}-${id ?? 'x'}`, name: 'a.png', previewUrl: 'blob:x', status, id })

describe('checkImage', () => {
  it('accepts the four image types up to the size limit', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/webp', 'image/gif']) {
      expect(checkImage({ type, size: ATTACHMENT_MAX_BYTES }, 0)).toBeNull()
    }
  })

  it.each([['image/svg+xml'], ['application/pdf'], ['text/html'], ['']])('refuses %j by type', (type) => {
    expect(checkImage({ type, size: 10 }, 0)).toBe('type')
  })

  it('refuses an empty image and one above 4 MB', () => {
    expect(checkImage({ type: 'image/png', size: 0 }, 0)).toBe('size')
    expect(checkImage({ type: 'image/png', size: ATTACHMENT_MAX_BYTES + 1 }, 0)).toBe('size')
  })

  it('refuses the image after the third', () => {
    expect(checkImage({ type: 'image/png', size: 10 }, ATTACHMENTS_PER_MESSAGE - 1)).toBeNull()
    expect(checkImage({ type: 'image/png', size: 10 }, ATTACHMENTS_PER_MESSAGE)).toBe('limit')
  })

  it('has a plain sentence for every issue', () => {
    expect(issueText('type')).toMatch(/PNG, JPEG, WebP/)
    expect(issueText('size')).toMatch(/4 MB/)
    expect(issueText('limit')).toMatch(/3 gambar/)
  })
})

describe('imageFiles and pastedImages', () => {
  it('keeps only images from a drop or a picker', () => {
    const kept = imageFiles([file('a.png', 'image/png'), file('b.pdf', 'application/pdf'), file('c.jpg', 'image/jpeg')])

    expect(kept.map((item) => item.name)).toEqual(['a.png', 'c.jpg'])
    expect(imageFiles(null)).toEqual([])
    expect(imageFiles(undefined)).toEqual([])
  })

  it('takes images from the clipboard and leaves pasted text alone', () => {
    const png = file('image.png', 'image/png')
    const items = [
      { kind: 'string', type: 'text/plain', getAsFile: () => null },
      { kind: 'file', type: 'image/png', getAsFile: () => png },
      { kind: 'file', type: 'application/pdf', getAsFile: () => file('x.pdf', 'application/pdf') },
      { kind: 'file', type: 'image/png', getAsFile: () => null },
    ]

    expect(pastedImages(items)).toEqual([png])
    expect(pastedImages(null)).toEqual([])
  })
})

describe('pending images', () => {
  it('sends only the images that finished uploading', () => {
    const list = [pending('ready', 'a'), pending('uploading'), pending('failed'), pending('ready', 'b')]

    expect(readyIds(list)).toEqual(['a', 'b'])
    expect(isUploading(list)).toBe(true)
    expect(isUploading([pending('ready', 'a'), pending('failed')])).toBe(false)
    expect(isUploading([])).toBe(false)
  })
})

describe('queryFor', () => {
  it('keeps what the learner wrote', () => {
    expect(queryFor('  apa ini?  ', 2)).toBe('apa ini?')
    expect(queryFor('apa ini?', 0)).toBe('apa ini?')
  })

  it('uses the fixed sentence that the ai service recognises when only images are sent', () => {
    expect(queryFor('   ', 1)).toBe(IMAGE_ONLY_QUERY)
    expect(queryFor('', 0)).toBe('')
  })
})

describe('canSend with images', () => {
  it('lets an image go alone, and still blocks an empty message or a busy chat', () => {
    expect(canSend('', false, 1)).toBe(true)
    expect(canSend('   ', false, 0)).toBe(false)
    expect(canSend('', true, 1)).toBe(false)
    expect(canSend('halo', false)).toBe(true)
  })
})

describe('labels and paths', () => {
  it('describes a size in plain units', () => {
    expect(formatSize(512)).toBe('512 B')
    expect(formatSize(2048)).toBe('2 KB')
    expect(formatSize(3 * 1024 * 1024)).toBe('3.0 MB')
  })

  it('gives each image an alt text with its name and a safe content path', () => {
    expect(attachmentAlt({ name: 'neraca.png' })).toBe('Gambar terlampir: neraca.png')
    expect(attachmentPath('a/b c')).toBe('/chat/chat-attachments/a%2Fb%20c/content')
  })
})
