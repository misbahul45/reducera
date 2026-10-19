import { PersonalityQuizzesService } from '../personality-quizzes.service';

const questions = [
  { question: 'Mana yang akun aset?', type: 'multiple_choice', options: ['Kas', 'Utang'], answer: 'Kas' },
  { question: 'Mana yang akun kewajiban?', type: 'multiple_choice', options: ['Kas', 'Utang usaha'], answer: 'Utang usaha' },
];

const storedQuiz = {
  id: 'q-1',
  userId: 'u-1',
  lessonId: 'l-1',
  questions,
  takenAt: null,
  lesson: { subTopic: { topicId: 't-1' } },
};

const answers = [
  { question: 'Mana yang akun aset?', userAnswer: 'Kas' },
  { question: 'Mana yang akun kewajiban?', userAnswer: 'Utang usaha' },
];

const data = { userId: 'u-1', learningStyleId: 'ls-1', quizId: 'q-1' };

describe('PersonalityQuizzesService.submitAttempt', () => {
  let repo: Record<'findForSubmission' | 'ownsLearningStyle' | 'claimAttempt' | 'releaseAttempt' | 'findOne', jest.Mock>;
  let queue: { addUserStepsJob: jest.Mock };
  let service: PersonalityQuizzesService;

  beforeEach(() => {
    repo = {
      findForSubmission: jest.fn().mockResolvedValue(storedQuiz),
      ownsLearningStyle: jest.fn().mockResolvedValue(true),
      claimAttempt: jest.fn().mockResolvedValue(true),
      releaseAttempt: jest.fn().mockResolvedValue(undefined),
      findOne: jest.fn().mockResolvedValue({ id: 'q-1', result: { level: 'expert' } }),
    };
    queue = { addUserStepsJob: jest.fn().mockResolvedValue(undefined) };
    service = new PersonalityQuizzesService(repo as any, queue as any);
  });

  describe('the generation job', () => {
    it('carries the lesson and topic of the stored quiz, never the ones the client sent', async () => {
      await service.submitAttempt({ ...data, topicId: 'other-topic', lessonId: 'other-lesson' } as any, answers);

      expect(queue.addUserStepsJob).toHaveBeenCalledTimes(1);
      expect(queue.addUserStepsJob).toHaveBeenCalledWith({
        userId: 'u-1',
        topicId: 't-1',
        lessonId: 'l-1',
        learningStyleId: 'ls-1',
        quizId: 'q-1',
      });
    });

    it('carries no credential', async () => {
      await service.submitAttempt({ ...data, token: 'jwt-value' } as any, answers);

      expect(JSON.stringify(queue.addUserStepsJob.mock.calls)).not.toContain('jwt-value');
    });

    it('is queued after the attempt is stored', async () => {
      const order: string[] = [];
      repo.claimAttempt.mockImplementation(async () => (order.push('claim'), true));
      queue.addUserStepsJob.mockImplementation(async () => void order.push('queue'));

      await service.submitAttempt(data, answers);

      expect(order).toEqual(['claim', 'queue']);
    });

    it('gives the claim back when the job cannot be queued, so the learner can try again', async () => {
      queue.addUserStepsJob.mockRejectedValue(new Error('redis down'));

      await expect(service.submitAttempt(data, answers)).rejects.toThrow('redis down');

      expect(repo.releaseAttempt).toHaveBeenCalledWith('q-1');
    });
  });

  describe('grading', () => {
    it('stores the result computed from the stored key and the key on the attempt', async () => {
      await service.submitAttempt(data, [answers[0], { question: answers[1].question, userAnswer: 'Salah' }]);

      const stored = repo.claimAttempt.mock.calls[0][1];
      expect(stored.result.level).toBe('beginner');
      expect(stored.result.scores).toEqual({ Kas: 10, 'Utang usaha': 0 });
      expect(stored.userAttempt[1]).toEqual({ question: 'Mana yang akun kewajiban?', userAnswer: 'Salah', answer: 'Utang usaha' });
      expect(stored.takenAt).toBeInstanceOf(Date);
    });

    it('ignores an answer key that the client put in the attempt', async () => {
      const forged = answers.map((item) => ({ ...item, userAnswer: 'Salah', answer: 'Salah' }));

      await service.submitAttempt(data, forged as any);

      expect(repo.claimAttempt.mock.calls[0][1].result.level).toBe('beginner');
    });

    it('does not store an empty attempt as the best level', async () => {
      await expect(service.submitAttempt(data, [])).rejects.toMatchObject({ statusCode: 400 });

      expect(repo.claimAttempt).not.toHaveBeenCalled();
      expect(queue.addUserStepsJob).not.toHaveBeenCalled();
    });

    it('answers with the stored row', async () => {
      const res = await service.submitAttempt(data, answers);

      expect(res.data).toEqual({ id: 'q-1', result: { level: 'expert' } });
    });
  });

  describe('guards', () => {
    it('does not queue anything when the quiz does not exist', async () => {
      repo.findForSubmission.mockResolvedValue(null);

      await expect(service.submitAttempt(data, answers)).rejects.toMatchObject({ statusCode: 404 });

      expect(queue.addUserStepsJob).not.toHaveBeenCalled();
    });

    it("answers 404 for another learner's quiz", async () => {
      await expect(service.submitAttempt({ ...data, userId: 'u-2' }, answers)).rejects.toMatchObject({ statusCode: 404 });

      expect(repo.claimAttempt).not.toHaveBeenCalled();
    });

    it('answers 409 when the quiz was already submitted, and queues nothing', async () => {
      repo.findForSubmission.mockResolvedValue({ ...storedQuiz, takenAt: new Date() });

      await expect(service.submitAttempt(data, answers)).rejects.toMatchObject({ statusCode: 409, code: 'INVALID_STATE_TRANSITION' });

      expect(repo.claimAttempt).not.toHaveBeenCalled();
      expect(queue.addUserStepsJob).not.toHaveBeenCalled();
    });

    it('answers 409 and queues nothing when a parallel request wins the claim', async () => {
      repo.claimAttempt.mockResolvedValue(false);

      await expect(service.submitAttempt(data, answers)).rejects.toMatchObject({ statusCode: 409 });

      expect(queue.addUserStepsJob).not.toHaveBeenCalled();
      expect(repo.releaseAttempt).not.toHaveBeenCalled();
    });

    it('answers 403 when the learning style does not belong to the learner for this topic', async () => {
      repo.ownsLearningStyle.mockResolvedValue(false);

      await expect(service.submitAttempt(data, answers)).rejects.toMatchObject({ statusCode: 403, code: 'ENTITLEMENT_REQUIRED' });

      expect(repo.ownsLearningStyle).toHaveBeenCalledWith('u-1', 't-1', 'ls-1');
      expect(repo.claimAttempt).not.toHaveBeenCalled();
      expect(queue.addUserStepsJob).not.toHaveBeenCalled();
    });

    it('rejects a missing learning style before saving anything', async () => {
      await expect(service.submitAttempt({ ...data, learningStyleId: undefined } as any, answers)).rejects.toThrow();

      expect(repo.claimAttempt).not.toHaveBeenCalled();
      expect(queue.addUserStepsJob).not.toHaveBeenCalled();
    });

    it('answers 422 when the lesson of the quiz has no topic', async () => {
      repo.findForSubmission.mockResolvedValue({ ...storedQuiz, lesson: null });

      await expect(service.submitAttempt(data, answers)).rejects.toMatchObject({ statusCode: 422 });

      expect(queue.addUserStepsJob).not.toHaveBeenCalled();
    });
  });
});
