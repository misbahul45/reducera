import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { LearnerModelController } from '../learner-model.controller';
import { ConceptRegistryService } from '../concepts/concept-registry.service';
import { LearnerStateService } from '../learner-state.service';
import { ReviewService } from '../review/review.service';
import { StrategyOutcomeService } from '../strategy/strategy-outcome.service';
import { TeachingDecisionService } from '../strategy/teaching-decision.service';
import { ADMIN_A, STUDENT_A, STUDENT_B, TEACHER_A, asUser, createHttpApp } from '@/test-utils/http-harness';

describe('LearnerModelController', () => {
  let app: INestApplication;
  let state: { listMastery: jest.Mock; nextConcept: jest.Mock; skillNodes: jest.Mock };
  let decisions: { decide: jest.Mock };
  let outcomes: { summary: jest.Mock };
  let review: { queue: jest.Mock; setReminders: jest.Mock };
  let registry: { listActive: jest.Mock };

  beforeEach(async () => {
    state = {
      listMastery: jest.fn(async (userId: string) => [{ conceptId: 'c1', title: 'C1', level: 1, score: 0.62, confidence: 0.05, evidenceCount: 1, lastEventAt: null, owner: userId }]),
      nextConcept: jest.fn(async () => ({ conceptId: 'c2', level: 1, reasonCodes: ['PREREQUISITES_MET'], concept: { id: 'c2', title: 'C2', level: 1 } })),
      skillNodes: jest.fn(async () => [{ conceptId: 'c1', title: 'C1', level: 1, state: 'AVAILABLE', score: 0, evidenceCount: 0 }]),
    };
    decisions = {
      decide: jest.fn(async (_userId: string, input: { conceptIds: string[]; intent: string }) => ({
        conceptId: input.conceptIds[0],
        intent: input.intent,
        strategy: 'WORKED_EXAMPLE',
        reasonCodes: ['LOW_MASTERY'],
      })),
    };
    outcomes = { summary: jest.fn(async () => ({ strategies: [], preferredStrategy: 'SOCRATIC', totalAttempts: 8 })) };
    review = {
      queue: jest.fn(async () => ({ policyVersion: 'review-v1', dueTotal: 1, due: [{ conceptId: 'c1' }], upcoming: [], session: { conceptIds: ['c1'] } })),
      setReminders: jest.fn(async (_userId: string, enabled: boolean) => ({ reminders: enabled })),
    };
    registry = {
      listActive: jest.fn(async () => [
        { id: 'c1', title: 'C1', description: 'Dasar', level: 1, sortOrder: 1, estimatedMinutes: 10, prerequisiteIds: [] },
        { id: 'c2', title: 'C2', description: null, level: 2, sortOrder: 1, estimatedMinutes: null, prerequisiteIds: ['c1'] },
      ]),
    };
    app = await createHttpApp({
      controllers: [LearnerModelController],
      providers: [
        { provide: ConceptRegistryService, useValue: registry },
        { provide: LearnerStateService, useValue: state },
        { provide: TeachingDecisionService, useValue: decisions },
        { provide: StrategyOutcomeService, useValue: outcomes },
        { provide: ReviewService, useValue: review },
      ],
    });
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /learner-model/me/mastery', () => {
    it('requires authentication', async () => {
      await request(app.getHttpServer()).get('/learner-model/me/mastery').expect(401);
    });

    it('returns the caller own mastery and never reads another learner', async () => {
      const res = await request(app.getHttpServer()).get('/learner-model/me/mastery').set(asUser(STUDENT_A)).expect(200);

      expect(state.listMastery).toHaveBeenCalledWith(STUDENT_A.id);
      expect(res.body.data ?? res.body).toBeDefined();
      expect(JSON.stringify(res.body)).toContain('c1');
    });

    it('ignores a userId in the query', async () => {
      await request(app.getHttpServer()).get(`/learner-model/me/mastery?userId=${STUDENT_B.id}`).set(asUser(STUDENT_A)).expect(200);

      expect(state.listMastery).toHaveBeenCalledWith(STUDENT_A.id);
      expect(state.listMastery).not.toHaveBeenCalledWith(STUDENT_B.id);
    });

    it('is open to teachers and admins as learners of their own', async () => {
      await request(app.getHttpServer()).get('/learner-model/me/mastery').set(asUser(TEACHER_A)).expect(200);
      await request(app.getHttpServer()).get('/learner-model/me/mastery').set(asUser(ADMIN_A)).expect(200);

      expect(state.listMastery).toHaveBeenCalledWith(TEACHER_A.id);
      expect(state.listMastery).toHaveBeenCalledWith(ADMIN_A.id);
    });
  });

  describe('GET /learner-model/me/next', () => {
    it('requires authentication', async () => {
      await request(app.getHttpServer()).get('/learner-model/me/next').expect(401);
    });

    it('returns the next concept with its reason codes for the caller', async () => {
      const res = await request(app.getHttpServer()).get('/learner-model/me/next').set(asUser(STUDENT_B)).expect(200);

      expect(state.nextConcept).toHaveBeenCalledWith(STUDENT_B.id);
      expect(JSON.stringify(res.body)).toContain('PREREQUISITES_MET');
    });
  });

  describe('GET /learner-model/me/skill-nodes', () => {
    it('requires authentication', async () => {
      await request(app.getHttpServer()).get('/learner-model/me/skill-nodes').expect(401);
    });

    it('returns the derived node states of the caller and ignores a userId in the query', async () => {
      const res = await request(app.getHttpServer())
        .get(`/learner-model/me/skill-nodes?userId=${STUDENT_B.id}`)
        .set(asUser(STUDENT_A))
        .expect(200);

      expect(state.skillNodes).toHaveBeenCalledWith(STUDENT_A.id);
      expect(state.skillNodes).not.toHaveBeenCalledWith(STUDENT_B.id);
      expect(JSON.stringify(res.body)).toContain('AVAILABLE');
    });
  });

  describe('GET /learner-model/me/strategy', () => {
    it('requires authentication', async () => {
      await request(app.getHttpServer()).get('/learner-model/me/strategy').expect(401);
    });

    it('decides for the named concept, for the caller and with the intent asked for', async () => {
      const res = await request(app.getHttpServer())
        .get('/learner-model/me/strategy?conceptId=c7&intent=PRACTICE')
        .set(asUser(STUDENT_A))
        .expect(200);

      expect(decisions.decide).toHaveBeenCalledWith(STUDENT_A.id, { conceptIds: ['c7'], intent: 'PRACTICE' });
      expect(JSON.stringify(res.body)).toContain('WORKED_EXAMPLE');
    });

    it('falls back to the next concept of the caller and to the doubt intent', async () => {
      await request(app.getHttpServer()).get('/learner-model/me/strategy').set(asUser(STUDENT_A)).expect(200);

      expect(state.nextConcept).toHaveBeenCalledWith(STUDENT_A.id);
      expect(decisions.decide).toHaveBeenCalledWith(STUDENT_A.id, { conceptIds: ['c2'], intent: 'DOUBT' });
    });

    it('answers with no decision when there is no concept to teach', async () => {
      state.nextConcept.mockResolvedValueOnce({ conceptId: null, level: null, reasonCodes: ['ALL_CONCEPTS_PASSED'], concept: null });

      const res = await request(app.getHttpServer()).get('/learner-model/me/strategy').set(asUser(STUDENT_A)).expect(200);

      expect(decisions.decide).not.toHaveBeenCalled();
      expect(res.body.data).toBeNull();
    });

    it('rejects an intent outside the closed set', async () => {
      await request(app.getHttpServer()).get('/learner-model/me/strategy?intent=IGNORE').set(asUser(STUDENT_A)).expect(400);

      expect(decisions.decide).not.toHaveBeenCalled();
    });

    it('ignores a userId in the query', async () => {
      await request(app.getHttpServer()).get(`/learner-model/me/strategy?conceptId=c7&userId=${STUDENT_B.id}`).set(asUser(STUDENT_A)).expect(200);

      expect(decisions.decide).toHaveBeenCalledWith(STUDENT_A.id, expect.anything());
      expect(decisions.decide).not.toHaveBeenCalledWith(STUDENT_B.id, expect.anything());
    });
  });

  describe('GET /learner-model/concepts', () => {
    it('requires authentication', async () => {
      await request(app.getHttpServer()).get('/learner-model/concepts').expect(401);
    });

    it('lists the active concepts without the prerequisite graph or timing internals', async () => {
      const res = await request(app.getHttpServer()).get('/learner-model/concepts').set(asUser(STUDENT_A)).expect(200);

      expect(res.body.data).toEqual([
        { id: 'c1', title: 'C1', description: 'Dasar', level: 1 },
        { id: 'c2', title: 'C2', description: null, level: 2 },
      ]);
    });

    it('is open to a teacher who tags a product', async () => {
      await request(app.getHttpServer()).get('/learner-model/concepts').set(asUser(TEACHER_A)).expect(200);
    });
  });

  describe('GET /learner-model/me/review', () => {
    it('requires authentication', async () => {
      await request(app.getHttpServer()).get('/learner-model/me/review').expect(401);
    });

    it('returns the review queue of the caller only and ignores a userId in the query', async () => {
      const res = await request(app.getHttpServer()).get(`/learner-model/me/review?userId=${STUDENT_B.id}`).set(asUser(STUDENT_A)).expect(200);

      expect(review.queue).toHaveBeenCalledWith(STUDENT_A.id);
      expect(review.queue).not.toHaveBeenCalledWith(STUDENT_B.id);
      expect(res.body.data).toMatchObject({ policyVersion: 'review-v1', dueTotal: 1 });
    });
  });

  describe('GET /learner-model/me/strategies', () => {
    it('requires authentication', async () => {
      await request(app.getHttpServer()).get('/learner-model/me/strategies').expect(401);
    });

    it('summarises the evidence of the caller only', async () => {
      const res = await request(app.getHttpServer()).get(`/learner-model/me/strategies?userId=${STUDENT_B.id}`).set(asUser(STUDENT_A)).expect(200);

      expect(outcomes.summary).toHaveBeenCalledWith(STUDENT_A.id);
      expect(outcomes.summary).not.toHaveBeenCalledWith(STUDENT_B.id);
      expect(res.body.data.preferredStrategy).toBe('SOCRATIC');
    });
  });

  describe('the retired step progress backfill', () => {
    it('no longer exists for anyone', async () => {
      await request(app.getHttpServer()).post('/learner-model/backfill/topic-mastery').set(asUser(ADMIN_A)).expect(404);
    });
  });

  describe('PUT /learner-model/me/review/reminders', () => {
    const put = () => request(app.getHttpServer()).put('/learner-model/me/review/reminders');

    it('requires authentication', async () => {
      await put().send({ enabled: false }).expect(401);
      expect(review.setReminders).not.toHaveBeenCalled();
    });

    it('turns the reminder on or off for the caller and never for someone else', async () => {
      const off = await put().set(asUser(STUDENT_A)).send({ enabled: false }).expect(200);
      expect(off.body.data).toEqual({ reminders: false });
      expect(review.setReminders).toHaveBeenCalledWith(STUDENT_A.id, false);

      await put().set(asUser(STUDENT_B)).send({ enabled: true }).expect(200);
      expect(review.setReminders).toHaveBeenLastCalledWith(STUDENT_B.id, true);
    });

    it('accepts only a strict boolean body', async () => {
      for (const body of [{}, { enabled: 'yes' }, { enabled: 1 }, { enabled: true, userId: 'x' }, []]) {
        await put().set(asUser(STUDENT_A)).send(body as never).expect(400);
      }
      expect(review.setReminders).not.toHaveBeenCalled();
    });
  });
});
