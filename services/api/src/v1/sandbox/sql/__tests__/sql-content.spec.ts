import { readSeedJson } from '../../seed-file';
import { HINTS_PER_EXERCISE, buildSqlContent } from '../sql-content';
import { guardSql } from '../sql-guard';

const BANNED_TERMS = /\b(SMK|BNSP|SKKNI|sertifikasi|siswa|Menjadi Guru|cervana|ceruana|Industri 4\.0|sertifikat kompetensi)\b/i;

describe('SQL sandbox content', () => {
  const raw = readSeedJson('sandbox-sql.json');
  const content = buildSqlContent(raw);

  it('loads datasets and exercises with unique ids', () => {
    expect(content.datasets.length).toBeGreaterThanOrEqual(1);
    expect(content.exercises.length).toBeGreaterThanOrEqual(15);
    expect(new Set(content.exercises.map((exercise) => exercise.id)).size).toBe(content.exercises.length);
  });

  it('covers the four levels from reading data to designing tables', () => {
    const levels = new Set(content.exercises.map((exercise) => exercise.level));
    expect([...levels].sort()).toEqual([1, 2, 3, 4]);
  });

  it('gives every exercise a progressive set of hints and an explanation', () => {
    for (const exercise of content.exercises) {
      expect(exercise.hints).toHaveLength(HINTS_PER_EXERCISE);
      expect(new Set(exercise.hints).size).toBe(HINTS_PER_EXERCISE);
      expect(exercise.explanation.length).toBeGreaterThan(30);
      expect(exercise.task.length).toBeGreaterThan(20);
    }
  });

  it('lets the guard accept every reference answer and every verification query', () => {
    for (const exercise of content.exercises) {
      expect(guardSql(exercise.referenceSql).ok).toBe(true);
      if (exercise.verifySql) expect(guardSql(exercise.verifySql).ok).toBe(true);
    }
  });

  it('requires a verification query for every exercise that changes data', () => {
    for (const exercise of content.exercises) {
      const guarded = guardSql(exercise.referenceSql);
      if (!guarded.ok) continue;
      const last = guarded.statements[guarded.statements.length - 1];
      if (last.kind === 'command') expect(exercise.verifySql).toBeDefined();
    }
  });

  it('documents every table the setup creates', () => {
    for (const dataset of content.datasets) {
      const created = [...dataset.setupSql.matchAll(/CREATE TABLE (\w+)/g)].map((match) => match[1]).sort();
      expect(dataset.tables.map((table) => table.name).sort()).toEqual(created);
    }
  });

  it('keeps the learner copy free of the terms the product never uses', () => {
    expect(JSON.stringify(raw)).not.toMatch(BANNED_TERMS);
  });

  it('rejects a file with a duplicate id, an unknown dataset or a reference the guard refuses', () => {
    const base = JSON.parse(JSON.stringify(raw)) as { exercises: Array<Record<string, unknown>> };
    const duplicate = JSON.parse(JSON.stringify(base));
    duplicate.exercises[1].id = duplicate.exercises[0].id;
    expect(() => buildSqlContent(duplicate)).toThrow(/Duplicate/);

    const unknown = JSON.parse(JSON.stringify(base));
    unknown.exercises[0].datasetId = 'tidak-ada';
    expect(() => buildSqlContent(unknown)).toThrow(/unknown dataset/);

    const refused = JSON.parse(JSON.stringify(base));
    refused.exercises[0].referenceSql = 'SELECT pg_sleep(5)';
    expect(() => buildSqlContent(refused)).toThrow(/rejected by the guard/);

    const unverified = JSON.parse(JSON.stringify(base));
    unverified.exercises[0].referenceSql = 'DELETE FROM pelanggan';
    expect(() => buildSqlContent(unverified)).toThrow(/needs a verifySql/);
  });
});
