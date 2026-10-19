import { LINK_FETCH_LIMIT, MarketplaceDiscoveryService, NEW_ARRIVAL_REASON } from '../marketplace-discovery.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-16T00:00:00.000Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS);

const masteryEntry = (conceptId: string, score: number, evidenceCount = 3, lastEventAt: Date | null = daysAgo(0)) => ({
  conceptId,
  title: `Judul ${conceptId}`,
  level: 1,
  score,
  confidence: 0.2,
  evidenceCount,
  lastEventAt,
  passed: score >= 0.7 && evidenceCount >= 3,
  mastered: score >= 0.9 && evidenceCount >= 3,
});

const articleRow = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  title: `Artikel ${id}`,
  excerpt: 'Ringkasan',
  coverImage: { url: `https://img.test/${id}.png` },
  accessType: 'PAID',
  price: { toString: () => '25000' },
  currency: 'IDR',
  publishedAt: daysAgo(3),
  author: { name: 'Penulis' },
  tenant: { name: 'Tenant' },
  ...overrides,
});

const classRow = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  title: `Kelas ${id}`,
  description: 'Deskripsi',
  coverImage: null,
  accessType: 'FREE',
  price: null,
  currency: 'IDR',
  format: 'LIVE',
  difficulty: 'BEGINNER',
  publishedAt: daysAgo(5),
  instructor: { name: 'Pengajar' },
  tenant: { name: 'Tenant' },
  ...overrides,
});

interface Fixture {
  mastery?: ReturnType<typeof masteryEntry>[];
  nodes?: Array<{ conceptId: string; title: string; level: number; state: string; score: number; evidenceCount: number }>;
  next?: { conceptId: string | null };
  links?: Array<{ conceptId: string; article?: ReturnType<typeof articleRow> | null; classProduct?: ReturnType<typeof classRow> | null }>;
  entitlements?: Array<{ articleId: string | null; classId: string | null }>;
  enrollments?: Array<{ classProductId: string }>;
  articles?: ReturnType<typeof articleRow>[];
  classes?: ReturnType<typeof classRow>[];
  enrolled?: boolean;
}

const build = ({ mastery = [], nodes = [], next = { conceptId: null }, links = [], entitlements = [], enrollments = [], articles = [], classes = [], enrolled = true }: Fixture = {}) => {
  const state = {
    listMastery: jest.fn().mockResolvedValue(mastery),
    skillNodes: jest.fn().mockResolvedValue(nodes),
    nextConcept: jest.fn().mockResolvedValue(next),
    hasEnrollment: jest.fn().mockResolvedValue(enrolled),
  };
  const prisma = {
    productConceptLink: { findMany: jest.fn().mockResolvedValue(links.map((link) => ({ article: null, classProduct: null, ...link }))) },
    entitlement: { findMany: jest.fn().mockResolvedValue(entitlements) },
    classEnrollment: { findMany: jest.fn().mockResolvedValue(enrollments) },
    article: { findMany: jest.fn().mockResolvedValue(articles) },
    classProduct: { findMany: jest.fn().mockResolvedValue(classes) },
  };
  return { service: new MarketplaceDiscoveryService(prisma as never, state as never), prisma, state };
};

const ids = (result: Awaited<ReturnType<MarketplaceDiscoveryService['recommend']>>) => result.recommendations.map((item) => `${item.product.kind}:${item.product.id}`);

