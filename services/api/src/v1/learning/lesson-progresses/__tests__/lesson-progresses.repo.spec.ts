import { Prisma } from '@prisma/client';
import { LessonProgressesRepo } from '../lesson-progresses.repo';

const uniqueViolation = () => new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' });

const build = (create: jest.Mock, existing: unknown = null) => {
  const prisma = {
    lessonProgress: {
      create,
      createMany: jest.fn(),
      findFirst: jest.fn().mockResolvedValue(existing),
    },
  };
  return { repo: new LessonProgressesRepo(prisma as never), prisma };
};

describe('LessonProgressesRepo.create', () => {
  const values = { userId: 'user-1', lessonId: 'lesson-1' };

  it('stores a new progress row', async () => {
    const stored = { id: 'p1', ...values };
    const { repo, prisma } = build(jest.fn().mockResolvedValue(stored));

    expect(await repo.create(values)).toBe(stored);
    expect(prisma.lessonProgress.findFirst).not.toHaveBeenCalled();
  });

  it('returns the row that already exists when two requests race for the same learner and lesson', async () => {
    const existing = { id: 'p-existing', ...values };
    const { repo, prisma } = build(jest.fn().mockRejectedValue(uniqueViolation()), existing);

    expect(await repo.create(values)).toBe(existing);
    expect(prisma.lessonProgress.findFirst).toHaveBeenCalledWith({ where: { userId: 'user-1', lessonId: 'lesson-1' } });
  });

  it('does not hide a unique violation when no row can be found afterwards', async () => {
    const { repo } = build(jest.fn().mockRejectedValue(uniqueViolation()), null);

    await expect(repo.create(values)).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
  });

  it('does not swallow any other database error', async () => {
    const failure = new Error('connection lost');
    const { repo, prisma } = build(jest.fn().mockRejectedValue(failure));

    await expect(repo.create(values)).rejects.toBe(failure);
    expect(prisma.lessonProgress.findFirst).not.toHaveBeenCalled();
  });

  it('still rejects an invalid body before touching the database', async () => {
    const { repo, prisma } = build(jest.fn());

    await expect(repo.create({ userId: '', lessonId: 'lesson-1' } as never)).rejects.toBeDefined();
    expect(prisma.lessonProgress.create).not.toHaveBeenCalled();
  });
});
