import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AdminOptimizationController } from '../admin-optimization.controller';
import { BenchmarkService } from '../benchmark/benchmark.service';
import { PromptProposalService } from '../prompt-proposal.service';
import { PromptRegistryService } from '../prompt-registry.service';
import { ADMIN_A, STUDENT_A, TEACHER_A, asUser, createHttpApp } from '@/test-utils/http-harness';

const ID = '77777777-7777-4777-8777-777777777777';
const reason = { reason: 'the numbers are in' };
const decision = { decision: 'ACCEPTED', rationale: 'The benchmark shows no regression on any dimension' };

describe('AdminOptimizationController', () => {
  let app: INestApplication;
  let registry: Record<'list' | 'builtin' | 'runs' | 'propose' | 'startCanary' | 'evaluate' | 'approve' | 'reject' | 'rollback' | 'decideBenchmarkRun', jest.Mock>;
  let proposals: { proposeImprovement: jest.Mock; proposeFromBenchmark: jest.Mock };
  let benchmarks: Record<'start' | 'list' | 'detail' | 'caseDetail', jest.Mock>;
  const benchmarkTargets: Record<string, keyof typeof benchmarks> = { startBenchmark: 'start', listBenchmarks: 'list', benchmark: 'detail', benchmarkCase: 'caseDetail' };
  const target = (name: string): jest.Mock => {
    if (name === 'proposeImprovement') return proposals.proposeImprovement;
    if (name === 'proposeFromBenchmark') return proposals.proposeFromBenchmark;
    if (name in benchmarkTargets) return benchmarks[benchmarkTargets[name]];
    return registry[name as keyof typeof registry];
  };

  beforeEach(async () => {
    registry = {
      list: jest.fn().mockResolvedValue({ message: 'ok', data: { versions: [], builtin: [] } }),
      builtin: jest.fn().mockResolvedValue({ message: 'ok', data: { name: 'tutor-chat', label: 'x', body: 'y' } }),
      runs: jest.fn().mockResolvedValue({ message: 'ok', data: [] }),
      propose: jest.fn().mockResolvedValue({ message: 'ok', data: { id: ID } }),
      startCanary: jest.fn().mockResolvedValue({ message: 'ok', data: {} }),
      evaluate: jest.fn().mockResolvedValue({ message: 'ok', data: {} }),
      approve: jest.fn().mockResolvedValue({ message: 'ok', data: {} }),
      reject: jest.fn().mockResolvedValue({ message: 'ok', data: {} }),
      rollback: jest.fn().mockResolvedValue({ message: 'ok', data: {} }),
      decideBenchmarkRun: jest.fn().mockResolvedValue({ message: 'ok', data: {} }),
    };
    proposals = {
      proposeImprovement: jest.fn().mockResolvedValue({ message: 'ok', data: { id: ID } }),
      proposeFromBenchmark: jest.fn().mockResolvedValue({ message: 'ok', data: { id: ID } }),
    };
    benchmarks = {
      start: jest.fn().mockResolvedValue({ message: 'ok', data: { id: ID } }),
      list: jest.fn().mockResolvedValue({ message: 'ok', data: [] }),
      detail: jest.fn().mockResolvedValue({ message: 'ok', data: {} }),
      caseDetail: jest.fn().mockResolvedValue({ message: 'ok', data: {} }),
    };
    app = await createHttpApp({
      controllers: [AdminOptimizationController],
      providers: [
        { provide: PromptRegistryService, useValue: registry },
        { provide: PromptProposalService, useValue: proposals },
        { provide: BenchmarkService, useValue: benchmarks },
      ],
    });
  });

  afterEach(async () => {
    await app.close();
  });

  const routes: Array<[string, 'get' | 'post', string, object?]> = [
    ['list', 'get', '/admin/optimization/prompts'],
    ['builtin', 'get', '/admin/optimization/prompts/builtin?name=tutor-chat'],
    ['runs', 'get', '/admin/optimization/runs'],
    ['propose', 'post', '/admin/optimization/prompts', { name: 'tutor-chat', body: 'x', rationale: 'because' }],
    ['startCanary', 'post', `/admin/optimization/prompts/${ID}/canary`, { percent: 10, reason: 'try it' }],
    ['evaluate', 'post', `/admin/optimization/prompts/${ID}/evaluate`, {}],
    ['approve', 'post', `/admin/optimization/prompts/${ID}/approve`, { ...reason, acknowledgeUnmeasured: true }],
    ['reject', 'post', `/admin/optimization/prompts/${ID}/reject`, reason],
    ['rollback', 'post', `/admin/optimization/prompts/${ID}/rollback`, reason],
    ['proposeImprovement', 'post', '/admin/optimization/prompts/propose-improvement', { name: 'tutor-chat' }],
    ['startBenchmark', 'post', '/admin/optimization/benchmarks', { name: 'tutor-chat', repeats: 2 }],
    ['listBenchmarks', 'get', '/admin/optimization/benchmarks'],
    ['benchmark', 'get', `/admin/optimization/benchmarks/${ID}`],
    ['benchmarkCase', 'get', `/admin/optimization/benchmarks/${ID}/cases/TC-01`],
    ['decideBenchmarkRun', 'post', `/admin/optimization/benchmarks/${ID}/decision`, decision],
    ['proposeFromBenchmark', 'post', `/admin/optimization/benchmarks/${ID}/propose-improvement`, {}],
  ];

  describe.each(routes)('%s', (name, method, path, body) => {
    it('rejects an unauthenticated caller', async () => {
      await request(app.getHttpServer())[method](path).send(body).expect(401);
      expect(target(name)).not.toHaveBeenCalled();
    });

    it.each([
      ['a learner', STUDENT_A],
      ['a teacher', TEACHER_A],
    ])('rejects %s', async (_label, user) => {
      await request(app.getHttpServer())[method](path).set(asUser(user)).send(body).expect(403);
      expect(target(name)).not.toHaveBeenCalled();
    });

    it('lets an administrator through', async () => {
      await request(app.getHttpServer())[method](path).set(asUser(ADMIN_A)).send(body).expect(method === 'post' ? 201 : 200);
      expect(target(name)).toHaveBeenCalledTimes(1);
    });
  });

  describe('input rules', () => {
    const admin = () => request(app.getHttpServer());

    it('refuses an approval that does not acknowledge the criteria nobody measured', async () => {
      await admin().post(`/admin/optimization/prompts/${ID}/approve`).set(asUser(ADMIN_A)).send({ ...reason, acknowledgeUnmeasured: false }).expect(400);
      await admin().post(`/admin/optimization/prompts/${ID}/approve`).set(asUser(ADMIN_A)).send(reason).expect(400);

      expect(registry.approve).not.toHaveBeenCalled();
    });

    it('refuses a canary share outside 1 to 50 percent', async () => {
      for (const percent of [0, 51, 12.5]) {
        await admin().post(`/admin/optimization/prompts/${ID}/canary`).set(asUser(ADMIN_A)).send({ percent, reason: 'try it' }).expect(400);
      }

      expect(registry.startCanary).not.toHaveBeenCalled();
    });

    it('refuses a prompt name outside the contract and a version id that is not a uuid', async () => {
      await admin().post('/admin/optimization/prompts').set(asUser(ADMIN_A)).send({ name: 'other', body: 'x', rationale: 'because' }).expect(400);
      await admin().post('/admin/optimization/prompts/not-a-uuid/evaluate').set(asUser(ADMIN_A)).send({}).expect(400);

      expect(registry.propose).not.toHaveBeenCalled();
      expect(registry.evaluate).not.toHaveBeenCalled();
    });

    it('refuses fields the caller must not set on a proposal', async () => {
      await admin()
        .post('/admin/optimization/prompts')
        .set(asUser(ADMIN_A))
        .send({ name: 'tutor-chat', body: 'x', rationale: 'because', status: 'ACTIVE', createdBy: 'someone' })
        .expect(400);

      expect(registry.propose).not.toHaveBeenCalled();
    });

    it('lets an administrator ask for an improvement of a known prompt only, with nothing else in the body', async () => {
      const url = '/admin/optimization/prompts/propose-improvement';

      await admin().post(url).set(asUser(ADMIN_A)).send({ name: 'other' }).expect(400);
      await admin().post(url).set(asUser(ADMIN_A)).send({ name: 'tutor-chat', body: 'my own template' }).expect(400);
      await admin().post(url).set(asUser(ADMIN_A)).send({}).expect(400);
      expect(proposals.proposeImprovement).not.toHaveBeenCalled();

      await admin().post(url).set(asUser(ADMIN_A)).send({ name: 'tutor-chat' }).expect(201);
      expect(proposals.proposeImprovement.mock.calls[0][0]).toMatchObject({ id: ADMIN_A.id, role: 'ADMIN' });
      expect(proposals.proposeImprovement.mock.calls[0][1]).toEqual({ name: 'tutor-chat' });
    });

    it('starts a benchmark only for a known prompt, a bounded number of repeats and nothing else in the body', async () => {
      const url = '/admin/optimization/benchmarks';

      for (const body of [{ name: 'other' }, { name: 'tutor-chat', repeats: 0 }, { name: 'tutor-chat', repeats: 6 }, { name: 'tutor-chat', candidatePromptId: 'x' }, { name: 'tutor-chat', datasetName: 'mine' }, {}]) {
        await admin().post(url).set(asUser(ADMIN_A)).send(body).expect(400);
      }
      expect(benchmarks.start).not.toHaveBeenCalled();

      await admin().post(url).set(asUser(ADMIN_A)).send({ name: 'tutor-chat', candidatePromptId: ID, repeats: 3, judge: false }).expect(201);
      expect(benchmarks.start.mock.calls[0][0]).toMatchObject({ id: ADMIN_A.id, role: 'ADMIN' });
      expect(benchmarks.start.mock.calls[0][1]).toEqual({ name: 'tutor-chat', candidatePromptId: ID, datasetName: 'tutor-chat-benchmark-v1', repeats: 3, judge: false });
    });

    it('defaults to one repeat with the judge on', async () => {
      await admin().post('/admin/optimization/benchmarks').set(asUser(ADMIN_A)).send({ name: 'tutor-chat' }).expect(201);

      expect(benchmarks.start.mock.calls[0][1]).toEqual({ name: 'tutor-chat', datasetName: 'tutor-chat-benchmark-v1', repeats: 1, judge: true });
    });

    it('takes a benchmark decision from a person with a reason and never an identity or a date from the body', async () => {
      const url = `/admin/optimization/benchmarks/${ID}/decision`;

      for (const body of [{ decision: 'ACTIVE', rationale: 'long enough reason' }, { decision: 'ACCEPTED', rationale: 'short' }, { ...decision, decidedBy: 'someone' }, { ...decision, decidedAt: '2026-01-01' }, {}]) {
        await admin().post(url).set(asUser(ADMIN_A)).send(body).expect(400);
      }
      expect(registry.decideBenchmarkRun).not.toHaveBeenCalled();

      await admin().post(url).set(asUser(ADMIN_A)).send(decision).expect(201);
      expect(registry.decideBenchmarkRun.mock.calls[0][0]).toMatchObject({ id: ADMIN_A.id, role: 'ADMIN' });
      expect(registry.decideBenchmarkRun.mock.calls[0][1]).toBe(ID);
      expect(registry.decideBenchmarkRun.mock.calls[0][2]).toEqual(decision);
    });

    it('refuses a benchmark id that is not a uuid', async () => {
      await admin().get('/admin/optimization/benchmarks/not-a-uuid').set(asUser(ADMIN_A)).expect(400);

      expect(benchmarks.detail).not.toHaveBeenCalled();
    });

    it('passes the acting administrator and never an identity from the body', async () => {
      await admin().post(`/admin/optimization/prompts/${ID}/reject`).set(asUser(ADMIN_A)).send(reason).expect(201);

      expect(registry.reject.mock.calls[0][0]).toMatchObject({ id: ADMIN_A.id, role: 'ADMIN' });
      expect(registry.reject.mock.calls[0][1]).toBe(ID);
      expect(registry.reject.mock.calls[0][2]).toBe(reason.reason);
    });
  });
});
