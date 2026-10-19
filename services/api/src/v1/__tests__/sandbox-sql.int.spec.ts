import { Pool } from 'pg';
import { PrismaService } from '@/common/config/prisma/prisma.service';
import { AppError } from '@/common/lib/error';
import { createPool, databaseUrl, insertUser } from '@/test-utils/pg-fixtures';
import { SqlContentService } from '@/v1/sandbox/sql/sql-content.service';
import { GuardedStatement, guardSql } from '@/v1/sandbox/sql/sql-guard';
import { SqlPracticeService } from '@/v1/sandbox/sql/sql-practice.service';
import { MAX_CONCURRENT_RUNS, MAX_QUEUED_RUNS, ROWS_PER_STATEMENT, SqlRunnerService } from '@/v1/sandbox/sql/sql-runner.service';

const sandboxUrl = process.env.SANDBOX_DATABASE_URL;
const describeSandbox: typeof describe = (sandboxUrl ? describe : describe.skip) as typeof describe;
const describeBoth: typeof describe = (sandboxUrl && databaseUrl ? describe : describe.skip) as typeof describe;

const SLOW_QUERY = 'SELECT sum(n) FROM (SELECT generate_series(1, 5000000000) AS n) AS deret';
const content = new SqlContentService();
const setupSql = () => content.dataset('toko-online')!.setupSql;

const statements = (sql: string): GuardedStatement[] => {
  const guarded = guardSql(sql);
  if (!guarded.ok) throw new Error(guarded.message);
  return guarded.statements;
};

const raw = (sql: string, kind: GuardedStatement['kind'] = 'query'): GuardedStatement[] => [{ sql, kind, verb: sql.split(' ')[0].toLowerCase() }];

