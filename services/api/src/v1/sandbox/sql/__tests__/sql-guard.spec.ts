import { MAX_SQL_LENGTH, MAX_STATEMENTS, guardSql } from '../sql-guard';

const accepted = (sql: string) => {
  const result = guardSql(sql);
  if (!result.ok) throw new Error(`Expected acceptance but got: ${result.message}`);
  return result.statements;
};

const rejected = (sql: string) => {
  const result = guardSql(sql);
  if (result.ok) throw new Error(`Expected rejection of: ${sql}`);
  return result;
};

describe('guardSql', () => {
  describe('what a learner may run', () => {
    it.each([
      ['SELECT * FROM pelanggan', 'query', 'select'],
      ['  select nama from pelanggan where kota = \'Bandung\';  ', 'query', 'select'],
      ['WITH x AS (SELECT 1) SELECT * FROM x', 'query', 'with'],
      ['VALUES (1), (2)', 'query', 'values'],
      ['TABLE pelanggan', 'query', 'table'],
      ["INSERT INTO pelanggan (id, nama, kota, tanggal_daftar) VALUES (13, 'Lina', 'Bandung', '2025-06-20')", 'command', 'insert'],
      ['UPDATE produk SET harga = harga * 11 / 10 WHERE kategori = \'Aksesori\'', 'command', 'update'],
      ['DELETE FROM pesanan WHERE status = \'batal\'', 'command', 'delete'],
      ['CREATE TABLE ulasan (id integer PRIMARY KEY)', 'command', 'create'],
      ['CREATE UNIQUE INDEX idx ON pelanggan (nama)', 'command', 'create'],
      ['CREATE INDEX idx ON pelanggan (kota)', 'command', 'create'],
      ['CREATE OR REPLACE VIEW v AS SELECT 1', 'command', 'create'],
      ['ALTER TABLE pelanggan ADD COLUMN email text', 'command', 'alter'],
      ['DROP TABLE IF EXISTS ulasan', 'command', 'drop'],
      ['DROP VIEW v', 'command', 'drop'],
      ['TRUNCATE detail_pesanan', 'command', 'truncate'],
      ['EXPLAIN SELECT * FROM produk', 'command', 'explain'],
      ['EXPLAIN (ANALYZE, VERBOSE) DELETE FROM pesanan', 'command', 'explain'],
      ['EXPLAIN ANALYZE VERBOSE SELECT 1', 'command', 'explain'],
    ])('accepts %s', (sql, kind, verb) => {
      const [statement] = accepted(sql);
      expect(statement.kind).toBe(kind);
      expect(statement.verb).toBe(verb);
    });

    it('treats a WITH that modifies data as a command and a SELECT INTO as a command', () => {
      expect(accepted('WITH gone AS (DELETE FROM pesanan RETURNING id) SELECT count(*) FROM gone')[0].kind).toBe('command');
      expect(accepted('SELECT * INTO salinan FROM pelanggan')[0].kind).toBe('command');
      expect(accepted('SELECT * FROM pelanggan WHERE nama = \'into\'')[0].kind).toBe('query');
    });

    it('splits statements and drops empty ones', () => {
      const statements = accepted('DELETE FROM a; ; DELETE FROM b;;');
      expect(statements.map((statement) => statement.sql)).toEqual(['DELETE FROM a', 'DELETE FROM b']);
    });

    it('keeps a semicolon inside a string literal', () => {
      const statements = accepted("SELECT 'a;b' AS teks; SELECT 2");
      expect(statements).toHaveLength(2);
      expect(statements[0].sql).toBe("SELECT 'a;b' AS teks");
    });

    it('keeps escaped quotes inside a string literal', () => {
      expect(accepted("SELECT 'it''s; fine'")).toHaveLength(1);
      expect(accepted("SELECT E'it\\'s; fine'")).toHaveLength(1);
    });

    it('strips line and nested block comments from the statement it sends', () => {
      const statements = accepted('SELECT 1 -- comment; DROP TABLE x\n, 2 /* a /* nested; */ still comment */ FROM pelanggan');
      expect(statements).toHaveLength(1);
      expect(statements[0].sql).not.toContain('comment');
      expect(statements[0].sql).toContain('FROM pelanggan');
    });

    it('does not read a keyword inside a string literal as a denied name', () => {
      expect(accepted("SELECT 'set_config' AS nama")).toHaveLength(1);
      expect(accepted("SELECT * FROM pelanggan WHERE nama = 'pg_sleep'")).toHaveLength(1);
    });

    it('allows the catalogs a lesson on table design needs', () => {
      expect(accepted("SELECT column_name FROM information_schema.columns WHERE table_name = 'produk'")).toHaveLength(1);
      expect(accepted('SELECT conname FROM pg_catalog.pg_constraint')).toHaveLength(1);
      expect(accepted('SELECT relname FROM pg_class')).toHaveLength(1);
    });
  });

  describe('what it refuses', () => {
    it.each([
      ['COMMIT'],
      ['ROLLBACK'],
      ['BEGIN'],
      ['SAVEPOINT a'],
      ['SET statement_timeout = 0'],
      ['SET search_path = public'],
      ['RESET ALL'],
      ['SHOW all'],
      ['COPY pelanggan TO PROGRAM \'id\''],
      ['DO $$ BEGIN END $$'],
      ['CALL p()'],
      ['GRANT ALL ON pelanggan TO PUBLIC'],
      ['REVOKE ALL ON pelanggan FROM PUBLIC'],
      ['VACUUM'],
      ['ANALYZE'],
      ['LISTEN a'],
      ['NOTIFY a'],
      ['PREPARE p AS SELECT 1'],
      ['EXECUTE p'],
      ['DECLARE c CURSOR FOR SELECT 1'],
      ['FETCH 1 FROM c'],
      ['LOCK TABLE pelanggan'],
      ['MERGE INTO a USING b ON true WHEN MATCHED THEN DELETE'],
      ['LOAD \'x\''],
      ['IMPORT FOREIGN SCHEMA s FROM SERVER x INTO y'],
    ])('refuses %s', (sql) => {
      expect(rejected(sql).message).toMatch(/tidak tersedia/);
    });

    it.each([
      ['CREATE EXTENSION pgcrypto'],
      ['CREATE FUNCTION f() RETURNS int AS \'select 1\' LANGUAGE sql'],
      ['CREATE ROLE x LOGIN'],
      ['CREATE SCHEMA other'],
      ['CREATE DATABASE other'],
      ['CREATE TRIGGER t BEFORE INSERT ON a FOR EACH ROW EXECUTE FUNCTION f()'],
      ['CREATE SERVER s FOREIGN DATA WRAPPER w'],
      ['ALTER ROLE sandbox_runner SET statement_timeout = 0'],
      ['ALTER SYSTEM SET work_mem = \'1GB\''],
      ['ALTER DATABASE sandbox SET x = 1'],
      ['DROP SCHEMA public CASCADE'],
      ['DROP ROLE x'],
      ['DROP EXTENSION pgcrypto'],
      ['EXPLAIN CREATE TABLE a (b int)'],
    ])('refuses the unsupported form %s', (sql) => {
      expect(rejected(sql).ok).toBe(false);
    });

    it.each([
      ["SELECT set_config('statement_timeout', '0', false)"],
      ["SELECT pg_catalog.set_config('statement_timeout', '0', false)"],
      ['SELECT "set_config"(\'a\', \'b\', false)'],
      ['SELECT SET_CONFIG(\'a\', \'b\', false)'],
      ['SELECT pg_sleep(10)'],
      ['SELECT pg_sleep_for(\'1 minute\')'],
      ['SELECT pg_terminate_backend(1)'],
      ['SELECT pg_cancel_backend(1)'],
      ['SELECT pg_reload_conf()'],
      ["SELECT pg_read_file('/etc/passwd')"],
      ["SELECT pg_read_binary_file('/etc/passwd')"],
      ["SELECT * FROM pg_ls_dir('/')"],
      ["SELECT pg_stat_file('/etc/passwd')"],
      ['SELECT pg_advisory_lock(1)'],
      ["SELECT pg_notify('a', 'b')"],
      ["SELECT lo_import('/etc/passwd')"],
      ["SELECT lo_export(1, '/tmp/x')"],
      ["SELECT query_to_xml('select set_config(1,2,3)', true, true, '')"],
      ["SELECT cursor_to_xml('c', 1, true, true, '')"],
      ["SELECT table_to_xml('pg_authid', true, true, '')"],
      ["SELECT * FROM ts_stat('select 1')"],
      ["SELECT * FROM dblink('x', 'select 1') AS t(a int)"],
      ['SELECT * FROM pg_authid'],
      ['SELECT * FROM pg_catalog.pg_shadow'],
      ['SELECT * FROM pg_stat_activity'],
      ['SELECT * FROM "pg_authid"'],
      ['SELECT * FROM pg_hba_file_rules'],
      ['SELECT * FROM pg_largeobject'],
    ])('refuses the system object in %s', (sql) => {
      expect(rejected(sql).message).toMatch(/tidak tersedia/);
    });

    it('refuses dollar quoting and the dollar sign anywhere outside a literal', () => {
      expect(rejected('SELECT $$a$$').message).toMatch(/dolar/);
      expect(rejected('SELECT $tag$a$tag$').message).toMatch(/dolar/);
      expect(rejected('SELECT $1').message).toMatch(/dolar/);
      expect(accepted("SELECT '$$ still text'")).toHaveLength(1);
    });

    it('refuses unicode escaped identifiers that could spell a denied name', () => {
      expect(rejected('SELECT U&"\\0070g_sleep"(1)').message).toMatch(/Unicode/);
      expect(rejected('SELECT u&"x"').message).toMatch(/Unicode/);
    });

    it('refuses unterminated quotes and comments', () => {
      expect(rejected("SELECT 'abc").message).toMatch(/kutip tunggal/);
      expect(rejected('SELECT "abc').message).toMatch(/kutip ganda/);
      expect(rejected('SELECT 1 /* abc').message).toMatch(/Komentar blok/);
      expect(rejected("SELECT 'a\\'; DROP SCHEMA public CASCADE; --'").ok).toBe(false);
    });

    it('does not let a backslash hide a quote in a plain string, as PostgreSQL does not', () => {
      const statements = accepted("SELECT 'a\\'; SELECT 2");
      expect(statements).toHaveLength(2);
    });

    it('reads an escape string as one literal, as PostgreSQL does, so nothing can be smuggled out of it or into it', () => {
      const statements = accepted("SELECT E'a\\'; SELECT pg_sleep(9); --'");
      expect(statements).toHaveLength(1);
      expect(rejected("SELECT E'a'; SELECT pg_sleep(9)").message).toMatch(/tidak tersedia/);
    });

    it('refuses empty input, comment-only input and null characters', () => {
      expect(rejected('').message).toMatch(/Tuliskan/);
      expect(rejected('   ;; ').message).toMatch(/Tuliskan/);
      expect(rejected('-- hanya komentar').message).toMatch(/Tuliskan/);
      expect(rejected('SELECT 1\u0000').message).toMatch(/tidak valid/);
    });

    it('limits the length and the number of statements', () => {
      expect(rejected(`SELECT '${'a'.repeat(MAX_SQL_LENGTH)}'`).message).toMatch(/terlalu panjang/);
      expect(accepted(Array.from({ length: MAX_STATEMENTS }, () => 'SELECT 1').join(';'))).toHaveLength(MAX_STATEMENTS);
      expect(rejected(Array.from({ length: MAX_STATEMENTS + 1 }, () => 'SELECT 1').join(';')).message).toMatch(/Terlalu banyak/);
    });

    it('reports which statement was refused', () => {
      const result = rejected('SELECT 1; COMMIT; SELECT 2');
      expect(result.statementIndex).toBe(1);
    });
  });
});
