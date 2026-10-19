export const MAX_SQL_LENGTH = 6000;
export const MAX_STATEMENTS = 20;

export type StatementKind = 'query' | 'command';

export interface GuardedStatement {
  sql: string;
  kind: StatementKind;
  verb: string;
}

export type GuardResult =
  | { ok: true; statements: GuardedStatement[] }
  | { ok: false; message: string; statementIndex: number | null };

interface RawStatement {
  sql: string;
  scan: string;
}

type SplitResult = { ok: true; statements: RawStatement[] } | { ok: false; message: string };

const FIRST_WORD_KIND: Record<string, StatementKind> = {
  select: 'query',
  with: 'query',
  values: 'query',
  table: 'query',
  insert: 'command',
  update: 'command',
  delete: 'command',
  create: 'command',
  alter: 'command',
  drop: 'command',
  truncate: 'command',
  explain: 'command',
};

const ALLOWED_CREATE = /^create\s+(?:(?:unique\s+)?index|table|(?:or\s+replace\s+)?view)\b/;
const ALLOWED_ALTER = /^alter\s+table\b/;
const ALLOWED_DROP = /^drop\s+(?:table|index|view)\b/;
const EXPLAINABLE = new Set(['select', 'with', 'insert', 'update', 'delete', 'values', 'table']);
const MODIFIES_DATA = /\b(?:insert|update|delete|merge)\b/;
const SELECT_INTO = /^select\b[\s\S]*\binto\b/;

const DENIED_NAMES: RegExp[] = [
  /\bset_config\b/,
  /\bpg_(?:read|ls|stat_file|file|sleep|advisory|notify|terminate|cancel|reload|rotate|switch|create|drop|start|stop|backup|export|import|logical|replication|promote|wal|current_wal|walfile|stat_reset|ident|hba)\w*/,
  /\blo_(?:import|export|open|creat|create|unlink|get|put|from_bytea|lseek|lseek64|tell|tell64|truncate|truncate64)\b/,
  /\b(?:loread|lowrite)\b/,
  /\bdblink\w*/,
  /\b\w*_to_xml\w*/,
  /\bts_stat\b/,
  /\bpg_(?:authid|shadow|user_mapping|stat_activity|stat_ssl|stat_gssapi|stat_replication\w*|hba_file_rules|file_settings|largeobject\w*|subscription\w*|replication_slots)\b/,
];

const IDENTIFIER_CHAR = /[A-Za-z0-9_$\u0080-￿]/;

const isIdentifierChar = (char: string | undefined) => char !== undefined && IDENTIFIER_CHAR.test(char);

const splitStatements = (input: string): SplitResult => {
  const statements: RawStatement[] = [];
  let sql = '';
  let scan = '';
  let i = 0;

  const flush = () => {
    if (scan.trim().length > 0) statements.push({ sql: sql.trim(), scan: scan.toLowerCase().replace(/\s+/g, ' ').trim() });
    sql = '';
    scan = '';
  };

  while (i < input.length) {
    const char = input[i];
    const next = input[i + 1];

    if (char === '-' && next === '-') {
      while (i < input.length && input[i] !== '\n') i += 1;
      sql += ' ';
      scan += ' ';
      continue;
    }

    if (char === '/' && next === '*') {
      let depth = 1;
      i += 2;
      while (i < input.length && depth > 0) {
        if (input[i] === '/' && input[i + 1] === '*') {
          depth += 1;
          i += 2;
        } else if (input[i] === '*' && input[i + 1] === '/') {
          depth -= 1;
          i += 2;
        } else {
          i += 1;
        }
      }
      if (depth > 0) return { ok: false, message: 'Komentar blok (/* ... */) belum ditutup.' };
      sql += ' ';
      scan += ' ';
      continue;
    }

    if (char === "'") {
      const prefix = input[i - 1];
      const escapeString = (prefix === 'E' || prefix === 'e') && !isIdentifierChar(input[i - 2]);
      let j = i + 1;
      let closed = false;
      while (j < input.length) {
        if (escapeString && input[j] === '\\') {
          j += 2;
          continue;
        }
        if (input[j] === "'") {
          if (input[j + 1] === "'") {
            j += 2;
            continue;
          }
          closed = true;
          break;
        }
        j += 1;
      }
      if (!closed) return { ok: false, message: 'Tanda kutip tunggal (\') belum ditutup.' };
      sql += input.slice(i, j + 1);
      scan += "''";
      i = j + 1;
      continue;
    }

    if (char === '"') {
      const unicodeEscape = input[i - 1] === '&' && (input[i - 2] === 'U' || input[i - 2] === 'u');
      if (unicodeEscape) return { ok: false, message: 'Pengenal dengan escape Unicode (U&"...") tidak tersedia di sandbox.' };
      let j = i + 1;
      let closed = false;
      while (j < input.length) {
        if (input[j] === '"') {
          if (input[j + 1] === '"') {
            j += 2;
            continue;
          }
          closed = true;
          break;
        }
        j += 1;
      }
      if (!closed) return { ok: false, message: 'Tanda kutip ganda (") belum ditutup.' };
      sql += input.slice(i, j + 1);
      scan += ` ${input.slice(i + 1, j).replace(/[^A-Za-z0-9_]/g, '_')} `;
      i = j + 1;
      continue;
    }

    if (char === '$') return { ok: false, message: 'Tanda dolar ($) tidak tersedia di sandbox.' };

    if (char === ';') {
      flush();
      i += 1;
      continue;
    }

    sql += char;
    scan += char;
    i += 1;
  }
  flush();
  return { ok: true, statements };
};

