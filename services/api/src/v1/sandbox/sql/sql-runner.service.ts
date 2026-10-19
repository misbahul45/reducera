import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { Client, CustomTypesConfig, Pool, PoolClient, Query, QueryResult } from 'pg';
import { AppError, AppErrorCode } from '@/common/lib/error';
import { Cell } from './sql-compare';
import { describeSqlError, SqlErrorView, VERIFY_FAILED } from './sql-errors';
import { GuardedStatement, StatementKind } from './sql-guard';

export const STATEMENT_TIMEOUT_MS = 2500;
export const TOTAL_BUDGET_MS = 6000;
export const WATCHDOG_MS = TOTAL_BUDGET_MS + 3000;
export const ROWS_PER_STATEMENT = 200;
export const ROWS_PER_RUN = 500;
export const CELL_LIMIT = 500;
export const MAX_CONCURRENT_RUNS = 4;
export const MAX_QUEUED_RUNS = 8;

const BOOLEAN_OID = 16;
const CURSOR = 'sandbox_cursor';
const CURSOR_PREFIX = `DECLARE ${CURSOR} NO SCROLL CURSOR FOR `;
const TIMEOUT_SQLSTATE = '57014';

const rawTypes: CustomTypesConfig = {
  getTypeParser: ((oid: number) => (oid === BOOLEAN_OID ? (value: string) => (value === 't' ? 'true' : 'false') : (value: string) => value)) as CustomTypesConfig['getTypeParser'],
};

export interface StatementOutput {
  sql: string;
  verb: string;
  kind: StatementKind;
  columns: string[];
  rows: Cell[][];
  rowCount: number | null;
  truncated: boolean;
  elapsedMs: number;
}

export interface RunRequest {
  setupSql: string;
  statements: GuardedStatement[];
  verifySql?: string;
}

export interface RunOutcome {
  outputs: StatementOutput[];
  verify: StatementOutput | null;
  error: (SqlErrorView & { statementIndex: number }) | null;
}

interface Execution {
  columns: string[];
  rows: Cell[][];
  total: number;
  rowCount: number | null;
}

class Gate {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(
    private readonly limit: number,
    private readonly maxQueue: number,
  ) {}

  async enter(): Promise<boolean> {
    if (this.active < this.limit) {
      this.active += 1;
      return true;
    }
    if (this.waiting.length >= this.maxQueue) return false;
    await new Promise<void>((resolve) => this.waiting.push(resolve));
    return true;
  }

  leave(): void {
    const next = this.waiting.shift();
    if (next) next();
    else this.active -= 1;
  }
}

const unavailable = () => new AppError('Sandbox SQL sedang tidak tersedia. Coba lagi sebentar lagi.', 503, AppErrorCode.SERVICE_UNAVAILABLE);

const isServerError = (error: unknown): error is { code: string; severity: string; message: string } => {
  const candidate = error as { code?: unknown; severity?: unknown } | null;
  return (
    !!candidate &&
    typeof candidate.code === 'string' &&
    typeof candidate.severity === 'string' &&
    candidate.severity !== 'FATAL' &&
    candidate.severity !== 'PANIC'
  );
};

const clip = (cell: Cell): Cell => (cell !== null && cell.length > CELL_LIMIT ? `${cell.slice(0, CELL_LIMIT)}…` : cell);

@Injectable()
export class SqlRunnerService implements OnModuleDestroy {
  private readonly logger = new Logger(SqlRunnerService.name);
  private readonly gate = new Gate(MAX_CONCURRENT_RUNS, MAX_QUEUED_RUNS);
  private pool: Pool | null = null;
  watchdogMs = WATCHDOG_MS;

  async onModuleDestroy(): Promise<void> {
    await this.pool?.end().catch(() => undefined);
  }

  isConfigured(): boolean {
    return !!process.env.SANDBOX_DATABASE_URL;
  }

  async run(request: RunRequest): Promise<RunOutcome> {
    const pool = this.poolOrThrow();
    const entered = await this.gate.enter();
    if (!entered) throw new AppError('Sandbox SQL sedang ramai. Coba lagi sebentar lagi.', 429, AppErrorCode.TOO_MANY_REQUESTS);

    let client: PoolClient | null = null;
    let discard = false;
    let watchdog: NodeJS.Timeout | null = null;
    let killed = false;
    try {
      client = await pool.connect();
      const processId = (client as unknown as { processID?: number }).processID;
      watchdog = setTimeout(() => {
        killed = true;
        void this.terminate(processId);
      }, this.watchdogMs);
      return await this.play(client, request);
    } catch (error) {
      if (error instanceof AppError) throw error;
      discard = true;
      if (killed) throw new AppError('Eksekusi melebihi batas waktu total. Sederhanakan SQL Anda.', 503, AppErrorCode.SERVICE_UNAVAILABLE);
      this.logger.warn(`The SQL sandbox run failed: ${(error as Error).message}`);
      throw unavailable();
    } finally {
      if (watchdog) clearTimeout(watchdog);
      if (client) {
        await client.query('ROLLBACK').catch(() => {
          discard = true;
        });
        client.release(discard);
      }
      this.gate.leave();
    }
  }