describe('MarketplaceDiscoveryService.recommend', () => {
  it('recommends a product that teaches the concept the learner is weak at, and says so with the real score', async () => {
    const { service } = build({
      mastery: [masteryEntry('jurnal', 0.31)],
      links: [{ conceptId: 'jurnal', article: articleRow('a1') }],
    });

    const result = await service.recommend('user-1', { limit: 5 }, NOW);

    expect(result.algorithm).toBe('reco-v1');
    expect(result.recommendations).toHaveLength(1);
    expect(result.recommendations[0]).toMatchObject({
      personalized: true,
      reason: 'Membahas "Judul jurnal", penguasaanmu baru 31%.',
      matchedConcepts: [{ conceptId: 'jurnal', kind: 'WEAK', score: 0.31 }],
      product: { kind: 'article', id: 'a1', creator: 'Penulis', coverUrl: 'https://img.test/a1.png', price: 25000, accessType: 'PAID' },
    });
  });

  it('asks the database only for approved links to concepts the learner needs, of published products by someone else', async () => {
    const { service, prisma } = build({ mastery: [masteryEntry('jurnal', 0.31)] });

    await service.recommend('user-1', { limit: 5 }, NOW);

    expect(prisma.productConceptLink.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          conceptId: { in: ['jurnal'] },
          status: 'APPROVED',
          OR: [
            { article: { status: 'PUBLISHED', tenant: { status: 'ACTIVE' }, authorId: { not: 'user-1' } } },
            { classProduct: { status: 'PUBLISHED', tenant: { status: 'ACTIVE' }, instructorId: { not: 'user-1' } } },
          ],
        },
        take: LINK_FETCH_LIMIT,
      }),
    );
  });

  it('does not turn the first concept of the whole registry into a need for a learner who enrolled in nothing', async () => {
    const { service, prisma } = build({
      enrolled: false,
      nodes: [{ conceptId: 'dasar', title: 'Dasar', level: 1, state: 'AVAILABLE', score: 0, evidenceCount: 0 }],
      next: { conceptId: 'dasar' },
      links: [{ conceptId: 'dasar', article: articleRow('a1') }],
      articles: [articleRow('a1')],
    });

    const result = await service.recommend('user-1', { limit: 5 }, NOW);

    expect(prisma.productConceptLink.findMany).not.toHaveBeenCalled();
    expect(result.needs).toEqual([]);
    expect(result.recommendations.map((item) => [item.personalized, item.reason])).toEqual([[false, NEW_ARRIVAL_REASON]]);
  });

  it('still uses real evidence for a learner who enrolled in nothing', async () => {
    const { service } = build({
      enrolled: false,
      mastery: [masteryEntry('jurnal', 0.4)],
      links: [{ conceptId: 'jurnal', article: articleRow('a1') }],
    });

    const result = await service.recommend('user-1', { limit: 5 }, NOW);

    expect(result.recommendations[0]).toMatchObject({ personalized: true, matchedConcepts: [{ conceptId: 'jurnal', kind: 'WEAK' }] });
  });

  it('uses the next concept and the ready concepts of the courses an enrolled learner opened', async () => {
    const { service } = build({
      nodes: [{ conceptId: 'dasar', title: 'Dasar', level: 1, state: 'AVAILABLE', score: 0, evidenceCount: 0 }],
      next: { conceptId: 'dasar' },
      links: [{ conceptId: 'dasar', article: articleRow('a1') }],
    });

    const result = await service.recommend('user-1', { limit: 5 }, NOW);

    expect(result.recommendations[0]).toMatchObject({ personalized: true, matchedConcepts: [{ conceptId: 'dasar', kind: 'NEXT' }] });
  });

  it('skips the link query for a learner with no needs', async () => {
    const { service, prisma } = build({ articles: [articleRow('a1')] });

    const result = await service.recommend('user-1', { limit: 5 }, NOW);

    expect(prisma.productConceptLink.findMany).not.toHaveBeenCalled();
    expect(result.recommendations.map((item) => item.personalized)).toEqual([false]);
  });

  it('never recommends what the learner already owns, by entitlement or by enrolment', async () => {
    const { service } = build({
      mastery: [masteryEntry('jurnal', 0.3)],
      links: [
        { conceptId: 'jurnal', article: articleRow('owned-article') },
        { conceptId: 'jurnal', classProduct: classRow('owned-class') },
        { conceptId: 'jurnal', classProduct: classRow('enrolled-class') },
        { conceptId: 'jurnal', article: articleRow('free-to-buy') },
      ],
      entitlements: [
        { articleId: 'owned-article', classId: null },
        { articleId: null, classId: 'owned-class' },
      ],
      enrollments: [{ classProductId: 'enrolled-class' }],
    });

    const result = await service.recommend('user-1', { limit: 10 }, NOW);

    expect(ids(result)).toEqual(['article:free-to-buy']);
  });

  it('groups the links of one product and rewards a product that covers more of what is needed', async () => {
    const { service } = build({
      mastery: [masteryEntry('a', 0.3), masteryEntry('b', 0.3)],
      links: [
        { conceptId: 'a', article: articleRow('both') },
        { conceptId: 'b', article: articleRow('both') },
        { conceptId: 'a', article: articleRow('only-a') },
      ],
    });

    const result = await service.recommend('user-1', { limit: 5 }, NOW);

    expect(ids(result)).toEqual(['article:both', 'article:only-a']);
    expect(result.recommendations[0].matchedConcepts.map((concept) => concept.conceptId).sort()).toEqual(['a', 'b']);
    expect(result.recommendations[0].reason).toMatch(/dan 1 konsep lain/);
  });

  it('turns a passed concept that has gone cold into a review recommendation', async () => {
    const { service } = build({
      mastery: [masteryEntry('lama', 0.85, 5, daysAgo(60))],
      links: [{ conceptId: 'lama', article: articleRow('refresh') }],
    });

    const result = await service.recommend('user-1', { limit: 5 }, NOW);

    expect(result.recommendations[0]).toMatchObject({ reason: 'Membahas "Judul lama", waktunya kamu mengulang.', matchedConcepts: [{ kind: 'DUE' }] });
  });

  it('recommends for the next concept and for concepts that are ready to start', async () => {
    const { service } = build({
      next: { conceptId: 'n1' },
      nodes: [
        { conceptId: 'n1', title: 'Konsep pertama', level: 1, state: 'AVAILABLE', score: 0, evidenceCount: 0 },
        { conceptId: 'r1', title: 'Konsep siap', level: 1, state: 'AVAILABLE', score: 0, evidenceCount: 0 },
        { conceptId: 'locked', title: 'Terkunci', level: 2, state: 'LOCKED', score: 0, evidenceCount: 0 },
      ],
      links: [
        { conceptId: 'r1', article: articleRow('ready-article') },
        { conceptId: 'n1', article: articleRow('next-article') },
        { conceptId: 'locked', article: articleRow('locked-article') },
      ],
    });

    const result = await service.recommend('user-1', { limit: 5 }, NOW);

    expect(ids(result).slice(0, 2)).toEqual(['article:next-article', 'article:ready-article']);
    expect(result.recommendations[0].reason).toBe('Membahas "Konsep pertama", konsep berikutnya di jalur belajarmu.');
    expect(ids(result)).not.toContain('article:locked-article');
  });

  it('fits a class to the level of the learner on the concept it teaches', async () => {
    const { service } = build({
      mastery: [masteryEntry('jurnal', 0.2)],
      links: [
        { conceptId: 'jurnal', classProduct: classRow('hard', { difficulty: 'ADVANCED' }) },
        { conceptId: 'jurnal', classProduct: classRow('easy', { difficulty: 'BEGINNER' }) },
      ],
    });

    const result = await service.recommend('user-1', { limit: 5 }, NOW);

    expect(result.recommendations.map((item) => [item.product.id, item.difficultyFit])).toEqual([
      ['easy', 'MATCH'],
      ['hard', 'FAR'],
    ]);
  });

  it('respects the limit', async () => {
    const links = Array.from({ length: 6 }, (_, index) => ({ conceptId: 'jurnal', article: articleRow(`a${index}`) }));
    const { service } = build({ mastery: [masteryEntry('jurnal', 0.3)], links });

    const result = await service.recommend('user-1', { limit: 3 }, NOW);

    expect(result.recommendations).toHaveLength(3);
  });

  describe('when too few products match', () => {
    it('fills the rest with new arrivals and labels them as such, without a fake reason', async () => {
      const { service } = build({
        mastery: [masteryEntry('jurnal', 0.3)],
        links: [{ conceptId: 'jurnal', article: articleRow('match') }],
        articles: [articleRow('match'), articleRow('fresh-article', { publishedAt: daysAgo(1) })],
        classes: [classRow('fresh-class', { publishedAt: daysAgo(2) })],
      });

      const result = await service.recommend('user-1', { limit: 3 }, NOW);

      expect(result.recommendations.map((item) => [item.product.id, item.personalized, item.reason === NEW_ARRIVAL_REASON])).toEqual([
        ['match', true, false],
        ['fresh-article', false, true],
        ['fresh-class', false, true],
      ]);
      expect(result.recommendations[1]).toMatchObject({ score: 0, matchedConcepts: [], difficultyFit: 'NOT_APPLICABLE' });
    });

    it('keeps owned products and own work out of the fill too', async () => {
      const { service, prisma } = build({
        articles: [articleRow('owned'), articleRow('ok')],
        entitlements: [{ articleId: 'owned', classId: null }],
      });

      const result = await service.recommend('user-1', { limit: 5 }, NOW);

      expect(ids(result)).toEqual(['article:ok']);
      expect(prisma.article.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ authorId: { not: 'user-1' } }) }));
      expect(prisma.classProduct.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ instructorId: { not: 'user-1' } }) }));
    });

    it('does not repeat a product that was already recommended for a reason', async () => {
      const { service } = build({
        mastery: [masteryEntry('jurnal', 0.3)],
        links: [{ conceptId: 'jurnal', article: articleRow('match') }],
        articles: [articleRow('match')],
      });

      const result = await service.recommend('user-1', { limit: 5 }, NOW);

      expect(ids(result)).toEqual(['article:match']);
    });

    it('does not read the catalog when the personal list already fills the limit', async () => {
      const { service, prisma } = build({
        mastery: [masteryEntry('jurnal', 0.3)],
        links: [{ conceptId: 'jurnal', article: articleRow('one') }],
      });

      await service.recommend('user-1', { limit: 1 }, NOW);

      expect(prisma.article.findMany).not.toHaveBeenCalled();
    });
  });

  describe('the learner level that is reported', () => {
    it('is beginner for a learner without any evidence (no floor that skips ahead)', async () => {
      const { service } = build();

      const result = await service.recommend('user-1', { limit: 5 }, NOW);

      expect(result).toMatchObject({ averageMastery: 0, preferredDifficulty: 'BEGINNER' });
    });

    it.each([
      [0.3, 'BEGINNER'],
      [0.5, 'INTERMEDIATE'],
      [0.9, 'ADVANCED'],
    ])('follows the average of concepts with evidence (%f is %s)', async (score, expected) => {
      const { service } = build({ mastery: [masteryEntry('a', score), masteryEntry('unseen', 0.5, 0, null)] });

      const result = await service.recommend('user-1', { limit: 5 }, NOW);

      expect(result.averageMastery).toBeCloseTo(score, 10);
      expect(result.preferredDifficulty).toBe(expected);
    });
  });

  it('reports the top needs so the learner can see what drives the list', async () => {
    const { service } = build({ mastery: [masteryEntry('a', 0.1), masteryEntry('b', 0.2)] });

    const result = await service.recommend('user-1', { limit: 5 }, NOW);

    expect(result.needs.map((need) => [need.conceptId, need.kind])).toEqual([
      ['a', 'WEAK'],
      ['b', 'WEAK'],
    ]);
  });

  it('reads only the caller', async () => {
    const { service, state, prisma } = build();

    await service.recommend('user-9', { limit: 5 }, NOW);

    expect(state.listMastery).toHaveBeenCalledWith('user-9');
    expect(state.skillNodes).toHaveBeenCalledWith('user-9');
    expect(state.nextConcept).toHaveBeenCalledWith('user-9');
    expect(prisma.entitlement.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: 'user-9' }) }));
  });
});
