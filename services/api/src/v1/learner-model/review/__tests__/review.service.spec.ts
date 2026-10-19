import { REVIEW_LIST_LIMIT, ReviewService } from '../review.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-16T00:00:00.000Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS);

const mastery = (conceptId: string, overrides: Partial<{ score: number; evidenceCount: number; lastEventAt: Date }> = {}) => ({
  conceptId,
  score: 0.8,
  evidenceCount: 4,
  lastEventAt: daysAgo(20),
  concept: { title: `Title ${conceptId}`, level: 1, sortOrder: 1 },
  ...overrides,
});

interface Fixture {
  rows?: ReturnType<typeof mastery>[];
  links?: Array<{ conceptId: string; lessonId: string | null; subTopic: { lessons: Array<{ id: string }> } | null }>;
  userSteps?: Array<{ id: string; stepTemplateId: string | null; stepTemplate: { lessonId: string } | null }>;
}

const build = ({ rows = [], links = [], userSteps = [], reminders = true }: Fixture & { reminders?: boolean } = {}) => {
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue({ reviewReminders: reminders }), update: jest.fn().mockResolvedValue({}) },
    conceptMastery: { findMany: jest.fn().mockResolvedValue(rows) },
    conceptCurriculumLink: { findMany: jest.fn().mockResolvedValue(links) },
    userStep: { findMany: jest.fn().mockResolvedValue(userSteps) },
  };
  return { service: new ReviewService(prisma as never), prisma };
};

