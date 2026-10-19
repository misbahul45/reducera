import { randomUUID } from 'crypto';
import { ForbiddenException } from '@nestjs/common';
import { Role, TenantRole } from '@prisma/client';
import { Pool } from 'pg';
import { TenantContext } from '@/common/tenancy/tenant-context';
import { ConceptRegistryService } from '@/v1/learner-model/concepts/concept-registry.service';
import { LearnerEventsService } from '@/v1/learner-model/events/learner-events.service';
import { AssessmentPayload } from '@/v1/learner-model/mastery/assessment-payload';
import { LearnerPolicyService } from '@/v1/learner-model/policy/learner-policy.service';
import { LearnerStateService } from '@/v1/learner-model/learner-state.service';
import { MarketplaceDiscoveryService } from '@/v1/marketplace/marketplace-discovery.service';
import { MAX_CONCEPTS_PER_PRODUCT } from '@/v1/marketplace/product-concept-links';
import {
  REGISTRY_SUITE_LOCK,
  createPool,
  databaseUrl,
  describeDb,
  expectViolation,
  holdSuiteLock,
  insertMembership,
  insertTenant,
  insertUser,
  withRollback,
} from '@/test-utils/pg-fixtures';
import { buildCommerceStack, CommerceStack } from '@/test-utils/commerce-harness';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date();
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS);

const weakAssessment = (): AssessmentPayload => ({ attemptId: randomUUID(), quizId: 'quiz-pc', score: 0.2, items: 5, hintsUsed: 0, share: 1, attemptNumber: 1 });

