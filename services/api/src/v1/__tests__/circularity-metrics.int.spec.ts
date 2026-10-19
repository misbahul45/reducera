import { randomUUID } from 'crypto';
import { Role } from '@prisma/client';
import { Pool } from 'pg';
import { AppError } from '@/common/lib/error';
import { CircularityMetricsService } from '@/v1/circularity/circularity-metrics.service';
import { CircularityReport, MetricResult, ReuseProductValue } from '@/v1/circularity/circularity-metrics';
import { ConceptRegistryService } from '@/v1/learner-model/concepts/concept-registry.service';
import { LearnerEventsService } from '@/v1/learner-model/events/learner-events.service';
import { AssessmentPayload } from '@/v1/learner-model/mastery/assessment-payload';
import { buildCommerceStack, CommerceStack } from '@/test-utils/commerce-harness';
import { REGISTRY_SUITE_LOCK, createPool, databaseUrl, describeDb, holdSuiteLock, insertMembership, insertPublishedClass, insertTenant, insertUser } from '@/test-utils/pg-fixtures';

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const REPORT_TIME = new Date('2031-03-15T00:00:00.000Z');
const ACCESS_START = new Date(REPORT_TIME.getTime() - 2 * DAY_MS);
const ASSESSED_AT = new Date(REPORT_TIME.getTime() - DAY_MS);
const admin = { id: 'circularity-admin', role: Role.ADMIN };

const strong = (): AssessmentPayload => ({ attemptId: randomUUID(), quizId: 'quiz-circularity', score: 1, items: 5, hintsUsed: 0, share: 1, attemptNumber: 1 });

const metricOf = (report: CircularityReport, id: string) => report.metrics.find((metric) => metric.id === id) as MetricResult<any>;