  private async terminate(processId: number | undefined): Promise<void> {
    const connectionString = process.env.SANDBOX_DATABASE_URL;
    if (!connectionString || !processId) return;
    const killer = new Client({ connectionString, connectionTimeoutMillis: 1000, application_name: 'reducera-sandbox-watchdog' });
    try {
      await killer.connect();
      await killer.query('SELECT pg_terminate_backend($1)', [processId]);
    } catch (error) {
      this.logger.warn(`The SQL sandbox watchdog could not end backend ${processId}: ${(error as Error).message}`);
    } finally {
      await killer.end().catch(() => undefined);
    }
  }

  private poolOrThrow(): Pool {
    if (this.pool) return this.pool;
    const connectionString = process.env.SANDBOX_DATABASE_URL;
    if (!connectionString) throw unavailable();
    this.pool = new Pool({
      connectionString,
      max: MAX_CONCURRENT_RUNS,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 2000,
      application_name: 'reducera-sandbox',
    });
    this.pool.on('error', (error) => this.logger.warn(`An idle SQL sandbox connection failed: ${error.message}`));
    this.pool.on('connect', (client) => {
      client.on('error', (error) => this.logger.warn(`A SQL sandbox connection failed: ${error.message}`));
    });
    return this.pool;
  }

  private async play(client: PoolClient, request: RunRequest): Promise<RunOutcome> {
    const deadline = Date.now() + TOTAL_BUDGET_MS;
    const schema = `play_${randomBytes(6).toString('hex')}`;
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET LOCAL search_path = ${schema}`);
    await client.query(request.setupSql);

    const outputs: StatementOutput[] = [];
    let rowsLeft = ROWS_PER_RUN;
    const sequence = [...request.statements, ...(request.verifySql ? [{ sql: request.verifySql, kind: 'query' as const, verb: 'select' }] : [])];

    for (let index = 0; index < sequence.length; index += 1) {
      const statement = sequence[index];
      try {
        const output = await this.runStatement(client, statement, deadline, Math.min(ROWS_PER_STATEMENT, Math.max(rowsLeft, 1)));
        rowsLeft -= output.rows.length;
        outputs.push(output);
      } catch (error) {
        if (!isServerError(error)) throw error;
        const learnerOwned = index < request.statements.length;
        const offset = learnerOwned && statement.kind === 'query' ? CURSOR_PREFIX.length : 0;
        const view = learnerOwned ? describeSqlError(error, schema, offset) : VERIFY_FAILED;
        return {
          outputs: outputs.slice(0, request.statements.length),
          verify: null,
          error: { ...view, statementIndex: Math.min(index, request.statements.length - 1) },
        };
      }
    }

    const verify = request.verifySql ? (outputs[request.statements.length] ?? null) : null;
    return { outputs: outputs.slice(0, request.statements.length), verify, error: null };
  }

  private async runStatement(client: PoolClient, statement: GuardedStatement, deadline: number, rowCap: number): Promise<StatementOutput> {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw { code: TIMEOUT_SQLSTATE, severity: 'ERROR', message: 'total execution time exceeded' };
    await client.query(`SET LOCAL statement_timeout = ${Math.max(50, Math.min(STATEMENT_TIMEOUT_MS, remaining))}`);

    const startedAt = Date.now();
    let execution: Execution;
    if (statement.kind === 'query') {
      await this.execute(client, `${CURSOR_PREFIX}${statement.sql}`, 0);
      execution = await this.execute(client, `FETCH ${rowCap + 1} FROM ${CURSOR}`, rowCap);
      await this.execute(client, `CLOSE ${CURSOR}`, 0);
    } else {
      execution = await this.execute(client, statement.sql, rowCap);
    }

    return {
      sql: statement.sql,
      verb: statement.verb,
      kind: statement.kind,
      columns: execution.columns,
      rows: execution.rows,
      rowCount: statement.kind === 'query' ? Math.min(execution.total, rowCap) : execution.rowCount,
      truncated: execution.total > rowCap,
      elapsedMs: Date.now() - startedAt,
    };
  }

  private execute(client: PoolClient, text: string, rowCap: number): Promise<Execution> {
    return new Promise<Execution>((resolve, reject) => {
      const rows: Cell[][] = [];
      let total = 0;
      const query = new Query({ text, rowMode: 'array', types: rawTypes, queryMode: 'extended' } as ConstructorParameters<typeof Query>[0]);
      query.on('row', (row: Cell[]) => {
        total += 1;
        if (rows.length < rowCap) rows.push(row.map(clip));
      });
      query.on('end', (result: QueryResult) => {
        resolve({ columns: (result.fields ?? []).map((field) => field.name), rows, total, rowCount: result.rowCount });
      });
      query.on('error', reject);
      client.query(query);
    });
  }
}
