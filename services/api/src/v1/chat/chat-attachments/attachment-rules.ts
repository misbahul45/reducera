export const ATTACHMENT_MAX_BYTES = 4 * 1024 * 1024;
export const ATTACHMENTS_PER_MESSAGE = 3;
export const ATTACHMENTS_PER_CHAT = 100;
export const PENDING_ATTACHMENTS_PER_CHAT = 6;
export const PENDING_ATTACHMENT_TTL_MS = 60 * 60 * 1000;
export const ATTACHMENT_NAME_LIMIT = 120;
export const DEFAULT_ATTACHMENT_NAME = 'gambar';

export const ATTACHMENT_MIMES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;
export type AttachmentMime = (typeof ATTACHMENT_MIMES)[number];

const startsWith = (buffer: Buffer, bytes: number[], offset = 0) =>
  buffer.length >= offset + bytes.length && bytes.every((byte, index) => buffer[offset + index] === byte);

export const sniffImage = (buffer: Buffer): AttachmentMime | null => {
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(buffer, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) || startsWith(buffer, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])) return 'image/gif';
  if (startsWith(buffer, [0x52, 0x49, 0x46, 0x46]) && startsWith(buffer, [0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  return null;
};

export const cleanAttachmentName = (raw: string | null | undefined): string => {
  const base = (raw ?? '').split(/[\\/]/).pop() ?? '';
  const printable = base.replace(/[\p{Cc}\p{Cf}"<>|?*:]/gu, '').replace(/\s+/g, ' ').trim();
  const clipped = printable.slice(0, ATTACHMENT_NAME_LIMIT).trim();
  return clipped.length > 0 ? clipped : DEFAULT_ATTACHMENT_NAME;
};

export const ATTACHMENT_VIEW_SELECT = { id: true, name: true, mime: true, size: true } as const;

export interface AttachmentView {
  id: string;
  name: string;
  mime: string;
  size: number;
}
