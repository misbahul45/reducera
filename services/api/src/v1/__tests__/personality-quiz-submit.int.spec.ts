import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { PrismaService } from '@/common/config/prisma/prisma.service';
import { createPool, databaseUrl, describeDb, insertTopic, insertUser } from '@/test-utils/pg-fixtures';
import { PersonalityQuizzesRepo } from '@/v1/learning/personality-quizzes/personality-quizzes.repo';
import { PersonalityQuizzesService } from '@/v1/learning/personality-quizzes/personality-quizzes.service';

const questions = [
  { question: 'Mana yang akun aset?', type: 'multiple_choice', difficulty: 'easy', options: ['Kas', 'Utang'], answer: 'Kas' },
  { question: 'Mana yang akun kewajiban?', type: 'multiple_choice', difficulty: 'easy', options: ['Kas', 'Utang usaha'], answer: 'Utang usaha' },
];

const perfect = [
  { question: questions[0]!.question, userAnswer: 'Kas' },
  { question: questions[1]!.question, userAnswer: 'Utang usaha' },
];

describeDb('placement quiz submission on a real database (requires TEST_DATABASE_URL)', () => {
  let pool: Pool;
  let prisma: PrismaService;
  let repo: PersonalityQuizzesRepo;
  let queued: Record<string, unknown>[];
  let failQueue: boolean;
  let service: PersonalityQuizzesService;

  beforeAll(() => {
    process.env.DATABASE_URL = databaseUrl;
    pool = createPool();
    prisma = new PrismaService();
    repo = new PersonalityQuizzesRepo(prisma, undefined as never);
  });

  beforeEach(() => {
    queued = [];
    failQueue = false;
    const queue = {
      addUserStepsJob: async (job: Record<string, unknown>) => {
        if (failQueue) throw new Error('redis down');
        queued.push(job);
      },
    };
    service = new PersonalityQuizzesService(repo, queue as never);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await pool.end();
  });

  const lesson = async () => {
    const topicId = await insertTopic(pool, 0);
    const subTopicId = randomUUID();
    const lessonId = randomUUID();
    await pool.query(`INSERT INTO "SubTopic" (id, title, "topicId", "updatedAt") VALUES ($1, 'Bagian uji', $2, now())`, [subTopicId, topicId]);
    await pool.query(`INSERT INTO "Lesson" (id, title, "subTopicId", "sortOrder", "updatedAt") VALUES ($1, 'Pelajaran uji', $2, 0, now())`, [lessonId, subTopicId]);
    return { topicId, lessonId };
  };

  const enrol = async (userId: string, topicId: string) => {
    const userTopic = await prisma.userTopic.create({ data: { userId, topicId } });
    const style = await prisma.learningStyleProfile.create({ data: { userTopicId: userTopic.id } });
    return style.id;
  };

  const scenario = async () => {
    const { topicId, lessonId } = await lesson();
    const userId = await insertUser(pool);
    const learningStyleId = await enrol(userId, topicId);
    const quiz = await prisma.personalityQuiz.create({ data: { userId, lessonId, title: 'Kuis uji', questions } });
    return { topicId, lessonId, userId, learningStyleId, quizId: quiz.id };
  };

  it('grades from the stored key, stores the attempt once and queues the job with ids read from the database', async () => {
    const { topicId, lessonId, userId, learningStyleId, quizId } = await scenario();

    await service.submitAttempt({ userId, learningStyleId, quizId }, perfect);

    const row = await prisma.personalityQuiz.findUniqueOrThrow({ where: { id: quizId } });
    expect(row.takenAt).toBeInstanceOf(Date);
    expect(row.result).toEqual({ level: 'expert', scores: { Kas: 10, 'Utang usaha': 10 } });
    expect(row.userAttempt).toEqual([
      { ...perfect[0], answer: 'Kas' },
      { ...perfect[1], answer: 'Utang usaha' },
    ]);
    expect(queued).toEqual([{ userId, topicId, lessonId, learningStyleId, quizId }]);
  });

  it('lets exactly one of two parallel submissions through and queues one job', async () => {
    const { userId, learningStyleId, quizId } = await scenario();

    const outcomes = await Promise.allSettled([
      service.submitAttempt({ userId, learningStyleId, quizId }, perfect),
      service.submitAttempt({ userId, learningStyleId, quizId }, perfect),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    const rejected = outcomes.find((outcome) => outcome.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ statusCode: 409, code: 'INVALID_STATE_TRANSITION' });
    expect(queued).toHaveLength(1);
  });

  it('answers 409 to a second submission after the first one finished', async () => {
    const { userId, learningStyleId, quizId } = await scenario();
    await service.submitAttempt({ userId, learningStyleId, quizId }, perfect);

    await expect(service.submitAttempt({ userId, learningStyleId, quizId }, perfect)).rejects.toMatchObject({ statusCode: 409 });

    expect(queued).toHaveLength(1);
  });

  it('gives the claim back when the queue is down, and a later submission succeeds', async () => {
    const { userId, learningStyleId, quizId } = await scenario();
    failQueue = true;

    await expect(service.submitAttempt({ userId, learningStyleId, quizId }, perfect)).rejects.toThrow('redis down');

    const released = await prisma.personalityQuiz.findUniqueOrThrow({ where: { id: quizId } });
    expect(released.takenAt).toBeNull();
    expect(released.result).toBeNull();
    expect(released.userAttempt).toBeNull();

    failQueue = false;
    await service.submitAttempt({ userId, learningStyleId, quizId }, perfect);
    expect(queued).toHaveLength(1);
  });

  it('refuses a learning style that belongs to another learner', async () => {
    const { topicId, userId, quizId } = await scenario();
    const stranger = await insertUser(pool);
    const strangerStyle = await enrol(stranger, topicId);

    await expect(service.submitAttempt({ userId, learningStyleId: strangerStyle, quizId }, perfect)).rejects.toMatchObject({
      statusCode: 403,
      code: 'ENTITLEMENT_REQUIRED',
    });

    const row = await prisma.personalityQuiz.findUniqueOrThrow({ where: { id: quizId } });
    expect(row.takenAt).toBeNull();
    expect(queued).toHaveLength(0);
  });

  it('refuses a learning style of the same learner taken for another topic', async () => {
    const { userId, quizId } = await scenario();
    const otherTopic = await insertTopic(pool, 0);
    const otherStyle = await enrol(userId, otherTopic);

    await expect(service.submitAttempt({ userId, learningStyleId: otherStyle, quizId }, perfect)).rejects.toMatchObject({ statusCode: 403 });

    expect(queued).toHaveLength(0);
  });

  it("answers 404 for another learner's quiz", async () => {
    const { learningStyleId, quizId } = await scenario();
    const stranger = await insertUser(pool);

    await expect(service.submitAttempt({ userId: stranger, learningStyleId, quizId }, perfect)).rejects.toMatchObject({ statusCode: 404 });

    expect(queued).toHaveLength(0);
  });
});
