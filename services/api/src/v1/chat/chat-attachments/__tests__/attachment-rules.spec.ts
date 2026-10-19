import { ATTACHMENT_NAME_LIMIT, DEFAULT_ATTACHMENT_NAME, cleanAttachmentName, sniffImage } from '../attachment-rules';

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const gif89 = Buffer.from('GIF89a....', 'latin1');
const gif87 = Buffer.from('GIF87a....', 'latin1');
const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 2, 3, 4]), Buffer.from('WEBPVP8 ')]);

describe('sniffImage', () => {
  it.each([
    ['png', png, 'image/png'],
    ['jpeg', jpeg, 'image/jpeg'],
    ['gif89a', gif89, 'image/gif'],
    ['gif87a', gif87, 'image/gif'],
    ['webp', webp, 'image/webp'],
  ])('recognizes %s by its first bytes', (_name, bytes, mime) => {
    expect(sniffImage(bytes)).toBe(mime);
  });

  it.each([
    ['svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')],
    ['html', Buffer.from('<!doctype html><script>alert(1)</script>')],
    ['pdf', Buffer.from('%PDF-1.7 ....')],
    ['a riff file that is not webp', Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 2, 3, 4]), Buffer.from('WAVEfmt ')])],
    ['an empty file', Buffer.alloc(0)],
    ['a file shorter than any signature', Buffer.from([0x89, 0x50])],
  ])('refuses %s', (_name, bytes) => {
    expect(sniffImage(bytes)).toBeNull();
  });

  it('trusts the bytes and not a claimed type', () => {
    expect(sniffImage(Buffer.from('<svg></svg>'))).toBeNull();
  });
});

describe('cleanAttachmentName', () => {
  it.each([
    ['catatan jurnal.png', 'catatan jurnal.png'],
    ['C:\\Users\\sari\\foto.jpg', 'foto.jpg'],
    ['../../etc/passwd', 'passwd'],
    ['a"b<c>d|e?f*g:h.png', 'abcdefgh.png'],
    ['baris\nbaru\u0000.png', 'barisbaru.png'],
    ['  spasi   banyak.png ', 'spasi banyak.png'],
  ])('turns %j into %j', (input, expected) => {
    expect(cleanAttachmentName(input)).toBe(expected);
  });

  it.each([[''], ['   '], [null], [undefined], ['/'], ['\u0000\u0001']])('falls back to a default for %j', (input) => {
    expect(cleanAttachmentName(input as string | null | undefined)).toBe(DEFAULT_ATTACHMENT_NAME);
  });

  it('keeps the name within the limit', () => {
    expect(cleanAttachmentName('x'.repeat(500))).toHaveLength(ATTACHMENT_NAME_LIMIT);
  });
});
