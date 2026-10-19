import { Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma, TryoutSession } from '@prisma/client';
import { randomInt } from 'crypto';
import { PrismaService } from '@/common/config/prisma/prisma.service';
import { AppError, AppErrorCode } from '@/common/lib/error';
import { LearnerEventsService } from '@/v1/learner-model/events/learner-events.service';
import { SaveAnswersDto, SubmitTryoutDto, TryoutHistoryQuery, TryoutPlanDto } from '../dto/tryout.dto';
import { paginate } from '../paging';
import {
  AnswerMap,
  MIN_ANSWERED_FOR_EVIDENCE,
  MIN_ITEMS_FOR_EVIDENCE,
  TryoutResult,
  gradeSession,
  percentOf,
  publicItem,
} from './tryout-grading';
import { SEED_LIMIT, UTBK_EXAM_KEY } from './tryout-engine';
import { HISTORY_PAGE_SIZE, HISTORY_SCAN_LIMIT, filterHistory } from './tryout-history';
import { TryoutEngineService } from './tryout-engine.service';
import { SUBTEST_KEYS, SubtestKey, TryoutItem, TryoutPlan } from './tryout-types';

export const GRACE_SECONDS = 15;
export const RECENT_LIMIT = 8;

const TIME_UP = 'Waktu tryout sudah habis.';

const isDuplicate = (error: unknown): boolean => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

const asItems = (value: Prisma.JsonValue): TryoutItem[] => value as unknown as TryoutItem[];
const asPlan = (value: Prisma.JsonValue): TryoutPlan => value as unknown as TryoutPlan;
const asAnswers = (value: Prisma.JsonValue): AnswerMap => (value && typeof value === 'object' && !Array.isArray(value) ? (value as AnswerMap) : {});
const asResult = (value: Prisma.JsonValue | null): TryoutResult => value as unknown as TryoutResult;

const deadlineOf = (session: Pick<TryoutSession, 'startedAt' | 'durationSeconds'>): Date => new Date(session.startedAt.getTime() + session.durationSeconds * 1000);

const notFound = () => new AppError('Tryout tidak ditemukan', 404, AppErrorCode.NOT_FOUND);

@Injectable()
export class TryoutService {
  private readonly logger = new Logger(TryoutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly engines: TryoutEngineService,
    @Optional() private readonly learnerEvents?: LearnerEventsService,
  ) {}

  private get engine() {
    return this.engines.engine;
  }

  private subtestTitles(): Record<SubtestKey, string> {
    return Object.fromEntries(this.engine.subtests().map((info) => [info.key, info.title])) as Record<SubtestKey, string>;
  }

  async catalog(userId: string) {
    await this.closeExpired(userId);
    const [active, recent] = await Promise.all([
      this.prisma.tryoutSession.findFirst({ where: { userId, status: 'IN_PROGRESS' } }),
      this.prisma.tryoutSession.findMany({ where: { userId, status: 'SUBMITTED' }, orderBy: { submittedAt: 'desc' }, take: RECENT_LIMIT }),
    ]);
    return {
      exam: {
        key: UTBK_EXAM_KEY,
        title: 'UTBK-SNBT',
        scoring: 'Skor latihan dihitung dari persentase jawaban benar. Ini bukan skor IRT resmi UTBK.',
      },
      subtests: this.engine.subtests(),
      presets: this.engine.presets(),
      active: active ? this.activeSummary(active) : null,
      recent: recent.map((session) => this.recentSummary(session)),
    };
  }

  async history(userId: string, query: TryoutHistoryQuery) {
    await this.closeExpired(userId);
    const rows = await this.prisma.tryoutSession.findMany({
      where: { userId, status: 'SUBMITTED' },
      orderBy: { submittedAt: 'desc' },
      take: HISTORY_SCAN_LIMIT,
    });
    const entries = filterHistory(
      rows.map((row) => this.recentSummary(row)),
      query,
    );
    return paginate(entries, query.limit ?? HISTORY_PAGE_SIZE, query.cursor);
  }

