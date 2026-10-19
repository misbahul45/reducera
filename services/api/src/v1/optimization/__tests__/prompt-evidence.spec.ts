import { PromptEvidenceService, SAMPLE_LIMIT, SAMPLE_REPLY_CHARS, THEME_LIMIT, redactReply } from '../prompt-evidence';

describe('redactReply', () => {
  it('replaces the first and last name of the learner, ignoring case and word parts', () => {
    expect(redactReply('Hai Rani, kerja bagus! Pelajar Rani Pelajar sudah paham, rania belum.', 'Rani Pelajar')).toBe(
      'Hai [nama], kerja bagus! [nama] [nama] [nama] sudah paham, rania belum.',
    );
  });

  it('removes addresses and links', () => {
    expect(redactReply('Kirim ke rani@example.com atau buka https://example.com/x?y=1 ya', null)).toBe('Kirim ke [email] atau buka [tautan] ya');
  });

  it('keeps short name parts out of the pattern so ordinary words survive', () => {
    expect(redactReply('Di sini ada jurnal', 'Di Wi')).toBe('Di sini ada jurnal');
  });

  it('is safe with regular expression characters in a name', () => {
    expect(redactReply('Halo (Rani+) apa kabar', 'Rani+ (x)')).toBe('Halo (Rani+) apa kabar');
  });

  it('collapses whitespace and cuts a long reply with an ellipsis', () => {
    const long = redactReply(`${'kata '.repeat(300)}`, null);

    expect(long.length).toBe(SAMPLE_REPLY_CHARS);
    expect(long.endsWith('…')).toBe(true);
    expect(redactReply('a \n\n  b\t c', undefined)).toBe('a b c');
  });
});

describe('PromptEvidenceService', () => {
  const service = (rows: unknown[]) => {
    const prisma = { $queryRaw: jest.fn().mockResolvedValue(rows) };
    return { evidence: new PromptEvidenceService(prisma as never), prisma };
  };

  it('turns the aggregate rows into numbers', async () => {
    const { evidence } = service([{ strategy: 'HINT', attempts: 12n, failures: 8n }]);

    expect(await evidence.themes('tutor-chat@1')).toEqual([{ strategy: 'HINT', attempts: 12, failures: 8 }]);
  });

  it('redacts the learner name from every sample and never returns the name itself', async () => {
    const { evidence } = service([
      { strategy: 'HINT', scoreDelta: -0.0212, grounded: false, response: 'Coba lagi ya Rani', learnerName: 'Rani Pelajar' },
      { strategy: 'EXPLAIN', scoreDelta: null, grounded: true, response: 'Penjelasan singkat', learnerName: null },
    ]);

    const samples = await evidence.samples('tutor-chat@1');

    expect(samples).toEqual([
      { strategy: 'HINT', grounded: false, scoreDelta: -0.021, reply: 'Coba lagi ya [nama]' },
      { strategy: 'EXPLAIN', grounded: true, scoreDelta: null, reply: 'Penjelasan singkat' },
    ]);
    expect(JSON.stringify(samples)).not.toContain('Rani');
    expect(Object.keys(samples[0]).sort()).toEqual(['grounded', 'reply', 'scoreDelta', 'strategy']);
  });

  it('drops a sample whose reply is empty after redaction', async () => {
    const { evidence } = service([{ strategy: 'HINT', scoreDelta: 0, grounded: false, response: ' ', learnerName: 'Rani' }]);

    expect(await evidence.samples('x')).toEqual([]);
  });

  it('is bounded', () => {
    expect(THEME_LIMIT).toBeLessThanOrEqual(12);
    expect(SAMPLE_LIMIT).toBeLessThanOrEqual(8);
  });
});
