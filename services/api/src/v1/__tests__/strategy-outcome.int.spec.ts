import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { QuizAttemptsService } from '@/v1/quiz/quiz-attempts/quiz-attempts.service';
import { QuizEvaluationService } from '@/v1/quiz/services/quiz-evaluation.service';
import { ConceptRegistryService } from '@/v1/learner-model/concepts/concept-registry.service';
import { LearnerEventsService } from '@/v1/learner-model/events/learner-events.service';
import { LearnerPolicyService } from '@/v1/learner-model/policy/learner-policy.service';
import { ACTION_TURN_TASK_TYPE, StrategyOutcomeService } from '@/v1/learner-model/strategy/strategy-outcome.service';
import { PrismaService } from '@/common/config/prisma/prisma.service';
import { REGISTRY_SUITE_LOCK, createPool, databaseUrl, describeDb, expectViolation, holdSuiteLock, insertUser, withRollback } from '@/test-utils/pg-fixtures';

describeDb('strategy outcomes follow the learner evidence (requires TEST_DATABASE_URL)', () => {
  let prisma: PrismaService;
  let pool: Pool;
  let service: QuizAttemptsService;
  let outcomes: StrategyOutcomeService;
  let releaseLock: () => Promise<void>;
  const ids = { concepts: [] as string[], topics: [] as string[], users: [] as string[] };

  const fixture = async () => {
    const concept = `so-${randomUUID().slice(0, 8)}`;
    await prisma.concept.create({ data: { id: concept, title: concept, level: 1, sortOrder: 1 } });
    ids.concepts.push(concept);
    const topic = await prisma.topic.create({
      data: {
        title: 'Strategy fixture',
        slug: `strategy-${randomUUID().slice(0, 8)}`,
        image: {},
        price: 0,
        subTopics: { create: [{ title: 'S', lessons: { create: [{ title: 'L' }] } }] },
      },
      include: { subTopics: { include: { lessons: true } } },
    });
    ids.topics.push(topic.id);
    const lesson = topic.subTopics[0].lessons[0];
    await prisma.conceptCurriculumLink.create({
      data: { id: `fixture:${randomUUID()}`, conceptId: concept, status: 'APPROVED', lessonId: lesson.id },
    });
    const quiz = await prisma.quiz.create({
      data: {
        title: 'Lesson quiz',
        lessonId: lesson.id,
        questions: {
          create: [
            { question: 'one', options: ['A', 'B'], correctAnswer: 'A', points: 1, sortOrder: 1 },
            { question: 'two', options: ['A', 'B'], correctAnswer: 'A', points: 1, sortOrder: 2 },
          ],
        },
      },
      include: { questions: true },
    });
    const user = await insertUser(pool);
    ids.users.push(user);
    return { concept, quiz, user };
  };

  const taughtEpisode = (userId: string, concept: string, strategy: string, createdAt = new Date(), taskType = 'tutor_agent') =>
    prisma.episode.create({
      data: {
        userId,
        taskType,
        inputPayload: {},
        retrievedChunks: {},
        retrievedMemory: {},
        strategy: { metadata: { teachingStrategy: strategy, strategyConceptId: concept, conceptIds: [concept] } },
        promptVersion: 'tutor-chat-builtin-3',
        modelName: 'test-model',
        response: 'jawaban',
        createdAt,
      },
    });

  const submit = async (userId: string, quiz: { id: string; questions: Array<{ id: string }> }, choices: string[]) => {
    const started = await service.startAttempt({ id: userId, role: 'STUDENT' }, { quizId: quiz.id });
    return service.submitAttempt({
      userId,
      attemptId: started.data.id,
      answers: Object.fromEntries(quiz.questions.map((q, i) => [q.id, choices[i]])),
    });
  };

  beforeAll(async () => {
    releaseLock = await holdSuiteLock(REGISTRY_SUITE_LOCK);
    process.env.DATABASE_URL = databaseUrl;
    prisma = new PrismaService();
    pool = createPool();
    outcomes = new StrategyOutcomeService(prisma, new LearnerPolicyService());
    service = new QuizAttemptsService(
      {} as never,
      prisma,
      undefined,
      undefined,
      new QuizEvaluationService(),
      new ConceptRegistryService(prisma),
      new LearnerEventsService(prisma),
      undefined,
      undefined,
      undefined,
      outcomes,
    );
  }, 120_000);

  afterAll(async () => {
    await prisma.leaderboardScore.deleteMany({ where: { userId: { in: ids.users } } });
    await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
    await prisma.topic.deleteMany({ where: { id: { in: ids.topics } } });
    await prisma.concept.deleteMany({ where: { id: { in: ids.concepts } } });
    await prisma.$disconnect();
    await pool.end();
    await releaseLock();
  });

  it('credits the strategy of the latest tutor turn on the concept when the next assessment lifts mastery', async () => {
    const { concept, quiz, user } = await fixture();
    const episode = await taughtEpisode(user, concept, 'WORKED_EXAMPLE');

    await submit(user, quiz, ['A', 'A']);

    const stored = await prisma.strategyOutcome.findMany({ where: { userId: user } });
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      conceptId: concept,
      strategy: 'WORKED_EXAMPLE',
      episodeId: episode.id,
      promptVersion: 'tutor-chat-builtin-3',
      scoreBefore: 0.5,
      success: true,
    });
    expect(stored[0].scoreAfter).toBeGreaterThan(0.5);
    expect(stored[0].eventKey).toMatch(/^assessment:.+:so-/);
  });

  it('does not let the turn that built the assessment take the credit from the turn that taught', async () => {
    const { concept, quiz, user } = await fixture();
    const taught = await taughtEpisode(user, concept, 'GUIDED_EXAMPLE', new Date(Date.now() - 60_000));
    await taughtEpisode(user, concept, 'PRACTICE', new Date(), ACTION_TURN_TASK_TYPE);

    await submit(user, quiz, ['A', 'A']);

    const stored = await prisma.strategyOutcome.findMany({ where: { userId: user } });
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ episodeId: taught.id, strategy: 'GUIDED_EXAMPLE', success: true });
  });

  it('leaves the assessment unattributed when only the turn that built it exists', async () => {
    const { concept, quiz, user } = await fixture();
    await taughtEpisode(user, concept, 'PRACTICE', new Date(), ACTION_TURN_TASK_TYPE);

    await submit(user, quiz, ['A', 'A']);

    expect(await prisma.strategyOutcome.count({ where: { userId: user } })).toBe(0);
  });

  it('records a failure when the assessment lowers mastery', async () => {
    const { concept, quiz, user } = await fixture();
    await taughtEpisode(user, concept, 'EXPLAIN');

    await submit(user, quiz, ['B', 'B']);

    const stored = await prisma.strategyOutcome.findFirstOrThrow({ where: { userId: user } });
    expect(stored.success).toBe(false);
    expect(stored.scoreDelta).toBeLessThan(0);
  });

  it('uses one tutor turn for one assessment and leaves the next assessment unattributed', async () => {
    const { concept, quiz, user } = await fixture();
    await taughtEpisode(user, concept, 'HINT');

    await submit(user, quiz, ['A', 'A']);
    await submit(user, quiz, ['A', 'A']);

    expect(await prisma.strategyOutcome.count({ where: { userId: user } })).toBe(1);
  });

  it('ignores a turn that taught another concept or happened more than a day ago', async () => {
    const { concept, quiz, user } = await fixture();
    await taughtEpisode(user, 'another-concept', 'HINT');
    await taughtEpisode(user, concept, 'HINT', new Date(Date.now() - 26 * 60 * 60 * 1000));

    await submit(user, quiz, ['A', 'A']);

    expect(await prisma.strategyOutcome.count({ where: { userId: user } })).toBe(0);
  });

  it('never credits one learner with the tutor turn of another', async () => {
    const { concept, quiz, user } = await fixture();
    const other = await insertUser(pool);
    ids.users.push(other);
    await taughtEpisode(other, concept, 'HINT');

    await submit(user, quiz, ['A', 'A']);

    expect(await prisma.strategyOutcome.count({ where: { userId: { in: [user, other] } } })).toBe(0);
  });

  it('feeds the evidence back into the summary of the learner', async () => {
    const { concept, quiz, user } = await fixture();
    await taughtEpisode(user, concept, 'SOCRATIC');
    await submit(user, quiz, ['A', 'A']);

    const summary = await outcomes.summary(user);

    expect(summary.totalAttempts).toBe(1);
    expect(summary.strategies.find((row) => row.strategy === 'SOCRATIC')).toMatchObject({ attempts: 1, successes: 1, successRate: 1 });
  });

  describe('database guarantees', () => {
    const insertOutcome = (userId: string, conceptId: string, episodeId: string, over: Record<string, unknown> = {}) => {
      const values = { strategy: 'HINT', eventKey: `k-${randomUUID()}`, before: 0.5, after: 0.6, delta: 0.1, success: true, ...over };
      return [
        `INSERT INTO "StrategyOutcome" (id, "userId", "conceptId", strategy, "episodeId", "eventKey", "promptVersion", "scoreBefore", "scoreAfter", "scoreDelta", success)
         VALUES ($1, $2, $3, $4, $5, $6, 'v', $7, $8, $9, $10)`,
        [randomUUID(), userId, conceptId, values.strategy, episodeId, values.eventKey, values.before, values.after, values.delta, values.success],
      ] as [string, unknown[]];
    };

    it('refuses an outcome whose success flag disagrees with its change', async () => {
      const { concept, user } = await fixture();
      const episode = await taughtEpisode(user, concept, 'HINT');

      await withRollback(pool, async (client) => {
        const error = await expectViolation(client, ...insertOutcome(user, concept, episode.id, { delta: 0.1, success: false }));
        expect(error.constraint).toBe('StrategyOutcome_success_means_improved');
      });
    });

    it('refuses an outcome whose change is not the difference of its scores', async () => {
      const { concept, user } = await fixture();
      const episode = await taughtEpisode(user, concept, 'HINT');

      await withRollback(pool, async (client) => {
        const error = await expectViolation(client, ...insertOutcome(user, concept, episode.id, { delta: 0.3 }));
        expect(error.constraint).toBe('StrategyOutcome_delta_matches_scores');
      });
    });

    it('is append-only', async () => {
      const { concept, quiz, user } = await fixture();
      await taughtEpisode(user, concept, 'HINT');
      await submit(user, quiz, ['A', 'A']);
      const stored = await prisma.strategyOutcome.findFirstOrThrow({ where: { userId: user } });

      await withRollback(pool, async (client) => {
        const error = await expectViolation(client, `UPDATE "StrategyOutcome" SET success = false WHERE id = $1`, [stored.id]);
        expect(error.message).toContain('append-only');
      });
    });
  });
});
