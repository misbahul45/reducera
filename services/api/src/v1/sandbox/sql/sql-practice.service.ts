import { Injectable, Logger } from '@nestjs/common';
import { SandboxSqlProgress } from '@prisma/client';
import { PrismaService } from '@/common/config/prisma/prisma.service';
import { AppError, AppErrorCode } from '@/common/lib/error';
import { CheckSqlDto, RunSqlDto } from '../dto/sql.dto';
import { ResultSet, VerdictCode, compareResults } from './sql-compare';
import { HINTS_PER_EXERCISE, SqlDataset, SqlExercise } from './sql-content';
import { SqlContentService } from './sql-content.service';
import { guardSql } from './sql-guard';
import { RunOutcome, SqlRunnerService } from './sql-runner.service';

export type SqlPracticeStatus = 'NEW' | 'IN_PROGRESS' | 'SOLVED';
export type CheckVerdict = VerdictCode | 'ERROR' | 'REJECTED';

export interface SqlProgressView {
  status: SqlPracticeStatus;
  attempts: number;
  hintLevel: number;
  hints: string[];
  revealed: boolean;
  solvedAt: Date | null;
  lastSql: string | null;
}

const EMPTY_PROGRESS: SqlProgressView = { status: 'NEW', attempts: 0, hintLevel: 0, hints: [], revealed: false, solvedAt: null, lastSql: null };

const progressOf = (exercise: SqlExercise, row: SandboxSqlProgress | null | undefined): SqlProgressView =>
  row
    ? {
        status: row.solved ? 'SOLVED' : row.attempts > 0 || row.hintLevel > 0 || row.revealed ? 'IN_PROGRESS' : 'NEW',
        attempts: row.attempts,
        hintLevel: row.hintLevel,
        hints: exercise.hints.slice(0, row.hintLevel),
        revealed: row.revealed,
        solvedAt: row.solvedAt,
        lastSql: row.lastSql,
      }
    : EMPTY_PROGRESS;

const resultOf = (outcome: RunOutcome, usesVerify: boolean): ResultSet | null => {
  const source = usesVerify ? outcome.verify : (outcome.outputs[outcome.outputs.length - 1] ?? null);
  return source && source.columns.length > 0 ? { columns: source.columns, rows: source.rows } : null;
};