describeDb('concept tagged products on a real database (requires TEST_DATABASE_URL)', () => {
  let pool: Pool;
  let s: CommerceStack;
  let discovery: MarketplaceDiscoveryService;
  let events: LearnerEventsService;
  let releaseLock: () => Promise<void>;

  const tag = randomUUID().slice(0, 8);
  const concept = (name: string) => `pc-${tag}-${name}`;
  const ids = { jurnal: concept('jurnal'), neraca: concept('neraca'), kas: concept('kas'), lain: concept('lain'), a: concept('a'), b: concept('b'), c: concept('c'), d: concept('d'), e: concept('e'), f: concept('f') };

  const teacher = (id: string) => ({ id, role: Role.TEACHER });
  const admin = (id: string) => ({ id, role: Role.ADMIN });
  const ctx = (userId: string, tenantId: string, tenantRole: TenantRole): TenantContext => ({ userId, tenantId, tenantRole, isPlatformAdmin: false });

  const creators: string[] = [];
  const learners: string[] = [];

  const creator = async () => {
    const owner = await insertUser(pool, 'TEACHER');
    const author = await insertUser(pool, 'TEACHER');
    const reviewer = await insertUser(pool, 'ADMIN');
    const tenant = await insertTenant(pool, owner);
    await insertMembership(pool, tenant, owner, 'OWNER');
    await insertMembership(pool, tenant, author, 'TEACHER');
    creators.push(owner, author, reviewer);
    return { owner, author, reviewer, tenant, authorCtx: ctx(author, tenant, TenantRole.TEACHER) };
  };

  const learner = async () => {
    const id = await insertUser(pool);
    learners.push(id);
    return id;
  };

  const weakOn = async (userId: string, conceptId: string, times = 2) => {
    for (let n = 0; n < times; n += 1) {
      await events.append({ userId, conceptId, idempotencyKey: randomUUID(), payload: weakAssessment(), occurredAt: daysAgo(0) });
    }
  };

  const publishedArticle = async (w: Awaited<ReturnType<typeof creator>>, conceptIds: string[] | undefined, extra: Record<string, unknown> = {}) => {
    const created = (
      await s.articleAuthoring.create(
        teacher(w.author),
        w.authorCtx,
        { title: 'Memahami jurnal', accessType: 'FREE', content: '# Isi', ...(conceptIds !== undefined && { conceptIds }), ...extra } as never,
        't',
      )
    ).data;
    await s.articleAuthoring.submitReview(teacher(w.author), w.authorCtx, created.id, 't');
    await s.articleModeration.approve(admin(w.reviewer), created.id, 'ok', 't');
    return created;
  };

  const linksOf = (articleId: string) =>
    s.prisma.productConceptLink.findMany({ where: { articleId }, select: { conceptId: true, status: true }, orderBy: { conceptId: 'asc' } });

  beforeAll(async () => {
    releaseLock = await holdSuiteLock(REGISTRY_SUITE_LOCK);
    process.env.DATABASE_URL = databaseUrl;
    pool = createPool();
    s = buildCommerceStack();
    events = new LearnerEventsService(s.prisma);
    discovery = new MarketplaceDiscoveryService(s.prisma, new LearnerStateService(s.prisma, new ConceptRegistryService(s.prisma), new LearnerPolicyService()));
    for (const [index, id] of Object.values(ids).entries()) {
      await s.prisma.concept.create({ data: { id, title: `Judul ${id}`, level: 1, sortOrder: 900 + index } });
    }
    await s.prisma.conceptPrerequisite.create({ data: { conceptId: ids.lain, requiresId: ids.jurnal } });
  }, 120_000);

  afterAll(async () => {
    try {
      await s.prisma.productConceptLink.deleteMany({ where: { conceptId: { in: Object.values(ids) } } });
      await s.prisma.entitlement.deleteMany({ where: { userId: { in: [...creators, ...learners] } } });
      await s.prisma.user.deleteMany({ where: { id: { in: learners } } });
      await s.prisma.concept.deleteMany({ where: { id: { in: Object.values(ids) } } });
    } finally {
      await s.prisma.$disconnect();
      await pool.end();
      await releaseLock();
    }
  });

  describe('tagging while authoring', () => {
    it('saves the tags as proposals, shows them to the author and keeps them out of the public listing until approval', async () => {
      const w = await creator();
      const created = (
        await s.articleAuthoring.create(teacher(w.author), w.authorCtx, { title: 'Jurnal', accessType: 'FREE', content: 'x', conceptIds: [ids.jurnal, ids.neraca] } as never, 't')
      ).data;

      expect(await linksOf(created.id)).toEqual([
        { conceptId: ids.jurnal, status: 'PROPOSED' },
        { conceptId: ids.neraca, status: 'PROPOSED' },
      ]);
      const mine = (await s.articleAuthoring.findOne(teacher(w.author), w.authorCtx, created.id)).data;
      expect(mine.conceptLinks.map((link) => [link.conceptId, link.status, link.title])).toEqual([
        [ids.jurnal, 'PROPOSED', `Judul ${ids.jurnal}`],
        [ids.neraca, 'PROPOSED', `Judul ${ids.neraca}`],
      ]);
    });

    it('lets the author change the set: unchanged tags stay, dropped ones go, new ones are proposed', async () => {
      const w = await creator();
      const created = (await s.articleAuthoring.create(teacher(w.author), w.authorCtx, { title: 'Jurnal', accessType: 'FREE', content: 'x', conceptIds: [ids.jurnal, ids.neraca] } as never, 't')).data;
      const before = await s.prisma.productConceptLink.findMany({ where: { articleId: created.id, conceptId: ids.jurnal } });

      await s.articleAuthoring.update(teacher(w.author), w.authorCtx, created.id, { conceptIds: [ids.jurnal, ids.kas] } as never, 't');

      expect((await linksOf(created.id)).map((link) => link.conceptId)).toEqual([ids.jurnal, ids.kas].sort());
      const after = await s.prisma.productConceptLink.findMany({ where: { articleId: created.id, conceptId: ids.jurnal } });
      expect(after[0].id).toBe(before[0].id);
    });

    it('leaves the tags alone when an update does not mention them and clears them for an empty list', async () => {
      const w = await creator();
      const created = (await s.articleAuthoring.create(teacher(w.author), w.authorCtx, { title: 'Jurnal', accessType: 'FREE', content: 'x', conceptIds: [ids.jurnal] } as never, 't')).data;

      await s.articleAuthoring.update(teacher(w.author), w.authorCtx, created.id, { title: 'Judul baru' } as never, 't');
      expect(await linksOf(created.id)).toHaveLength(1);

      await s.articleAuthoring.update(teacher(w.author), w.authorCtx, created.id, { conceptIds: [] } as never, 't');
      expect(await linksOf(created.id)).toHaveLength(0);
    });

    it('refuses an unknown or retired concept with 422 and keeps the previous tags and the draft unchanged', async () => {
      const w = await creator();
      const created = (await s.articleAuthoring.create(teacher(w.author), w.authorCtx, { title: 'Jurnal', accessType: 'FREE', content: 'x', conceptIds: [ids.jurnal] } as never, 't')).data;
      await s.prisma.concept.update({ where: { id: ids.lain }, data: { status: 'DEPRECATED' } });

      try {
        await expect(
          s.articleAuthoring.update(teacher(w.author), w.authorCtx, created.id, { title: 'Tidak boleh tersimpan', conceptIds: [ids.neraca, 'tidak-ada'] } as never, 't'),
        ).rejects.toMatchObject({ statusCode: 422 });
        await expect(
          s.articleAuthoring.update(teacher(w.author), w.authorCtx, created.id, { conceptIds: [ids.lain] } as never, 't'),
        ).rejects.toMatchObject({ statusCode: 422 });
      } finally {
        await s.prisma.concept.update({ where: { id: ids.lain }, data: { status: 'ACTIVE' } });
      }

      expect((await linksOf(created.id)).map((link) => link.conceptId)).toEqual([ids.jurnal]);
      expect((await s.prisma.article.findUniqueOrThrow({ where: { id: created.id } })).title).toBe('Jurnal');
    });

    it(`refuses more than ${MAX_CONCEPTS_PER_PRODUCT} concepts`, async () => {
      const w = await creator();
      const six = [ids.a, ids.b, ids.c, ids.d, ids.e, ids.f];

      await expect(s.articleAuthoring.create(teacher(w.author), w.authorCtx, { title: 'Terlalu banyak', accessType: 'FREE', content: 'x', conceptIds: six } as never, 't')).rejects.toMatchObject({
        statusCode: 422,
      });
      expect(await s.prisma.article.count({ where: { tenantId: w.tenant, title: 'Terlalu banyak' } })).toBe(0);
    });

    it('cannot be tagged by someone who may not edit the article', async () => {
      const w = await creator();
      const stranger = await creator();
      const created = (await s.articleAuthoring.create(teacher(w.author), w.authorCtx, { title: 'Jurnal', accessType: 'FREE', content: 'x' } as never, 't')).data;

      await expect(s.articleAuthoring.update(teacher(stranger.author), stranger.authorCtx, created.id, { conceptIds: [ids.jurnal] } as never, 't')).rejects.toMatchObject({ statusCode: 404 });
      expect(await linksOf(created.id)).toHaveLength(0);
    });

    it('tags a class the same way', async () => {
      const w = await creator();
      const created = (
        await s.classAuthoring.create(teacher(w.author), w.authorCtx, { title: 'Kelas jurnal', accessType: 'FREE', format: 'RECORDED', difficulty: 'BEGINNER', conceptIds: [ids.jurnal] } as never, 't')
      ).data;

      const links = await s.prisma.productConceptLink.findMany({ where: { classProductId: created.id } });
      expect(links.map((link) => [link.conceptId, link.status, link.proposedById])).toEqual([[ids.jurnal, 'PROPOSED', w.author]]);
      expect((await s.classAuthoring.findOne(teacher(w.author), w.authorCtx, created.id)).data.conceptLinks).toHaveLength(1);
    });
  });

  describe('review', () => {
    it('shows the admin the proposed tags and approves them together with the article', async () => {
      const w = await creator();
      const created = (await s.articleAuthoring.create(teacher(w.author), w.authorCtx, { title: 'Jurnal', accessType: 'FREE', content: 'x', conceptIds: [ids.jurnal] } as never, 't')).data;
      await s.articleAuthoring.submitReview(teacher(w.author), w.authorCtx, created.id, 't');

      const queued = (await s.articleModeration.findOne(admin(w.reviewer), created.id)).data;
      expect(queued.conceptLinks).toEqual([{ conceptId: ids.jurnal, title: `Judul ${ids.jurnal}`, level: 1, status: 'PROPOSED' }]);
      expect((await s.marketplaceArticles.list({ page: 1, limit: 50, sort: 'newest', tenantId: w.tenant } as never)).data.data).toHaveLength(0);

      await s.articleModeration.approve(admin(w.reviewer), created.id, 'ok', 't');

      expect(await linksOf(created.id)).toEqual([{ conceptId: ids.jurnal, status: 'APPROVED' }]);
      const listed = (await s.marketplaceArticles.list({ page: 1, limit: 50, sort: 'newest', tenantId: w.tenant } as never)).data.data;
      expect(listed.map((article) => [article.id, article.concepts])).toEqual([[created.id, [{ id: ids.jurnal, title: `Judul ${ids.jurnal}` }]]]);
      expect((await s.marketplaceArticles.findOne(created.id)).data.concepts).toEqual([{ id: ids.jurnal, title: `Judul ${ids.jurnal}` }]);
    });

    it('keeps the tags proposed when the article is rejected, so the author can fix and resubmit', async () => {
      const w = await creator();
      const created = (await s.articleAuthoring.create(teacher(w.author), w.authorCtx, { title: 'Jurnal', accessType: 'FREE', content: 'x', conceptIds: [ids.jurnal] } as never, 't')).data;
      await s.articleAuthoring.submitReview(teacher(w.author), w.authorCtx, created.id, 't');

      await s.articleModeration.reject(admin(w.reviewer), created.id, 'tag tidak sesuai isi', 't');

      expect(await linksOf(created.id)).toEqual([{ conceptId: ids.jurnal, status: 'PROPOSED' }]);
      await s.articleAuthoring.update(teacher(w.author), w.authorCtx, created.id, { conceptIds: [ids.neraca] } as never, 't');
      expect((await linksOf(created.id)).map((link) => link.conceptId)).toEqual([ids.neraca]);
    });

    it('does not show the tags of a class before it is approved', async () => {
      const w = await creator();
      const created = (await s.classAuthoring.create(teacher(w.author), w.authorCtx, { title: 'Kelas', accessType: 'FREE', format: 'RECORDED', conceptIds: [ids.jurnal] } as never, 't')).data;
      await s.classAuthoring.addSession(
        teacher(w.author),
        w.authorCtx,
        created.id,
        { startsAt: new Date(NOW.getTime() + 2 * DAY_MS), endsAt: new Date(NOW.getTime() + 2 * DAY_MS + 3_600_000), recordingUrl: 'https://rec.example.test/a' } as never,
        't',
      );
      await s.classAuthoring.submitReview(teacher(w.author), w.authorCtx, created.id, 't');
      expect((await s.classModeration.findOne(admin(w.reviewer), created.id)).data.conceptLinks).toHaveLength(1);

      await s.classModeration.approve(admin(w.reviewer), created.id, 'ok', 't');

      expect((await s.marketplaceClasses.findOne(created.id)).data.concepts).toEqual([{ id: ids.jurnal, title: `Judul ${ids.jurnal}` }]);
    });
  });

  describe('database rules', () => {
    it('refuses a link that names no product, or two', async () => {
      const w = await creator();
      const article = (await s.articleAuthoring.create(teacher(w.author), w.authorCtx, { title: 'A', accessType: 'FREE', content: 'x' } as never, 't')).data;
      const cls = (await s.classAuthoring.create(teacher(w.author), w.authorCtx, { title: 'Kelas A', accessType: 'FREE' } as never, 't')).data;

      await withRollback(pool, async (client) => {
        await expectViolation(client, `INSERT INTO "ProductConceptLink" (id, "conceptId", "proposedById") VALUES (gen_random_uuid(), '${ids.jurnal}', 'test')`);
        await expectViolation(
          client,
          `INSERT INTO "ProductConceptLink" (id, "conceptId", "articleId", "classProductId", "proposedById") VALUES (gen_random_uuid(), '${ids.jurnal}', '${article.id}', '${cls.id}', 'test')`,
        );
      });
    });

    it('refuses the same concept twice on one product', async () => {
      const w = await creator();
      const article = (await s.articleAuthoring.create(teacher(w.author), w.authorCtx, { title: 'A', accessType: 'FREE', content: 'x', conceptIds: [ids.jurnal] } as never, 't')).data;

      await withRollback(pool, async (client) => {
        await expectViolation(
          client,
          `INSERT INTO "ProductConceptLink" (id, "conceptId", "articleId", "proposedById") VALUES (gen_random_uuid(), '${ids.jurnal}', '${article.id}', 'test')`,
        );
      });
    });

    it('stops at five links per product even for a writer that skips the service', async () => {
      const w = await creator();
      const article = (await s.articleAuthoring.create(teacher(w.author), w.authorCtx, { title: 'A', accessType: 'FREE', content: 'x', conceptIds: [ids.a, ids.b, ids.c, ids.d, ids.e] } as never, 't')).data;

      await withRollback(pool, async (client) => {
        await expectViolation(
          client,
          `INSERT INTO "ProductConceptLink" (id, "conceptId", "articleId", "proposedById") VALUES (gen_random_uuid(), '${ids.f}', '${article.id}', 'test')`,
        );
      });
      expect(await linksOf(article.id)).toHaveLength(5);
    });
  });

  describe('recommendations', () => {
    it('recommends the approved product for the concept the learner is weak at, with a reason that quotes the learner score', async () => {
      const w = await creator();
      const article = await publishedArticle(w, [ids.jurnal]);
      const userId = await learner();
      await weakOn(userId, ids.jurnal);

      const result = await discovery.recommend(userId, { limit: 10 });

      const hit = result.recommendations.find((item) => item.product.id === article.id);
      expect(hit).toBeDefined();
      expect(hit).toMatchObject({ personalized: true, matchedConcepts: [{ conceptId: ids.jurnal, kind: 'WEAK' }], product: { kind: 'article', creator: expect.any(String) } });
      expect(hit?.reason).toMatch(new RegExp(`^Membahas "Judul ${ids.jurnal}", penguasaanmu baru \\d+%\\.$`));
      expect(result.needs.map((need) => need.conceptId)).toContain(ids.jurnal);
    });

    it('does not recommend an unapproved, suspended or archived product', async () => {
      const w = await creator();
      const draft = (await s.articleAuthoring.create(teacher(w.author), w.authorCtx, { title: 'Draft', accessType: 'FREE', content: 'x', conceptIds: [ids.kas] } as never, 't')).data;
      const suspended = await publishedArticle(w, [ids.kas]);
      await s.articleModeration.suspend(admin(w.reviewer), suspended.id, 'pelanggaran', 't');
      const live = await publishedArticle(w, [ids.kas]);
      const userId = await learner();
      await weakOn(userId, ids.kas);

      const found = (await discovery.recommend(userId, { limit: 30 })).recommendations.map((item) => item.product.id);

      expect(found).toContain(live.id);
      expect(found).not.toContain(draft.id);
      expect(found).not.toContain(suspended.id);
    });

    it('does not recommend the learner own work or what the learner already owns', async () => {
      const w = await creator();
      const own = await publishedArticle(w, [ids.neraca]);
      const owned = await publishedArticle(w, [ids.neraca]);
      const other = await publishedArticle(w, [ids.neraca]);
      const userId = await learner();
      await weakOn(userId, ids.neraca);
      await s.prisma.entitlement.create({ data: { userId, resourceType: 'ARTICLE', articleId: owned.id, tenantId: w.tenant } });

      const forLearner = (await discovery.recommend(userId, { limit: 30 })).recommendations.map((item) => item.product.id);
      const forAuthor = (await discovery.recommend(w.author, { limit: 30 })).recommendations.map((item) => item.product.id);

      expect(forLearner).toEqual(expect.arrayContaining([own.id, other.id]));
      expect(forLearner).not.toContain(owned.id);
      for (const id of [own.id, owned.id, other.id]) expect(forAuthor).not.toContain(id);
    });

    it('ignores a product tagged with a concept the learner has no need for', async () => {
      const w = await creator();
      const offTopic = await publishedArticle(w, [ids.lain]);
      const userId = await learner();
      await weakOn(userId, ids.jurnal);

      const result = await discovery.recommend(userId, { limit: 30 });

      expect(result.recommendations.filter((item) => item.personalized).map((item) => item.product.id)).not.toContain(offTopic.id);
    });

    it('answers a learner without any evidence with a list that says plainly it is not personalised', async () => {
      const w = await creator();
      await publishedArticle(w, [ids.jurnal]);
      const userId = await learner();

      const result = await discovery.recommend(userId, { limit: 5 });

      expect(result).toMatchObject({ averageMastery: 0, preferredDifficulty: 'BEGINNER' });
      for (const item of result.recommendations) {
        if (!item.personalized) expect(item.reason).toBe('Terbaru di marketplace.');
      }
    });
  });
  describe('tags of a product that is already live', () => {
    const audit = (entityId: string, action: string) => s.prisma.auditLog.findMany({ where: { entityId, action }, orderBy: { createdAt: 'asc' } });

    const publishedClass = async (w: Awaited<ReturnType<typeof creator>>) => {
      const created = (await s.classAuthoring.create(teacher(w.author), w.authorCtx, { title: 'Kelas tayang', accessType: 'FREE', format: 'RECORDED' } as never, 't')).data;
      await s.classAuthoring.addSession(
        teacher(w.author),
        w.authorCtx,
        created.id,
        { startsAt: new Date(NOW.getTime() + 2 * DAY_MS), endsAt: new Date(NOW.getTime() + 2 * DAY_MS + 3_600_000), recordingUrl: 'https://rec.example.test/live' } as never,
        't',
      );
      await s.classAuthoring.submitReview(teacher(w.author), w.authorCtx, created.id, 't');
      await s.classModeration.approve(admin(w.reviewer), created.id, 'ok', 't');
      return created;
    };

    it('lets the author propose tags on a published article that stay out of the public listing until an administrator approves them', async () => {
      const w = await creator();
      const article = await publishedArticle(w, undefined);

      const saved = await s.articleAuthoring.setConcepts(teacher(w.author), w.authorCtx, article.id, [ids.jurnal, ids.neraca], 't');

      expect(saved.data.conceptLinks.map((link) => [link.conceptId, link.status])).toEqual([[ids.jurnal, 'PROPOSED'], [ids.neraca, 'PROPOSED']]);
      expect((await s.marketplaceArticles.findOne(article.id)).data.concepts).toEqual([]);
      expect((await s.articleModeration.findOne(admin(w.reviewer), article.id)).data).toMatchObject({ pendingConceptTags: 2 });

      const approved = await s.articleModeration.approveConcepts(admin(w.reviewer), article.id, 'Sesuai isi', 't');

      expect(approved.data).toMatchObject({ changed: true, conceptIds: [ids.jurnal, ids.neraca].sort() });
      expect(await linksOf(article.id)).toEqual([
        { conceptId: ids.jurnal, status: 'APPROVED' },
        { conceptId: ids.neraca, status: 'APPROVED' },
      ].sort((a, b) => a.conceptId.localeCompare(b.conceptId)));
      expect((await s.marketplaceArticles.findOne(article.id)).data.concepts.map((concept) => concept.id).sort()).toEqual([ids.jurnal, ids.neraca].sort());
      const [entry] = await audit(article.id, 'ARTICLE_CONCEPTS_APPROVED');
      expect(entry).toMatchObject({ actorId: w.reviewer, reason: 'Sesuai isi' });
    });

    it('makes the article recommendable only after the approval', async () => {
      const w = await creator();
      const article = await publishedArticle(w, undefined);
      const userId = await learner();
      await weakOn(userId, ids.kas);
      await s.articleAuthoring.setConcepts(teacher(w.author), w.authorCtx, article.id, [ids.kas], 't');

      const before = (await discovery.recommend(userId, { limit: 30 })).recommendations.filter((item) => item.personalized).map((item) => item.product.id);
      await s.articleModeration.approveConcepts(admin(w.reviewer), article.id, undefined, 't');
      const after = (await discovery.recommend(userId, { limit: 30 })).recommendations.filter((item) => item.personalized).map((item) => item.product.id);

      expect(before).not.toContain(article.id);
      expect(after).toContain(article.id);
    });

    it('is idempotent: approving or rejecting with nothing waiting changes nothing and writes no audit row', async () => {
      const w = await creator();
      const article = await publishedArticle(w, [ids.jurnal]);

      const approve = await s.articleModeration.approveConcepts(admin(w.reviewer), article.id, undefined, 't');
      const reject = await s.articleModeration.rejectConcepts(admin(w.reviewer), article.id, 'tidak ada yang menunggu', 't');

      expect(approve.data.changed).toBe(false);
      expect(reject.data.changed).toBe(false);
      expect(await linksOf(article.id)).toEqual([{ conceptId: ids.jurnal, status: 'APPROVED' }]);
      expect(await audit(article.id, 'ARTICLE_CONCEPTS_REJECTED')).toHaveLength(0);
    });

    it('drops only the proposals when an administrator rejects them, with the reason in the audit trail', async () => {
      const w = await creator();
      const article = await publishedArticle(w, [ids.jurnal]);
      await s.articleAuthoring.setConcepts(teacher(w.author), w.authorCtx, article.id, [ids.jurnal, ids.lain], 't');
      expect(await linksOf(article.id)).toEqual([
        { conceptId: ids.jurnal, status: 'APPROVED' },
        { conceptId: ids.lain, status: 'PROPOSED' },
      ].sort((a, b) => a.conceptId.localeCompare(b.conceptId)));

      const rejected = await s.articleModeration.rejectConcepts(admin(w.reviewer), article.id, 'Konsep itu tidak dibahas', 't');

      expect(rejected.data).toMatchObject({ changed: true, conceptIds: [ids.lain] });
      expect(await linksOf(article.id)).toEqual([{ conceptId: ids.jurnal, status: 'APPROVED' }]);
      const [entry] = await audit(article.id, 'ARTICLE_CONCEPTS_REJECTED');
      expect(entry).toMatchObject({ reason: 'Konsep itu tidak dibahas', before: { conceptIds: [ids.lain] } });
    });

    it('takes a removed approved tag out of the listing at once, because removing needs no review', async () => {
      const w = await creator();
      const article = await publishedArticle(w, [ids.jurnal, ids.neraca]);

      await s.articleAuthoring.setConcepts(teacher(w.author), w.authorCtx, article.id, [ids.neraca], 't');

      expect((await s.marketplaceArticles.findOne(article.id)).data.concepts.map((concept) => concept.id)).toEqual([ids.neraca]);
      const [entry] = await audit(article.id, 'ARTICLE_CONCEPTS_UPDATED');
      expect(entry).toMatchObject({ actorId: w.author, before: { conceptIds: [ids.jurnal, ids.neraca].sort() }, after: { conceptIds: [ids.neraca] } });
    });

    it('lists published articles with waiting tags in the queue filter and counts them', async () => {
      const w = await creator();
      const waiting = await publishedArticle(w, undefined);
      const clean = await publishedArticle(w, [ids.jurnal]);
      await s.articleAuthoring.setConcepts(teacher(w.author), w.authorCtx, waiting.id, [ids.kas], 't');

      const queue = await s.articleModeration.queue(admin(w.reviewer), { page: 1, limit: 50, status: 'PUBLISHED', tenantId: w.tenant, pendingTags: 'true' } as never);
      const all = await s.articleModeration.queue(admin(w.reviewer), { page: 1, limit: 50, status: 'PUBLISHED', tenantId: w.tenant } as never);

      expect(queue.data.data.map((row) => [row.id, row.pendingConceptTags])).toEqual([[waiting.id, 1]]);
      expect(all.data.data.map((row) => [row.id, row.pendingConceptTags]).sort()).toEqual([[waiting.id, 1], [clean.id, 0]].sort());
    });

    it('lets tags change while the article waits for review and approves them with the article', async () => {
      const w = await creator();
      const created = (await s.articleAuthoring.create(teacher(w.author), w.authorCtx, { title: 'Dalam antrean', accessType: 'FREE', content: 'x' } as never, 't')).data;
      await s.articleAuthoring.submitReview(teacher(w.author), w.authorCtx, created.id, 't');

      await s.articleAuthoring.setConcepts(teacher(w.author), w.authorCtx, created.id, [ids.jurnal], 't');
      expect(await linksOf(created.id)).toEqual([{ conceptId: ids.jurnal, status: 'PROPOSED' }]);
      await s.articleModeration.approve(admin(w.reviewer), created.id, 'ok', 't');

      expect(await linksOf(created.id)).toEqual([{ conceptId: ids.jurnal, status: 'APPROVED' }]);
    });

    it('refuses tags on suspended or archived content and a decision on content that is not published', async () => {
      const w = await creator();
      const suspended = await publishedArticle(w, undefined);
      await s.articleModeration.suspend(admin(w.reviewer), suspended.id, 'pelanggaran', 't');
      const draft = (await s.articleAuthoring.create(teacher(w.author), w.authorCtx, { title: 'Masih draf', accessType: 'FREE', content: 'x', conceptIds: [ids.jurnal] } as never, 't')).data;

      await expect(s.articleAuthoring.setConcepts(teacher(w.author), w.authorCtx, suspended.id, [ids.jurnal], 't')).rejects.toMatchObject({ statusCode: 409, code: 'CONTENT_LOCKED' });
      await expect(s.articleModeration.approveConcepts(admin(w.reviewer), draft.id, undefined, 't')).rejects.toMatchObject({ statusCode: 409 });
      await expect(s.articleModeration.rejectConcepts(admin(w.reviewer), suspended.id, 'alasan', 't')).rejects.toMatchObject({ statusCode: 409 });
      expect(await linksOf(draft.id)).toEqual([{ conceptId: ids.jurnal, status: 'PROPOSED' }]);
    });

    it('stays within the tenant and the author rule, and validates the concepts like any other edit', async () => {
      const w = await creator();
      const stranger = await creator();
      const article = await publishedArticle(w, undefined);

      await expect(s.articleAuthoring.setConcepts(teacher(stranger.author), stranger.authorCtx, article.id, [ids.jurnal], 't')).rejects.toMatchObject({ statusCode: 404 });
      await expect(s.articleAuthoring.setConcepts(teacher(w.author), w.authorCtx, article.id, ['tidak-ada'], 't')).rejects.toMatchObject({ statusCode: 422 });
      await expect(s.articleAuthoring.setConcepts(teacher(w.author), w.authorCtx, article.id, [ids.a, ids.b, ids.c, ids.d, ids.e, ids.f], 't')).rejects.toMatchObject({ statusCode: 422 });
      expect(await linksOf(article.id)).toHaveLength(0);
      await expect(s.articleModeration.approveConcepts(teacher(w.author), article.id, undefined, 't')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('works the same way for a published class', async () => {
      const w = await creator();
      const cls = await publishedClass(w);

      const saved = await s.classAuthoring.setConcepts(teacher(w.author), w.authorCtx, cls.id, [ids.jurnal], 't');
      expect(saved.data.conceptLinks.map((link) => link.status)).toEqual(['PROPOSED']);
      expect((await s.marketplaceClasses.findOne(cls.id)).data.concepts).toEqual([]);
      expect((await s.classModeration.findOne(admin(w.reviewer), cls.id)).data).toMatchObject({ pendingConceptTags: 1 });

      expect((await s.classModeration.approveConcepts(admin(w.reviewer), cls.id, undefined, 't')).data.changed).toBe(true);
      expect((await s.marketplaceClasses.findOne(cls.id)).data.concepts.map((concept) => concept.id)).toEqual([ids.jurnal]);

      await s.classAuthoring.setConcepts(teacher(w.author), w.authorCtx, cls.id, [ids.jurnal, ids.kas], 't');
      const rejected = await s.classModeration.rejectConcepts(admin(w.reviewer), cls.id, 'Tidak dibahas', 't');
      expect(rejected.data).toMatchObject({ changed: true, conceptIds: [ids.kas] });
      expect((await s.prisma.productConceptLink.findMany({ where: { classProductId: cls.id }, select: { conceptId: true, status: true } })).map((row) => row.status)).toEqual(['APPROVED']);
    });
  });
});