describeSandbox('SQL sandbox runner (requires SANDBOX_DATABASE_URL)', () => {
  let runner: SqlRunnerService;

  beforeAll(() => {
    runner = new SqlRunnerService();
  });

  afterAll(async () => {
    await runner.onModuleDestroy();
  });

  it('runs the reference answer of every exercise and gets the row count the content promises', async () => {
    for (const exercise of content.exercises()) {
      const outcome = await runner.run({ setupSql: setupSql(), statements: statements(exercise.referenceSql), verifySql: exercise.verifySql });
      expect({ id: exercise.id, error: outcome.error?.message ?? null }).toEqual({ id: exercise.id, error: null });
      const result = exercise.verifySql ? outcome.verify : outcome.outputs[outcome.outputs.length - 1];
      expect({ id: exercise.id, rows: result?.rows.length }).toEqual({ id: exercise.id, rows: exercise.expectedRowCount });
    }
  });

  it('returns columns, raw text values, NULL and booleans the way a learner expects to read them', async () => {
    const outcome = await runner.run({
      setupSql: setupSql(),
      statements: statements("SELECT 1 AS satu, 'a' AS huruf, NULL AS kosong, true AS benar, DATE '2025-06-20' AS tanggal, 2.50::numeric AS desimal"),
    });
    expect(outcome.error).toBeNull();
    expect(outcome.outputs[0].columns).toEqual(['satu', 'huruf', 'kosong', 'benar', 'tanggal', 'desimal']);
    expect(outcome.outputs[0].rows).toEqual([['1', 'a', null, 'true', '2025-06-20', '2.50']]);
  });

  it('keeps two columns with the same name apart', async () => {
    const outcome = await runner.run({
      setupSql: setupSql(),
      statements: statements('SELECT p.id, o.id FROM pelanggan p JOIN pesanan o ON o.pelanggan_id = p.id WHERE o.id = 1'),
    });
    expect(outcome.outputs[0].columns).toEqual(['id', 'id']);
    expect(outcome.outputs[0].rows).toEqual([['1', '1']]);
  });

  it('caps the rows of one statement and says so', async () => {
    const outcome = await runner.run({ setupSql: setupSql(), statements: statements('SELECT * FROM generate_series(1, 100000)') });
    expect(outcome.error).toBeNull();
    expect(outcome.outputs[0].rows).toHaveLength(ROWS_PER_STATEMENT);
    expect(outcome.outputs[0].truncated).toBe(true);
  });

  it('caps the rows a data changing statement returns', async () => {
    const outcome = await runner.run({
      setupSql: setupSql(),
      statements: statements('CREATE TABLE besar (n integer); INSERT INTO besar SELECT * FROM generate_series(1, 5000); UPDATE besar SET n = n + 1 RETURNING n'),
    });
    expect(outcome.error).toBeNull();
    const last = outcome.outputs[outcome.outputs.length - 1];
    expect(last.rows).toHaveLength(ROWS_PER_STATEMENT);
    expect(last.truncated).toBe(true);
    expect(last.rowCount).toBe(5000);
  });

  it('cuts a long cell', async () => {
    const outcome = await runner.run({ setupSql: setupSql(), statements: statements("SELECT repeat('x', 5000) AS panjang") });
    expect(outcome.outputs[0].rows[0][0]?.length).toBeLessThan(600);
  });

  it('forgets everything after a run, so the next learner starts from the same data', async () => {
    const first = await runner.run({
      setupSql: setupSql(),
      statements: statements("INSERT INTO pelanggan VALUES (99, 'Sementara', 'Bandung', '2025-01-01'); CREATE TABLE catatan (a int); SELECT count(*) FROM pelanggan"),
    });
    expect(first.outputs[2].rows).toEqual([['13']]);

    const second = await runner.run({ setupSql: setupSql(), statements: statements('SELECT count(*) FROM pelanggan') });
    expect(second.outputs[0].rows).toEqual([['12']]);
    const missing = await runner.run({ setupSql: setupSql(), statements: statements('SELECT * FROM catatan') });
    expect(missing.error?.code).toBe('42P01');
    expect(missing.error?.friendly).toMatch(/Tabel tidak ditemukan/);
  });

  it('keeps simultaneous runs apart', async () => {
    const outcomes = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        runner.run({ setupSql: setupSql(), statements: statements(`DELETE FROM detail_pesanan; DELETE FROM pesanan; DELETE FROM pelanggan WHERE id > ${index}; SELECT count(*) FROM pelanggan`) }),
      ),
    );
    expect(outcomes.map((outcome) => outcome.outputs[3].rows[0][0])).toEqual(['0', '1', '2', '3', '4', '5']);
  });

  it('answers a mistake with the position, the plain explanation and the PostgreSQL message', async () => {
    const outcome = await runner.run({ setupSql: setupSql(), statements: statements('SELECT nama FROM pelangan') });
    expect(outcome.error).toMatchObject({ code: '42P01', statementIndex: 0 });
    expect(outcome.error?.message).toContain('pelangan');
    expect(outcome.error?.message).not.toMatch(/play_[0-9a-f]+/);
    expect(outcome.error?.position).toBe(18);
  });

  it('keeps the outputs of the statements that ran before a failing one', async () => {
    const outcome = await runner.run({ setupSql: setupSql(), statements: statements('SELECT 1 AS a; SELECT * FROM tidak_ada; SELECT 3') });
    expect(outcome.outputs).toHaveLength(1);
    expect(outcome.error?.statementIndex).toBe(1);
  });

  it('explains a foreign key violation', async () => {
    const outcome = await runner.run({ setupSql: setupSql(), statements: statements("DELETE FROM pesanan WHERE status = 'batal'") });
    expect(outcome.error?.code).toBe('23503');
    expect(outcome.error?.friendly).toMatch(/kunci asing/);
  });

  it('stops a statement that runs too long', async () => {
    const startedAt = Date.now();
    const outcome = await runner.run({ setupSql: setupSql(), statements: statements(SLOW_QUERY) });
    expect(outcome.error?.code).toBe('57014');
    expect(outcome.error?.friendly).toMatch(/batas waktu/);
    expect(Date.now() - startedAt).toBeLessThan(5000);
  });

  it('stops a statement that needs more temporary space than the role may use', async () => {
    const outcome = await runner.run({ setupSql: setupSql(), statements: statements('SELECT count(*) FROM generate_series(1, 5000000000)') });
    expect(outcome.error?.code).toBe('53400');
    expect(outcome.error?.friendly).toMatch(/terlalu besar/);
  });

  it('stops at the first statement that runs out of time', async () => {
    const slow = SLOW_QUERY;
    const startedAt = Date.now();
    const outcome = await runner.run({ setupSql: setupSql(), statements: statements(`${slow}; ${slow}; ${slow}`) });
    expect(outcome.error?.code).toBe('57014');
    expect(outcome.error?.statementIndex).toBe(0);
    expect(Date.now() - startedAt).toBeLessThan(5000);
  });

  describe('the database role, even if the guard were bypassed', () => {
    const denied = async (sql: string) => {
      const outcome = await runner.run({ setupSql: setupSql(), statements: raw(sql, sql.toLowerCase().startsWith('select') ? 'query' : 'command') });
      return outcome.error;
    };

    it('cannot write outside its own schema', async () => {
      expect((await denied('CREATE TABLE public.leak (a int)'))?.code).toBe('42501');
    });

    it('cannot read files, passwords or other sessions', async () => {
      expect((await denied("SELECT pg_read_file('/etc/passwd')"))?.code).toBe('42501');
      expect((await denied('SELECT * FROM pg_authid'))?.code).toBe('42501');
      expect((await denied('SELECT query FROM pg_stat_activity'))?.code).toBe('42501');
    });

    it('cannot create roles or raise its own privileges', async () => {
      expect((await denied('CREATE ROLE intruder LOGIN'))?.code).toBe('42501');
      expect((await denied('ALTER ROLE sandbox_runner SUPERUSER'))?.code).toBe('42501');
    });

    it('refuses a second statement hidden in one message, through the protocol and not only the guard', async () => {
      const smuggled = await runner.run({ setupSql: setupSql(), statements: raw('SELECT 1; CREATE TABLE tersembunyi (a int)', 'command') });
      expect(smuggled.error?.code).toBe('42601');
      expect(smuggled.error?.message).toMatch(/multiple commands/);
      const inCursor = await runner.run({ setupSql: setupSql(), statements: raw('SELECT 1; DROP TABLE pelanggan') });
      expect(inCursor.error?.code).toBe('42601');
      const after = await runner.run({ setupSql: setupSql(), statements: statements('SELECT count(*) FROM pelanggan') });
      expect(after.outputs[0].rows).toEqual([['12']]);
    });

    it('starts with the limits the init script set', async () => {
      const outcome = await runner.run({
        setupSql: setupSql(),
        statements: statements("SELECT current_setting('lock_timeout') AS a, current_setting('temp_file_limit') AS b, current_setting('work_mem') AS c, current_user AS d"),
      });
      expect(outcome.outputs[0].rows).toEqual([['1s', '32MB', '4MB', 'sandbox_runner']]);
    });
  });

  describe('the watchdog', () => {
    it('ends a backend that outlives the time budget', async () => {
      const watched = new SqlRunnerService();
      watched.watchdogMs = 700;
      const startedAt = Date.now();
      const error = await watched
        .run({ setupSql: setupSql(), statements: statements(SLOW_QUERY) })
        .then(() => null, (failure: unknown) => failure as AppError);
      expect(error).toBeInstanceOf(AppError);
      expect(error?.statusCode).toBe(503);
      expect(error?.message).toMatch(/batas waktu total/);
      expect(Date.now() - startedAt).toBeLessThan(2400);
      const next = await watched.run({ setupSql: setupSql(), statements: statements('SELECT 1') });
      expect(next.error).toBeNull();
      await watched.onModuleDestroy();
    });
  });

  describe('the queue', () => {
    it('queues a few runs and turns the rest away', async () => {
      const slow = 'SELECT count(*) FROM generate_series(1, 5000000)';
      const total = MAX_CONCURRENT_RUNS + MAX_QUEUED_RUNS + 1;
      const settled = await Promise.allSettled(Array.from({ length: total }, () => runner.run({ setupSql: setupSql(), statements: statements(slow) })));
      const turnedAway = settled.filter((result) => result.status === 'rejected');
      expect(turnedAway).toHaveLength(1);
      expect(((turnedAway[0] as PromiseRejectedResult).reason as AppError).statusCode).toBe(429);
      expect(settled.filter((result) => result.status === 'fulfilled')).toHaveLength(total - 1);
    }, 60_000);
  });
});