  async start(userId: string, dto: TryoutPlanDto) {
    const plan: TryoutPlan = { examKey: dto.examKey, subtests: dto.subtests };
    const problem = this.engine.validate(plan);
    if (problem) throw new AppError(problem, 400, AppErrorCode.VALIDATION_ERROR);

    await this.closeExpired(userId);
    const seed = randomInt(1, SEED_LIMIT);
    const items = this.engine.compose(plan, seed);
    try {
      const session = await this.prisma.tryoutSession.create({
        data: {
          userId,
          examKey: plan.examKey,
          seed,
          plan: plan as unknown as Prisma.InputJsonValue,
          items: items as unknown as Prisma.InputJsonValue,
          durationSeconds: this.engine.durationSeconds(plan.subtests),
        },
      });
      return this.sessionView(session);
    } catch (error) {
      if (isDuplicate(error)) {
        throw new AppError('Masih ada tryout yang sedang berjalan. Selesaikan atau akhiri dulu sebelum memulai yang baru.', 409, AppErrorCode.INVALID_STATE_TRANSITION);
      }
      throw error;
    }
  }

  async view(userId: string, id: string) {
    const session = await this.findOwned(userId, id);
    const settled = session.status === 'IN_PROGRESS' && this.pastGrace(session) ? await this.submitStored(userId, id) : session;
    return this.sessionView(settled);
  }

  async saveAnswers(userId: string, id: string, dto: SaveAnswersDto) {
    return this.prisma.$transaction(async (tx) => {
      const session = await this.lock(tx, userId, id);
      if (session.status !== 'IN_PROGRESS') throw new AppError('Tryout ini sudah diselesaikan.', 409, AppErrorCode.INVALID_STATE_TRANSITION);
      if (this.pastGrace(session)) throw new AppError(TIME_UP, 409, AppErrorCode.INVALID_STATE_TRANSITION);

      const merged = this.mergeAnswers(session, dto.answers);
      await tx.tryoutSession.update({ where: { id }, data: { answers: merged as Prisma.InputJsonValue } });
      return { saved: Object.keys(merged).length, total: asItems(session.items).length, remainingSeconds: this.remainingSeconds(session) };
    });
  }

  async submit(userId: string, id: string, dto: SubmitTryoutDto) {
    const submitted = await this.prisma.$transaction(async (tx) => {
      const session = await this.lock(tx, userId, id);
      if (session.status === 'SUBMITTED') return { session, fresh: false };

      const answers = dto.answers && !this.pastGrace(session) ? this.mergeAnswers(session, dto.answers) : asAnswers(session.answers);
      const closedAt = this.closingTime(session);
      const result = this.grade(session, answers, closedAt);
      const updated = await tx.tryoutSession.update({
        where: { id },
        data: { status: 'SUBMITTED', submittedAt: closedAt, answers: answers as Prisma.InputJsonValue, result: result as unknown as Prisma.InputJsonValue },
      });
      return { session: updated, fresh: true };
    });

    if (submitted.fresh) await this.recordEvidence(userId, submitted.session);
    return this.resultView(submitted.session);
  }

  async result(userId: string, id: string) {
    let session = await this.findOwned(userId, id);
    if (session.status === 'IN_PROGRESS' && this.pastGrace(session)) session = await this.submitStored(userId, id);
    if (session.status !== 'SUBMITTED') throw new AppError('Tryout ini belum diselesaikan.', 409, AppErrorCode.INVALID_STATE_TRANSITION);
    return this.resultView(session);
  }

  private async findOwned(userId: string, id: string): Promise<TryoutSession> {
    const session = await this.prisma.tryoutSession.findFirst({ where: { id, userId } });
    if (!session) throw notFound();
    return session;
  }

  private async lock(tx: Prisma.TransactionClient, userId: string, id: string): Promise<TryoutSession> {
    await tx.$queryRaw`SELECT id FROM "TryoutSession" WHERE id = ${id} FOR UPDATE`;
    const session = await tx.tryoutSession.findFirst({ where: { id, userId } });
    if (!session) throw notFound();
    return session;
  }

  private pastGrace(session: Pick<TryoutSession, 'startedAt' | 'durationSeconds'>): boolean {
    return Date.now() > deadlineOf(session).getTime() + GRACE_SECONDS * 1000;
  }

  private remainingSeconds(session: Pick<TryoutSession, 'startedAt' | 'durationSeconds'>): number {
    return Math.max(0, Math.ceil((deadlineOf(session).getTime() - Date.now()) / 1000));
  }

  private closingTime(session: Pick<TryoutSession, 'startedAt' | 'durationSeconds'>): Date {
    const deadline = deadlineOf(session);
    const now = new Date();
    return now.getTime() > deadline.getTime() ? deadline : now;
  }