describeDb('circularity metrics over a real database (requires TEST_DATABASE_URL)', () => {
  let pool: Pool;
  let s: CommerceStack;
  let events: LearnerEventsService;
  let service: CircularityMetricsService;
  let releaseLock: () => Promise<void>;

  const tag = randomUUID().slice(0, 8);
  const ids = { first: `cm-${tag}-akun`, second: `cm-${tag}-jurnal` };
  const people: string[] = [];
  const topics: string[] = [];
  const reportTime = () => REPORT_TIME;

  const newPerson = async (role: 'STUDENT' | 'TEACHER', demo: boolean) => {
    const id = await insertUser(pool, role);
    if (demo) await pool.query(`UPDATE "User" SET email = $2 WHERE id = $1`, [id, `${id}@reducera.local`]);
    people.push(id);
    return id;
  };

  beforeAll(async () => {
    releaseLock = await holdSuiteLock(REGISTRY_SUITE_LOCK);
    process.env.DATABASE_URL = databaseUrl;
    pool = createPool();
    s = buildCommerceStack();
    const registry = new ConceptRegistryService(s.prisma);
    events = new LearnerEventsService(s.prisma);
    service = new CircularityMetricsService(s.prisma, s.policy, registry);
    for (const [index, id] of Object.values(ids).entries()) {
      await s.prisma.concept.create({ data: { id, title: `Konsep ${id}`, level: 1, sortOrder: 900 + index } });
    }
  }, 120_000);

  afterAll(async () => {
    try {
      await s.prisma.productConceptLink.deleteMany({ where: { conceptId: { in: Object.values(ids) } } });
      await s.prisma.entitlement.deleteMany({ where: { userId: { in: people } } });
      await s.prisma.user.deleteMany({ where: { id: { in: people }, role: Role.STUDENT } });
      await s.prisma.topic.deleteMany({ where: { id: { in: topics } } });
      await s.prisma.concept.deleteMany({ where: { id: { in: Object.values(ids) } } });
    } finally {
      await s.prisma.$disconnect();
      await pool.end();
      await releaseLock();
    }
  });

  it('counts demo-account evidence apart, reads reuse and conversion from real rows and keeps the formulas', async () => {
    const before = (await service.report(admin, {}, reportTime())).data;

    const topic = await s.prisma.topic.create({
      data: {
        title: 'Circularity course',
        slug: `circularity-${tag}`,
        image: {},
        price: 0,
        subTopics: { create: [{ title: 'Dasar', lessons: { create: [{ title: 'Akun' }, { title: 'Jurnal' }] } }] },
      },
      include: { subTopics: { include: { lessons: true } } },
    });
    topics.push(topic.id);
    const [akun, jurnal] = topic.subTopics[0].lessons;
    await s.prisma.conceptCurriculumLink.create({ data: { id: `fixture:${randomUUID()}`, conceptId: ids.first, status: 'APPROVED', lessonId: akun.id } });
    await s.prisma.conceptCurriculumLink.create({ data: { id: `fixture:${randomUUID()}`, conceptId: ids.second, status: 'APPROVED', lessonId: jurnal.id } });

    const creator = await newPerson('TEACHER', true);
    const tenant = await insertTenant(pool, creator);
    await insertMembership(pool, tenant, creator, 'OWNER');
    const classId = await insertPublishedClass(pool, tenant, creator, '50000');
    await s.prisma.productConceptLink.create({ data: { classProductId: classId, conceptId: ids.first, status: 'APPROVED', proposedById: creator } });

    const first = await newPerson('STUDENT', true);
    const second = await newPerson('STUDENT', true);
    const organic = await newPerson('STUDENT', false);
    for (const learner of [first, second, organic]) {
      await s.prisma.entitlement.create({ data: { userId: learner, tenantId: tenant, resourceType: 'CLASS', classId, status: 'ACTIVE', startsAt: ACCESS_START, createdAt: ACCESS_START } });
    }
    for (const learner of [first, second, organic]) {
      await events.append({ userId: learner, conceptId: ids.first, idempotencyKey: randomUUID(), payload: strong(), occurredAt: ASSESSED_AT });
    }

    const expert = await newPerson('STUDENT', true);
    for (const conceptId of Object.values(ids)) {
      for (let round = 0; round < 12; round += 1) {
        await events.append({ userId: expert, conceptId, idempotencyKey: randomUUID(), payload: strong(), occurredAt: new Date(ASSESSED_AT.getTime() - (60 - round) * MINUTE_MS) });
      }
    }
    await s.prisma.teacherApplication.create({ data: { userId: expert, fullName: 'Expert Learner', status: 'APPROVED' } });

    const report = (await service.report(admin, {}, reportTime())).data;

    expect(report.definitionVersion).toBe('circularity-v1');
    expect(report.demoAccountDomain).toBe('reducera.local');
    expect(report.metrics.map((metric) => metric.id)).toEqual(['MASTERY_CHANGE', 'REVIEW_OUTCOME', 'KNOWLEDGE_REUSE', 'CREATOR_CONVERSION', 'PROMPT_EVIDENCE']);
    expect(report.window.to.getTime() - report.window.from.getTime()).toBe(30 * 24 * 60 * MINUTE_MS);

    const change = metricOf(report, 'MASTERY_CHANGE');
    const changeBefore = metricOf(before, 'MASTERY_CHANGE');
    expect(change.demo.n - changeBefore.demo.n).toBe(2 + 24);
    expect(change.demo.learners - changeBefore.demo.learners).toBe(3);
    expect(change.organic.n - changeBefore.organic.n).toBe(1);
    expect(change.demoValue.shareImproved).toBeGreaterThan(0);

    const reuse = metricOf(report, 'KNOWLEDGE_REUSE');
    const reuseBefore = metricOf(before, 'KNOWLEDGE_REUSE');
    expect(reuse.demo.n - reuseBefore.demo.n).toBe(1);
    expect(reuse.organic.n).toBe(reuseBefore.organic.n);
    const ours = (reuse.demoValue.products as ReuseProductValue[]).find((product) => product.id === classId);
    expect(ours).toMatchObject({ kind: 'class', holders: 2, qualifyingLearners: 2 });
    expect(reuse.demoValue.numerator).toBeGreaterThanOrEqual(1);

    const conversion = metricOf(report, 'CREATOR_CONVERSION');
    const ourTopic = conversion.demoValue.topics.find((item: { topicId: string }) => item.topicId === topic.id);
    expect(ourTopic).toMatchObject({ concepts: 2, eligible: 1, converted: 1 });
    expect(conversion.demo.n - metricOf(before, 'CREATOR_CONVERSION').demo.n).toBe(1);

    for (const metric of report.metrics.filter((item) => item.id !== 'PROMPT_EVIDENCE')) {
      if (metric.state === 'NOT_ENOUGH_EVIDENCE') expect(metric.value).toBeNull();
    }
    expect(metricOf(report, 'PROMPT_EVIDENCE').value).toMatchObject({ drafts: expect.any(Object), benchmarkRuns: expect.any(Object) });
  });

  it('refuses a window that ends before it starts and anyone who is not an administrator', async () => {
    const now = new Date();

    await expect(service.report(admin, { from: now, to: new Date(now.getTime() - MINUTE_MS) }, now)).rejects.toBeInstanceOf(AppError);
    await expect(service.report({ id: 'learner', role: Role.STUDENT }, {}, now)).rejects.toThrow();
  });
});