const rejectUnsupported = (word: string) =>
  `Perintah ${word.toUpperCase()} tidak dikenali atau tidak tersedia di sandbox ini. Periksa ejaannya, atau gunakan SELECT, INSERT, UPDATE, DELETE, serta CREATE, ALTER, dan DROP untuk tabel.`;

const EXPLAIN_FLAG = /^(?:analyze|analyse|verbose)\s+/;

const explainTarget = (scan: string): string => {
  let rest = scan.replace(/^explain\s*/, '').replace(/^\([^)]*\)\s*/, '');
  while (EXPLAIN_FLAG.test(rest)) rest = rest.replace(EXPLAIN_FLAG, '');
  return rest.split(/[\s(]/)[0] ?? '';
};

const classify = (raw: RawStatement): { kind: StatementKind; verb: string } | string => {
  const verb = raw.scan.split(/[\s(]/)[0] ?? '';
  const kind = FIRST_WORD_KIND[verb];
  if (!kind) return rejectUnsupported(verb || 'ini');

  if (verb === 'create' && !ALLOWED_CREATE.test(raw.scan)) return 'Hanya CREATE TABLE, CREATE INDEX, dan CREATE VIEW yang tersedia di sandbox ini.';
  if (verb === 'alter' && !ALLOWED_ALTER.test(raw.scan)) return 'Hanya ALTER TABLE yang tersedia di sandbox ini.';
  if (verb === 'drop' && !ALLOWED_DROP.test(raw.scan)) return 'Hanya DROP TABLE, DROP INDEX, dan DROP VIEW yang tersedia di sandbox ini.';
  if (verb === 'explain' && !EXPLAINABLE.has(explainTarget(raw.scan))) return 'EXPLAIN hanya tersedia untuk SELECT, INSERT, UPDATE, dan DELETE.';

  for (const pattern of DENIED_NAMES) {
    if (pattern.test(raw.scan)) return 'Fungsi atau tabel sistem yang Anda sebut tidak tersedia di sandbox ini.';
  }

  if (verb === 'with' && MODIFIES_DATA.test(raw.scan)) return { kind: 'command', verb };
  if (verb === 'select' && SELECT_INTO.test(raw.scan)) return { kind: 'command', verb };
  return { kind, verb };
};

export const guardSql = (input: string): GuardResult => {
  if (input.length > MAX_SQL_LENGTH) {
    return { ok: false, message: `SQL terlalu panjang (maksimal ${MAX_SQL_LENGTH} karakter).`, statementIndex: null };
  }
  if (input.includes('\u0000')) return { ok: false, message: 'SQL mengandung karakter yang tidak valid.', statementIndex: null };

  const split = splitStatements(input);
  if (!split.ok) return { ok: false, message: split.message, statementIndex: null };
  if (split.statements.length === 0) return { ok: false, message: 'Tuliskan pernyataan SQL terlebih dahulu.', statementIndex: null };
  if (split.statements.length > MAX_STATEMENTS) {
    return { ok: false, message: `Terlalu banyak pernyataan (maksimal ${MAX_STATEMENTS} sekaligus).`, statementIndex: null };
  }

  const statements: GuardedStatement[] = [];
  for (let index = 0; index < split.statements.length; index += 1) {
    const raw = split.statements[index];
    const verdict = classify(raw);
    if (typeof verdict === 'string') return { ok: false, message: verdict, statementIndex: index };
    statements.push({ sql: raw.sql, kind: verdict.kind, verb: verdict.verb });
  }
  return { ok: true, statements };
};