  private mergeAnswers(session: TryoutSession, incoming: Record<string, number | null>): AnswerMap {
    const items = asItems(session.items);
    const known = new Map(items.map((item) => [item.id, item]));
    const merged: AnswerMap = { ...asAnswers(session.answers) };
    for (const [itemId, choice] of Object.entries(incoming)) {
      const item = known.get(itemId);
      if (!item) throw new AppError(`Soal ${itemId} tidak ada di tryout ini.`, 400, AppErrorCode.VALIDATION_ERROR);
      if (choice === null) {
        delete merged[itemId];
        continue;
      }
      if (choice >= item.options.length) throw new AppError(`Pilihan untuk soal ${itemId} tidak valid.`, 400, AppErrorCode.VALIDATION_ERROR);
      merged[itemId] = choice;
    }
    return merged;
  }

  private grade(session: TryoutSession, answers: AnswerMap, submittedAt: Date): TryoutResult {
    return gradeSession({
      items: asItems(session.items),
      answers,
      startedAt: session.startedAt,
      submittedAt,
      durationSeconds: session.durationSeconds,
      subtestTitles: this.subtestTitles(),
      conceptTitles: this.engines.conceptTitles,
    });
  }

  private async submitStored(userId: string, id: string): Promise<TryoutSession> {
    await this.submit(userId, id, {});
    return this.findOwned(userId, id);
  }

  private async closeExpired(userId: string): Promise<void> {
    const open = await this.prisma.tryoutSession.findMany({ where: { userId, status: 'IN_PROGRESS' } });
    for (const session of open) {
      if (this.pastGrace(session)) await this.submit(userId, session.id, {});
    }
  }

  private sessionView(session: TryoutSession) {
    const items = asItems(session.items);
    const base = {
      id: session.id,
      examKey: session.examKey,
      status: session.status,
      startedAt: session.startedAt,
      submittedAt: session.submittedAt,
      durationSeconds: session.durationSeconds,
      total: items.length,
      subtests: asPlan(session.plan).subtests.map((entry) => ({ ...entry, title: this.engine.info(entry.key).title })),
    };
    if (session.status !== 'IN_PROGRESS') return { ...base, deadlineAt: deadlineOf(session), serverNow: new Date(), remainingSeconds: 0, items: [], answers: {} };
    return {
      ...base,
      deadlineAt: deadlineOf(session),
      serverNow: new Date(),
      remainingSeconds: this.remainingSeconds(session),
      items: items.map(publicItem),
      answers: asAnswers(session.answers),
    };
  }

  private activeSummary(session: TryoutSession) {
    return {
      id: session.id,
      startedAt: session.startedAt,
      deadlineAt: deadlineOf(session),
      remainingSeconds: this.remainingSeconds(session),
      total: asItems(session.items).length,
      answered: Object.keys(asAnswers(session.answers)).length,
      subtests: asPlan(session.plan).subtests,
    };
  }

  private recentSummary(session: TryoutSession) {
    const result = asResult(session.result);
    return {
      id: session.id,
      startedAt: session.startedAt,
      submittedAt: session.submittedAt,
      total: result.total,
      correct: result.correct,
      percent: result.percent,
      usedSeconds: result.usedSeconds,
      subtests: result.subtests.map((subtest) => ({ key: subtest.key, title: subtest.title, total: subtest.total, percent: subtest.percent })),
    };
  }

  private resultView(session: TryoutSession) {
    return {
      id: session.id,
      examKey: session.examKey,
      startedAt: session.startedAt,
      submittedAt: session.submittedAt,
      ...asResult(session.result),
    };
  }

  private async recordEvidence(userId: string, session: TryoutSession): Promise<void> {
    if (!this.learnerEvents) return;
    const result = asResult(session.result);
    if (percentOf(result.answered, result.total) < MIN_ANSWERED_FOR_EVIDENCE * 100) return;

    const known = new Set(SUBTEST_KEYS.flatMap((key) => this.engine.info(key).conceptIds));
    for (const concept of result.concepts) {
      if (concept.total < MIN_ITEMS_FOR_EVIDENCE || !known.has(concept.conceptId)) continue;
      try {
        const registered = await this.prisma.concept.findUnique({ where: { id: concept.conceptId }, select: { status: true } });
        if (!registered || registered.status !== 'ACTIVE') continue;
        await this.learnerEvents.append({
          userId,
          conceptId: concept.conceptId,
          idempotencyKey: `tryout:${session.id}:${concept.conceptId}`,
          payload: {
            attemptId: session.id,
            quizId: `tryout:${session.id}`,
            score: concept.correct / concept.total,
            items: concept.total,
            hintsUsed: 0,
            share: 1,
            attemptNumber: 1,
          },
        });
      } catch (error) {
        this.logger.warn(`The tryout evidence for ${concept.conceptId} could not be recorded: ${(error as Error).message}`);
      }
    }
  }
}