describe('SQL sandbox runner without a configured database', () => {
  it('answers 503 and does not crash', async () => {
    const previous = process.env.SANDBOX_DATABASE_URL;
    delete process.env.SANDBOX_DATABASE_URL;
    try {
      const runner = new SqlRunnerService();
      expect(runner.isConfigured()).toBe(false);
      const error = await runner.run({ setupSql: 'SELECT 1', statements: statements('SELECT 1') }).then(() => null, (failure: unknown) => failure as AppError);
      expect(error?.statusCode).toBe(503);
    } finally {
      if (previous !== undefined) process.env.SANDBOX_DATABASE_URL = previous;
    }
  });
});

describeBoth('SQL practice (requires TEST_DATABASE_URL and SANDBOX_DATABASE_URL)', () => {
  let prisma: PrismaService;
  let pool: Pool;
  let runner: SqlRunnerService;
  let service: SqlPracticeService;
  const users: string[] = [];

  const learner = async () => {
    const id = await insertUser(pool);
    users.push(id);
    return id;
  };

  const reference = (id: string) => content.exercise(id)!.referenceSql;
  const errorOf = async (work: Promise<unknown>) => (await work.then(() => null, (failure: unknown) => failure)) as AppError | null;

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    prisma = new PrismaService();
    pool = createPool();
    runner = new SqlRunnerService();
    service = new SqlPracticeService(prisma, content, runner);
  });

  afterAll(async () => {
    if (users.length > 0) await pool.query('DELETE FROM "User" WHERE id = ANY($1)', [users]);
    await runner.onModuleDestroy();
    await prisma.$disconnect();
    await pool.end();
  });

  it('lists the course with the exercises and the learner progress', async () => {
    const userId = await learner();
    const catalog = await service.catalog(userId);
    expect(catalog.available).toBe(true);
    expect(catalog.datasets[0].tables.map((table) => table.name)).toEqual(['pelanggan', 'produk', 'pesanan', 'detail_pesanan']);
    expect(catalog.exercises.length).toBe(content.exercises().length);
    expect(catalog.exercises.every((exercise) => exercise.progress.status === 'NEW')).toBe(true);
    expect(catalog.exercises[0]).not.toHaveProperty('referenceSql');
    expect(catalog.exercises[0]).not.toHaveProperty('hints');
    expect(catalog.summary).toEqual({ solved: 0, total: content.exercises().length });
  });

  it('marks a correct answer as solved once and keeps it solved after a wrong retry', async () => {
    const userId = await learner();
    const first = await service.check(userId, 'sql-pelanggan-bandung', { sql: reference('sql-pelanggan-bandung') });
    expect(first).toMatchObject({ correct: true, verdict: 'MATCH' });
    expect(first.progress).toMatchObject({ status: 'SOLVED', attempts: 1 });
    expect(first.explanation).toBeTruthy();

    const retry = await service.check(userId, 'sql-pelanggan-bandung', { sql: "SELECT nama, kota FROM pelanggan WHERE kota = 'Jakarta'" });
    expect(retry.correct).toBe(false);
    expect(retry.progress).toMatchObject({ status: 'SOLVED', attempts: 2 });
    expect(retry.progress.lastSql).toContain('Jakarta');
  });

  it('accepts another correct way of writing the answer', async () => {
    const userId = await learner();
    const columnsSwapped = await service.check(userId, 'sql-pelanggan-bandung', { sql: "select kota, nama from pelanggan where kota like 'Band%'" });
    expect(columnsSwapped).toMatchObject({ correct: false, verdict: 'VALUES' });
    const swapped = await service.check(userId, 'sql-pelanggan-bandung', { sql: "select nama, kota from pelanggan where kota ilike 'bandung'" });
    expect(swapped.correct).toBe(true);
  });

  it('judges the order only where the task asks for one', async () => {
    const userId = await learner();
    const wrongOrder = await service.check(userId, 'sql-produk-mahal', { sql: 'SELECT nama, harga FROM produk WHERE harga > 200000 ORDER BY harga' });
    expect(wrongOrder).toMatchObject({ correct: false, verdict: 'ORDER' });
    const freeOrder = await service.check(userId, 'sql-pelanggan-bandung', { sql: "SELECT nama, kota FROM pelanggan WHERE kota = 'Bandung' ORDER BY nama DESC" });
    expect(freeOrder.correct).toBe(true);
  });

  it('accepts a rounded average for the numeric answer', async () => {
    const userId = await learner();
    const result = await service.check(userId, 'sql-agregat-produk', { sql: 'SELECT COUNT(*), ROUND(AVG(harga)) FROM produk' });
    expect(result.correct).toBe(true);
  });

  it('refuses a statement the guard does not allow without counting an attempt', async () => {
    const userId = await learner();
    const result = await service.check(userId, 'sql-pelanggan-bandung', { sql: "SELECT set_config('statement_timeout', '0', false)" });
    expect(result).toMatchObject({ correct: false, verdict: 'REJECTED' });
    expect(result.progress.attempts).toBe(0);
    expect((await service.catalog(userId)).summary.solved).toBe(0);
  });

  it('counts a statement that fails to run as an attempt and explains it', async () => {
    const userId = await learner();
    const result = await service.check(userId, 'sql-pelanggan-bandung', { sql: 'SELECT nama FORM pelanggan' });
    expect(result).toMatchObject({ correct: false, verdict: 'ERROR' });
    expect(result.error?.code).toBe('42601');
    expect(result.progress.attempts).toBe(1);
  });

  it('checks a change to the data by looking at the table afterwards', async () => {
    const userId = await learner();
    const wrong = await service.check(userId, 'sql-update-aksesori', { sql: 'UPDATE produk SET harga = harga * 11 / 10' });
    expect(wrong).toMatchObject({ correct: false, verdict: 'VALUES' });
    const right = await service.check(userId, 'sql-update-aksesori', { sql: "UPDATE produk SET harga = harga + harga / 10 WHERE kategori = 'Aksesori'" });
    expect(right.correct).toBe(true);
    const none = await service.check(userId, 'sql-insert-pelanggan', { sql: "SELECT * FROM pelanggan WHERE id = 13" });
    expect(none).toMatchObject({ correct: false });
  });

  it('teaches the order of deletion through the foreign key', async () => {
    const userId = await learner();
    const wrongOrder = await service.check(userId, 'sql-delete-batal', { sql: "DELETE FROM pesanan WHERE status = 'batal'; DELETE FROM detail_pesanan WHERE pesanan_id IN (6, 14)" });
    expect(wrongOrder).toMatchObject({ correct: false, verdict: 'ERROR' });
    expect(wrongOrder.error?.code).toBe('23503');
    const right = await service.check(userId, 'sql-delete-batal', { sql: reference('sql-delete-batal') });
    expect(right.correct).toBe(true);
  });

  it('accepts a table design written another way and refuses one with a missing rule', async () => {
    const userId = await learner();
    const loose = await service.check(userId, 'sql-create-ulasan', {
      sql: 'CREATE TABLE ulasan (id serial PRIMARY KEY, pelanggan_id int NOT NULL REFERENCES pelanggan(id), produk_id int NOT NULL, nilai int NOT NULL, komentar varchar(200), FOREIGN KEY (produk_id) REFERENCES produk(id), CHECK (nilai >= 1 AND nilai <= 5))',
    });
    expect(loose.correct).toBe(true);
    const missingCheck = await service.check(userId, 'sql-create-ulasan', {
      sql: 'CREATE TABLE ulasan (id integer PRIMARY KEY, pelanggan_id integer NOT NULL REFERENCES pelanggan (id), produk_id integer NOT NULL REFERENCES produk (id), nilai integer NOT NULL, komentar text)',
    });
    expect(missingCheck).toMatchObject({ correct: false, verdict: 'ROW_COUNT' });
    const notCreated = await service.check(userId, 'sql-create-ulasan', { sql: 'SELECT 1' });
    expect(notCreated.correct).toBe(false);
  });

  it('opens hints one at a time and only after the learner has tried', async () => {
    const userId = await learner();
    const exercise = content.exercise('sql-pelanggan-bandung')!;

    const first = await service.hint(userId, exercise.id);
    expect(first).toMatchObject({ hintLevel: 1, hints: [exercise.hints[0]], notice: null });

    const locked = await service.hint(userId, exercise.id);
    expect(locked.hintLevel).toBe(1);
    expect(locked.notice).toMatch(/diperiksa/);

    await service.check(userId, exercise.id, { sql: 'SELECT 1' });
    const second = await service.hint(userId, exercise.id);
    expect(second.hints).toEqual(exercise.hints.slice(0, 2));

    await service.check(userId, exercise.id, { sql: 'SELECT 2' });
    const third = await service.hint(userId, exercise.id);
    expect(third.hints).toEqual(exercise.hints);
    expect((await service.hint(userId, exercise.id)).notice).toMatch(/Semua petunjuk/);

    const catalog = await service.catalog(userId);
    expect(catalog.exercises.find((item) => item.id === exercise.id)?.progress.hints).toEqual(exercise.hints);
  });

  it('shows the reference answer only after an attempt', async () => {
    const userId = await learner();
    const before = await errorOf(service.reveal(userId, 'sql-kota-unik'));
    expect(before?.statusCode).toBe(409);

    await service.check(userId, 'sql-kota-unik', { sql: 'SELECT 1' });
    const revealed = await service.reveal(userId, 'sql-kota-unik');
    expect(revealed.referenceSql).toBe(reference('sql-kota-unik'));
    const catalog = await service.catalog(userId);
    expect(catalog.exercises.find((item) => item.id === 'sql-kota-unik')?.progress).toMatchObject({ revealed: true, status: 'IN_PROGRESS' });
  });

  it('keeps the progress of one learner away from another', async () => {
    const [a, b] = [await learner(), await learner()];
    await service.check(a, 'sql-nama-awalan-s', { sql: reference('sql-nama-awalan-s') });
    expect((await service.catalog(a)).summary.solved).toBe(1);
    expect((await service.catalog(b)).summary.solved).toBe(0);
  });

  it('never puts a message or data key at the top of a payload, where the response wrapper would take it', async () => {
    const userId = await learner();
    const payloads = [
      await service.catalog(userId),
      await service.run({ datasetId: 'toko-online', sql: 'SELECT 1' }),
      await service.run({ datasetId: 'toko-online', sql: 'COMMIT' }),
      await service.check(userId, 'sql-kota-unik', { sql: 'SELECT 1' }),
      await service.check(userId, 'sql-kota-unik', { sql: 'COMMIT' }),
      await service.hint(userId, 'sql-kota-unik'),
      await service.hint(userId, 'sql-kota-unik'),
      await service.reveal(userId, 'sql-kota-unik'),
    ];
    for (const payload of payloads) {
      expect(payload).not.toHaveProperty('message');
      expect(payload).not.toHaveProperty('data');
    }
  });

  it('answers 404 for an unknown exercise or dataset', async () => {
    const userId = await learner();
    expect((await errorOf(service.check(userId, 'tidak-ada', { sql: 'SELECT 1' })))?.statusCode).toBe(404);
    expect((await errorOf(service.hint(userId, 'tidak-ada')))?.statusCode).toBe(404);
    expect((await errorOf(service.reveal(userId, 'tidak-ada')))?.statusCode).toBe(404);
    expect((await errorOf(service.run({ datasetId: 'tidak-ada', sql: 'SELECT 1' })))?.statusCode).toBe(404);
  });

  it('runs free SQL on a dataset and refuses what the guard refuses', async () => {
    const ok = await service.run({ datasetId: 'toko-online', sql: 'SELECT COUNT(*) FROM pelanggan' });
    expect(ok).toMatchObject({ accepted: true, error: null });
    expect(ok.outputs[0].rows).toEqual([['12']]);
    const refused = await service.run({ datasetId: 'toko-online', sql: 'COMMIT' });
    expect(refused).toMatchObject({ accepted: false, outputs: [] });
  });
});
