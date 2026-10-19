import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppError, AppErrorCode } from '@/common/lib/error';
import { STUDENT_A, asUser, createHttpApp } from '@/test-utils/http-harness';
import { SandboxContentService } from '../sandbox-content.service';
import { SandboxController } from '../sandbox.controller';
import { SandboxPracticeService, scaffoldFor } from '../sandbox-practice.service';

const LINES = [
  { account: '511', side: 'DEBIT', amount: 1200000 },
  { account: '101', side: 'CREDIT', amount: 1200000 },
];

describe('SandboxController', () => {
  let app: INestApplication;
  let service: Record<'catalog' | 'accounts' | 'signals' | 'detail' | 'check' | 'hint' | 'reveal' | 'variantDetail' | 'checkVariant' | 'revealVariant', jest.Mock>;

  beforeEach(async () => {
    service = {
      catalog: jest.fn().mockResolvedValue({ summary: {}, scenarios: [], recommended: null }),
      accounts: jest.fn().mockReturnValue([]),
      signals: jest.fn().mockResolvedValue({}),
      detail: jest.fn().mockResolvedValue({ id: 'j-bayar-gaji' }),
      check: jest.fn().mockResolvedValue({ correct: true }),
      hint: jest.fn().mockResolvedValue({ level: 1 }),
      reveal: jest.fn().mockResolvedValue({ key: [] }),
      variantDetail: jest.fn().mockResolvedValue({ seed: 3 }),
      checkVariant: jest.fn().mockResolvedValue({ correct: true }),
      revealVariant: jest.fn().mockResolvedValue({ key: [] }),
    };
    app = await createHttpApp({
      controllers: [SandboxController],
      providers: [
        { provide: SandboxPracticeService, useValue: service },
        { provide: SandboxContentService, useValue: { getGraph: () => ({ levels: [] }) } },
      ],
    });
  });

  afterEach(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  it('requires a signed-in learner on every route', async () => {
    await http().get('/sandbox/scenarios').expect(401);
    await http().get('/sandbox/accounts').expect(401);
    await http().get('/sandbox/graph').expect(401);
    await http().get('/sandbox/signals').expect(401);
    await http().get('/sandbox/scenarios/j-bayar-gaji').expect(401);
    await http().post('/sandbox/scenarios/j-bayar-gaji/check').send({ lines: LINES }).expect(401);
    await http().post('/sandbox/scenarios/j-bayar-gaji/hint').expect(401);
    await http().get('/sandbox/scenarios/j-bayar-gaji/variants/3').expect(401);
    await http().post('/sandbox/scenarios/j-bayar-gaji/variants/3/check').send({ lines: LINES }).expect(401);
    await http().post('/sandbox/scenarios/j-bayar-gaji/variants/3/reveal').expect(401);
    await http().post('/sandbox/scenarios/j-bayar-gaji/reveal').expect(401);
    expect(service.check).not.toHaveBeenCalled();
  });

  it('always acts as the caller and passes the parsed filter along', async () => {
    await http().get('/sandbox/scenarios?level=2&status=SOLVED&q=%20sewa%20').set(asUser(STUDENT_A)).expect(200);
    expect(service.catalog).toHaveBeenCalledWith(STUDENT_A.id, { level: 2, status: 'SOLVED', q: 'sewa' });

    await http().get('/sandbox/signals').set(asUser(STUDENT_A)).expect(200);
    expect(service.signals).toHaveBeenCalledWith(STUDENT_A.id);

    await http().post('/sandbox/scenarios/j-bayar-gaji/hint').set(asUser(STUDENT_A)).expect(200);
    expect(service.hint).toHaveBeenCalledWith(STUDENT_A.id, 'j-bayar-gaji');
  });

  it('rejects a filter or a scenario id it does not understand', async () => {
    await http().get('/sandbox/scenarios?level=9').set(asUser(STUDENT_A)).expect(400);
    await http().get('/sandbox/scenarios?status=DONE').set(asUser(STUDENT_A)).expect(400);
    await http().get('/sandbox/scenarios/Not_A_Slug').set(asUser(STUDENT_A)).expect(400);
    await http().get('/sandbox/scenarios/ab').set(asUser(STUDENT_A)).expect(400);
    expect(service.detail).not.toHaveBeenCalled();
  });

  it('accepts only whole rupiah on known three digit accounts and at most twelve lines', async () => {
    const send = (lines: unknown) => http().post('/sandbox/scenarios/j-bayar-gaji/check').set(asUser(STUDENT_A)).send({ lines });

    await send(LINES).expect(200);
    expect(service.check).toHaveBeenCalledWith(STUDENT_A.id, 'j-bayar-gaji', { lines: LINES });

    service.check.mockClear();
    await send([]).expect(400);
    await send([{ ...LINES[0], amount: 10.5 }]).expect(400);
    await send([{ ...LINES[0], amount: 0 }]).expect(400);
    await send([{ ...LINES[0], amount: -5 }]).expect(400);
    await send([{ ...LINES[0], amount: 1_000_000_000_000 }]).expect(400);
    await send([{ ...LINES[0], account: 'Kas' }]).expect(400);
    await send([{ ...LINES[0], side: 'LEFT' }]).expect(400);
    await send(Array.from({ length: 13 }, () => LINES[0])).expect(400);
    await http().post('/sandbox/scenarios/j-bayar-gaji/check').set(asUser(STUDENT_A)).send({ lines: LINES, userId: 'someone-else' }).expect(200);
    expect(service.check).toHaveBeenCalledTimes(1);
  });

  it('carries the service refusals through with their status', async () => {
    service.hint.mockRejectedValueOnce(new AppError('Tunggu 3 detik', 429, AppErrorCode.TOO_MANY_REQUESTS));
    service.reveal.mockRejectedValueOnce(new AppError('Coba dulu', 409, AppErrorCode.INVALID_STATE_TRANSITION));
    service.detail.mockRejectedValueOnce(new AppError('Skenario tidak ditemukan', 404, AppErrorCode.NOT_FOUND));

    await http().post('/sandbox/scenarios/j-bayar-gaji/hint').set(asUser(STUDENT_A)).expect(429);
    await http().post('/sandbox/scenarios/j-bayar-gaji/reveal').set(asUser(STUDENT_A)).expect(409);
    await http().get('/sandbox/scenarios/j-bayar-gaji').set(asUser(STUDENT_A)).expect(404);
  });

  describe('variants', () => {
    it('hands the seed to the service as a number for the signed in learner', async () => {
      await http().get('/sandbox/scenarios/j-bayar-gaji/variants/12').set(asUser(STUDENT_A)).expect(200);
      expect(service.variantDetail).toHaveBeenCalledWith(STUDENT_A.id, 'j-bayar-gaji', 12);

      await http().post('/sandbox/scenarios/j-bayar-gaji/variants/12/check').set(asUser(STUDENT_A)).send({ lines: LINES }).expect(200);
      expect(service.checkVariant).toHaveBeenCalledWith(STUDENT_A.id, 'j-bayar-gaji', 12, { lines: LINES });

      await http().post('/sandbox/scenarios/j-bayar-gaji/variants/12/reveal').set(asUser(STUDENT_A)).expect(200);
      expect(service.revealVariant).toHaveBeenCalledWith(STUDENT_A.id, 'j-bayar-gaji', 12);
    });

    it('rejects a seed that is not a whole number from 1 to 999999', async () => {
      for (const seed of ['0', '-4', '1.5', 'abc', '1000000']) {
        await http().get(`/sandbox/scenarios/j-bayar-gaji/variants/${seed}`).set(asUser(STUDENT_A)).expect(400);
      }
      expect(service.variantDetail).not.toHaveBeenCalled();
    });

    it('validates the journal lines of a variant check like the normal check', async () => {
      await http().post('/sandbox/scenarios/j-bayar-gaji/variants/2/check').set(asUser(STUDENT_A)).send({ lines: [] }).expect(400);
      await http().post('/sandbox/scenarios/j-bayar-gaji/variants/2/check').set(asUser(STUDENT_A)).send({ lines: [{ account: '511', side: 'DEBIT', amount: 0 }] }).expect(400);
      expect(service.checkVariant).not.toHaveBeenCalled();
    });
  });
});

describe('scaffoldFor', () => {
  it.each([
    ['a newcomer on the concept', undefined, 0, 0.5, 'HIGH'],
    ['little evidence even with a good score', 'MINIMAL', 1, 0.9, 'HIGH'],
    ['the policy asks for the most help', 'HIGH', 9, 0.95, 'HIGH'],
    ['the policy asks for some help', 'MEDIUM', 9, 0.95, 'MEDIUM'],
    ['practised but still shaky', 'MINIMAL', 4, 0.55, 'MEDIUM'],
    ['practised and comfortable', 'MINIMAL', 4, 0.8, 'MINIMAL'],
  ] as const)('%s', (_name, policy, evidence, mastery, expected) => {
    expect(scaffoldFor(policy, evidence, mastery)).toBe(expected);
  });
});