@Injectable()
export class SqlPracticeService {
  private readonly logger = new Logger(SqlPracticeService.name);
  private readonly expected = new Map<string, Promise<ResultSet>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly content: SqlContentService,
    private readonly runner: SqlRunnerService,
  ) {}

  async catalog(userId: string) {
    const rows = await this.prisma.sandboxSqlProgress.findMany({ where: { userId } });
    const byExercise = new Map(rows.map((row) => [row.exerciseId, row]));
    const exercises = this.content.exercises().map((exercise) => ({
      id: exercise.id,
      datasetId: exercise.datasetId,
      level: exercise.level,
      subTopic: exercise.subTopic,
      title: exercise.title,
      task: exercise.task,
      ordered: exercise.ordered,
      hintCount: HINTS_PER_EXERCISE,
      progress: progressOf(exercise, byExercise.get(exercise.id)),
    }));
    return {
      available: this.runner.isConfigured(),
      datasets: this.content.datasets().map(({ id, title, engine, description, tables }) => ({ id, title, engine, description, tables })),
      exercises,
      summary: { solved: exercises.filter((exercise) => exercise.progress.status === 'SOLVED').length, total: exercises.length },
    };
  }

  async run(dto: RunSqlDto) {
    const dataset = this.datasetOrThrow(dto.datasetId);
    const guarded = guardSql(dto.sql);
    if (!guarded.ok) return { accepted: false, notice: guarded.message, statementIndex: guarded.statementIndex, outputs: [], error: null };
    const outcome = await this.runner.run({ setupSql: dataset.setupSql, statements: guarded.statements });
    return { accepted: true, notice: null, statementIndex: null, outputs: outcome.outputs, error: outcome.error };
  }

  async check(userId: string, exerciseId: string, dto: CheckSqlDto) {
    const exercise = this.exerciseOrThrow(exerciseId);
    const dataset = this.datasetOrThrow(exercise.datasetId);
    const before = await this.findProgress(userId, exercise.id);

    const guarded = guardSql(dto.sql);
    if (!guarded.ok) {
      return {
        correct: false,
        verdict: 'REJECTED' as CheckVerdict,
        feedback: guarded.message,
        outputs: [],
        error: null,
        progress: progressOf(exercise, before),
        explanation: null,
      };
    }

    const expected = await this.expectedFor(exercise, dataset);
    const outcome = await this.runner.run({ setupSql: dataset.setupSql, statements: guarded.statements, verifySql: exercise.verifySql });

    const verdict: { correct: boolean; code: CheckVerdict; message: string } = outcome.error
      ? { correct: false, code: 'ERROR', message: outcome.error.friendly }
      : compareResults(resultOf(outcome, !!exercise.verifySql), expected, exercise.ordered);

    const row = await this.record(userId, exercise.id, dto.sql, verdict.correct, before);
    const progress = progressOf(exercise, row);
    return {
      correct: verdict.correct,
      verdict: verdict.code,
      feedback: verdict.message,
      outputs: outcome.outputs,
      error: outcome.error,
      progress,
      explanation: progress.status === 'SOLVED' || progress.revealed ? exercise.explanation : null,
    };
  }

  async hint(userId: string, exerciseId: string) {
    const exercise = this.exerciseOrThrow(exerciseId);
    const row = await this.findProgress(userId, exercise.id);
    const level = row?.hintLevel ?? 0;
    const attempts = row?.attempts ?? 0;

    if (level >= HINTS_PER_EXERCISE) return this.hintView(exercise, level, 'Semua petunjuk sudah dibuka.');
    if (level > 0 && attempts < level) {
      return this.hintView(exercise, level, 'Jalankan jawaban Anda untuk diperiksa lebih dulu sebelum membuka petunjuk berikutnya.');
    }

    if (row) {
      await this.prisma.sandboxSqlProgress.updateMany({ where: { id: row.id, hintLevel: level }, data: { hintLevel: { increment: 1 } } });
    } else {
      await this.prisma.sandboxSqlProgress.upsert({
        where: { userId_exerciseId: { userId, exerciseId: exercise.id } },
        create: { userId, exerciseId: exercise.id, hintLevel: 1 },
        update: {},
      });
    }
    const fresh = await this.findProgress(userId, exercise.id);
    return this.hintView(exercise, fresh?.hintLevel ?? level + 1, null);
  }

  async reveal(userId: string, exerciseId: string) {
    const exercise = this.exerciseOrThrow(exerciseId);
    const row = await this.findProgress(userId, exercise.id);
    if (!row || row.attempts < 1) {
      throw new AppError('Coba jawab setidaknya satu kali sebelum membuka kunci jawaban.', 409, AppErrorCode.INVALID_STATE_TRANSITION);
    }
    if (!row.revealed) await this.prisma.sandboxSqlProgress.update({ where: { id: row.id }, data: { revealed: true } });
    return { referenceSql: exercise.referenceSql, explanation: exercise.explanation, revealed: true };
  }

  private hintView(exercise: SqlExercise, level: number, message: string | null) {
    return {
      hintLevel: level,
      hints: exercise.hints.slice(0, level),
      hintCount: HINTS_PER_EXERCISE,
      notice: message,
    };
  }

  private findProgress(userId: string, exerciseId: string) {
    return this.prisma.sandboxSqlProgress.findUnique({ where: { userId_exerciseId: { userId, exerciseId } } });
  }

  private record(userId: string, exerciseId: string, sql: string, correct: boolean, before: SandboxSqlProgress | null) {
    const solvedNow = correct && !before?.solved;
    return this.prisma.sandboxSqlProgress.upsert({
      where: { userId_exerciseId: { userId, exerciseId } },
      create: { userId, exerciseId, attempts: 1, lastSql: sql, solved: correct, solvedAt: correct ? new Date() : null },
      update: { attempts: { increment: 1 }, lastSql: sql, ...(solvedNow ? { solved: true, solvedAt: new Date() } : {}) },
    });
  }

  private expectedFor(exercise: SqlExercise, dataset: SqlDataset): Promise<ResultSet> {
    const cached = this.expected.get(exercise.id);
    if (cached) return cached;
    const pending = this.computeExpected(exercise, dataset).catch((error) => {
      this.expected.delete(exercise.id);
      throw error;
    });
    this.expected.set(exercise.id, pending);
    return pending;
  }

  private async computeExpected(exercise: SqlExercise, dataset: SqlDataset): Promise<ResultSet> {
    const guarded = guardSql(exercise.referenceSql);
    if (!guarded.ok) throw new Error(`Reference SQL of ${exercise.id} is rejected: ${guarded.message}`);
    const outcome = await this.runner.run({ setupSql: dataset.setupSql, statements: guarded.statements, verifySql: exercise.verifySql });
    const result = outcome.error ? null : resultOf(outcome, !!exercise.verifySql);
    if (!result) {
      this.logger.error(`The reference SQL of ${exercise.id} produced no result: ${outcome.error?.message ?? 'empty'}`);
      throw new AppError('Latihan ini belum dapat diperiksa saat ini.', 503, AppErrorCode.SERVICE_UNAVAILABLE);
    }
    return result;
  }

  private datasetOrThrow(id: string): SqlDataset {
    const dataset = this.content.dataset(id);
    if (!dataset) throw new AppError('Dataset tidak ditemukan', 404, AppErrorCode.NOT_FOUND);
    return dataset;
  }

  private exerciseOrThrow(id: string): SqlExercise {
    const exercise = this.content.exercise(id);
    if (!exercise) throw new AppError('Latihan tidak ditemukan', 404, AppErrorCode.NOT_FOUND);
    return exercise;
  }
}
