import { MAX_CONCEPTS, SOURCE_TEXT_LIMIT, TOTAL_TEXT_LIMIT, TopicSourcesService } from '../topic-sources.service';

const LESSON = '11111111-1111-4111-8111-111111111111';
const STEP = '22222222-2222-4222-8222-222222222222';

const lesson = (overrides: Record<string, unknown> = {}) => ({
  id: LESSON,
  title: 'Apa itu akuntansi',
  subTopic: {
    id: 'sub-1',
    title: 'Akuntansi Fundamentals',
    description: 'Pengantar konsep dasar akuntansi.',
    topic: { id: 'topic-1', title: 'Akuntansi Dasar', description: 'Urutan referensi pembelajaran akuntansi.' },
  },
  ...overrides,
});

const build = () => {
  const prisma: any = {
    userStep: { findUnique: jest.fn().mockResolvedValue({ userId: 'user-1', title: 'Pengantar', stepTemplate: { id: 'tpl-1', lessonId: LESSON } }) },
    lesson: { findUnique: jest.fn().mockResolvedValue(lesson()) },
    userTopic: { count: jest.fn().mockResolvedValue(1) },
    resource: { findMany: jest.fn().mockResolvedValue([]) },
    conceptCurriculumLink: { findMany: jest.fn().mockResolvedValue([]) },
  };
  return { prisma, service: new TopicSourcesService(prisma) };
};

describe('TopicSourcesService', () => {
  it('lists the resources first, then the concepts, then the sub-topic and the topic, each with its record id', async () => {
    const { prisma, service } = build();
    prisma.resource.findMany.mockResolvedValue([{ id: 'r-1', title: 'Buku Akuntansi Dasar', content: 'Aset adalah sumber daya ekonomi.' }]);
    prisma.conceptCurriculumLink.findMany.mockResolvedValue([{ concept: { id: 'c-1', title: 'Persamaan Akuntansi', description: 'Aset = Liabilitas + Ekuitas.' } }]);

    const { data } = await service.read('user-1', { lessonId: LESSON });

    expect(data.sources.map((s) => [s.refType, s.refId, s.title])).toEqual([
      ['RESOURCE', 'r-1', 'Buku Akuntansi Dasar'],
      ['CONCEPT', 'c-1', 'Konsep: Persamaan Akuntansi'],
      ['SUBTOPIC', 'sub-1', 'Sub-topik: Akuntansi Fundamentals'],
      ['TOPIC', 'topic-1', 'Topik: Akuntansi Dasar'],
    ]);
    expect(data.scope).toMatchObject({ topicTitle: 'Akuntansi Dasar', lessonTitle: 'Apa itu akuntansi', stepTitle: null });
  });

  it('never turns a record without text into a source, so nothing is cited for what says nothing', async () => {
    const { prisma, service } = build();
    prisma.lesson.findUnique.mockResolvedValue(lesson({ subTopic: { ...lesson().subTopic, description: null, topic: { ...lesson().subTopic.topic, description: '  ' } } }));
    prisma.resource.findMany.mockResolvedValue([{ id: 'r-1', title: 'Kosong', content: '   ' }]);
    prisma.conceptCurriculumLink.findMany.mockResolvedValue([{ concept: { id: 'c-1', title: 'Tanpa deskripsi', description: null } }]);

    const { data } = await service.read('user-1', { lessonId: LESSON });

    expect(data.sources).toEqual([]);
  });

  it('keeps a concept once even when it is linked to the lesson and to its sub-topic, and caps the number of concepts', async () => {
    const { prisma, service } = build();
    const link = (id: string) => ({ concept: { id, title: id, description: `Deskripsi ${id}` } });
    prisma.conceptCurriculumLink.findMany.mockResolvedValue([link('c1'), link('c1'), ...Array.from({ length: 20 }, (_, i) => link(`d${i}`))]);

    const { data } = await service.read('user-1', { lessonId: LESSON });

    const concepts = data.sources.filter((s) => s.refType === 'CONCEPT');
    expect(new Set(concepts.map((s) => s.refId)).size).toBe(concepts.length);
    expect(concepts).toHaveLength(MAX_CONCEPTS);
  });

  it('cuts one long text and stops adding sources past the total budget', async () => {
    const { prisma, service } = build();
    prisma.resource.findMany.mockResolvedValue(
      Array.from({ length: 6 }, (_, i) => ({ id: `r-${i}`, title: `Sumber ${i}`, content: 'x'.repeat(SOURCE_TEXT_LIMIT * 2) })),
    );

    const { data } = await service.read('user-1', { lessonId: LESSON });

    expect(data.sources.every((s) => s.text.length <= SOURCE_TEXT_LIMIT)).toBe(true);
    expect(data.sources.reduce((sum, s) => sum + s.text.length, 0)).toBeLessThanOrEqual(TOTAL_TEXT_LIMIT);
  });

  it('only reads approved links of active concepts and the resources of this lesson, its sub-topic and its topic', async () => {
    const { prisma, service } = build();

    await service.read('user-1', { lessonId: LESSON });

    expect(prisma.conceptCurriculumLink.findMany.mock.calls[0][0].where).toMatchObject({ status: 'APPROVED', concept: { status: 'ACTIVE' } });
    expect(prisma.resource.findMany.mock.calls[0][0].where.OR).toEqual([{ lessonId: LESSON }, { subTopicId: 'sub-1' }, { topicId: 'topic-1' }, { step: { lessonId: LESSON } }]);
  });

  it('refuses a learner who has not unlocked the topic', async () => {
    const { prisma, service } = build();
    prisma.userTopic.count.mockResolvedValue(0);

    await expect(service.read('user-1', { lessonId: LESSON })).rejects.toMatchObject({ statusCode: 403, code: 'ENTITLEMENT_REQUIRED' });
    expect(prisma.resource.findMany).not.toHaveBeenCalled();
  });

  it('finds the lesson through the step and says which step it is', async () => {
    const { prisma, service } = build();

    const { data } = await service.read('user-1', { userStepId: STEP });

    expect(prisma.lesson.findUnique.mock.calls[0][0].where).toEqual({ id: LESSON });
    expect(data.scope.stepTitle).toBe('Pengantar');
  });

  it("answers 404 for the step of another learner and for a lesson that does not exist", async () => {
    const { prisma, service } = build();
    prisma.userStep.findUnique.mockResolvedValue({ userId: 'someone-else', title: 'x', stepTemplate: { id: 't', lessonId: LESSON } });
    await expect(service.read('user-1', { userStepId: STEP })).rejects.toMatchObject({ statusCode: 404 });

    prisma.lesson.findUnique.mockResolvedValue(null);
    await expect(service.read('user-1', { lessonId: LESSON })).rejects.toMatchObject({ statusCode: 404 });
  });

  it('needs a lesson or a step', async () => {
    const { service } = build();

    await expect(service.read('user-1', {})).rejects.toMatchObject({ statusCode: 422 });
  });
});