describe('ReviewService.queue', () => {
  it("reads only the learner's own concepts that have evidence", async () => {
    const { service, prisma } = build();

    await service.queue('user-1', NOW);

    expect(prisma.conceptMastery.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1', evidenceCount: { gt: 0 }, concept: { status: 'ACTIVE' } } }),
    );
  });

  it('answers an empty queue and no session for a learner without evidence', async () => {
    const { service, prisma } = build();

    const view = await service.queue('user-1', NOW);

    expect(view).toMatchObject({ policyVersion: 'review-v1', dueTotal: 0, due: [], upcoming: [] });
    expect(view.session).toMatchObject({ conceptIds: [], totalQuestions: 0, estimatedMinutes: 0 });
    expect(prisma.conceptCurriculumLink.findMany).not.toHaveBeenCalled();
  });

  it('lists what is due with titles and the forgetting figures, most forgotten first', async () => {
    const { service } = build({ rows: [mastery('b', { lastEventAt: daysAgo(10) }), mastery('a', { lastEventAt: daysAgo(40) }), mastery('fresh', { lastEventAt: daysAgo(0) })] });

    const view = await service.queue('user-1', NOW);

    expect(view.dueTotal).toBe(2);
    expect(view.due.map((entry) => entry.conceptId)).toEqual(['a', 'b']);
    expect(view.due[0]).toMatchObject({ title: 'Title a', kind: 'REVIEW', score: 0.8, evidenceCount: 4, daysSince: 40 });
    expect(view.due[0].retrievability).toBeLessThan(view.due[1].retrievability);
    expect(view.due[0].overdueDays).toBeGreaterThan(view.due[1].overdueDays);
  });

  it('marks a weak concept as one to learn again', async () => {
    const { service } = build({ rows: [mastery('weak', { score: 0.5, evidenceCount: 2 })] });

    const view = await service.queue('user-1', NOW);

    expect(view.due[0].kind).toBe('RELEARN');
  });

  it('finds the learner own step that teaches a due concept through a lesson link', async () => {
    const { service, prisma } = build({
      rows: [mastery('a')],
      links: [{ conceptId: 'a', lessonId: 'lesson-1', subTopic: null }],
      userSteps: [{ id: 'us-1', stepTemplateId: 'step-1', stepTemplate: { lessonId: 'lesson-1' } }],
    });

    const view = await service.queue('user-1', NOW);

    expect(prisma.userStep.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1', stepTemplate: { lessonId: { in: ['lesson-1'] } } } }),
    );
    expect(view.due[0].target).toEqual({ userStepId: 'us-1', stepTemplateId: 'step-1' });
    expect(view.session.conceptIds).toEqual(['a']);
  });

  it('reaches a concept linked to a whole sub-topic through the lessons of that sub-topic', async () => {
    const { service } = build({
      rows: [mastery('a')],
      links: [{ conceptId: 'a', lessonId: null, subTopic: { lessons: [{ id: 'lesson-7' }, { id: 'lesson-8' }] } }],
      userSteps: [{ id: 'us-8', stepTemplateId: 'step-8', stepTemplate: { lessonId: 'lesson-8' } }],
    });

    const view = await service.queue('user-1', NOW);

    expect(view.due[0].target).toEqual({ userStepId: 'us-8', stepTemplateId: 'step-8' });
  });

  it('keeps a concept with no reachable step in the list but out of the session', async () => {
    const { service } = build({
      rows: [mastery('a', { lastEventAt: daysAgo(30) }), mastery('b', { lastEventAt: daysAgo(10) })],
      links: [{ conceptId: 'b', lessonId: 'lesson-2', subTopic: null }],
      userSteps: [{ id: 'us-2', stepTemplateId: 'step-2', stepTemplate: { lessonId: 'lesson-2' } }],
    });

    const view = await service.queue('user-1', NOW);

    expect(view.due.map((entry) => [entry.conceptId, entry.target?.userStepId ?? null])).toEqual([
      ['a', null],
      ['b', 'us-2'],
    ]);
    expect(view.session.conceptIds).toEqual(['b']);
  });

  it('never links a concept to a step of a lesson that teaches another concept', async () => {
    const { service } = build({
      rows: [mastery('a')],
      links: [{ conceptId: 'a', lessonId: 'lesson-1', subTopic: null }],
      userSteps: [{ id: 'us-9', stepTemplateId: 'step-9', stepTemplate: { lessonId: 'lesson-9' } }],
    });

    const view = await service.queue('user-1', NOW);

    expect(view.due[0].target).toBeNull();
  });

  it('only follows approved links', async () => {
    const { service, prisma } = build({ rows: [mastery('a')] });

    await service.queue('user-1', NOW);

    expect(prisma.conceptCurriculumLink.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { conceptId: { in: ['a'] }, status: 'APPROVED' } }));
  });

  it('caps the list while reporting the true number due', async () => {
    const rows = Array.from({ length: REVIEW_LIST_LIMIT + 5 }, (_, index) => mastery(`c${String(index).padStart(2, '0')}`, { lastEventAt: daysAgo(30) }));
    const { service } = build({ rows });

    const view = await service.queue('user-1', NOW);

    expect(view.dueTotal).toBe(REVIEW_LIST_LIMIT + 5);
    expect(view.due).toHaveLength(REVIEW_LIST_LIMIT);
  });

  it('lists what comes due within a week without putting it in the session', async () => {
    const { service } = build({ rows: [mastery('soon', { evidenceCount: 3, score: 0.75, lastEventAt: daysAgo(1.5) })] });

    const view = await service.queue('user-1', NOW);

    expect(view.due).toEqual([]);
    expect(view.upcoming.map((entry) => entry.conceptId)).toEqual(['soon']);
    expect(view.session.conceptIds).toEqual([]);
  });
});

describe('ReviewService reminders', () => {
  it('tells the learner whether the daily reminder is on', async () => {
    expect((await build({ reminders: true }).service.queue('user-1', NOW)).reminders).toBe(true);
    expect((await build({ reminders: false }).service.queue('user-1', NOW)).reminders).toBe(false);
  });

  it('treats a learner row it cannot read as reminders on', async () => {
    const { service, prisma } = build();
    prisma.user.findUnique.mockResolvedValue(null);
    expect((await service.queue('user-1', NOW)).reminders).toBe(true);
  });

  it('turns the daily reminder on or off for the caller only', async () => {
    const { service, prisma } = build();

    await expect(service.setReminders('user-1', false)).resolves.toEqual({ reminders: false });

    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { reviewReminders: false } });
  });
});
