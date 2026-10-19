import { z } from 'zod';
import { guardSql } from './sql-guard';

export const SQL_ID_PATTERN = /^[a-z0-9-]{3,80}$/;
export const HINTS_PER_EXERCISE = 3;

const ColumnDocSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  note: z.string().min(1).optional(),
});

const TableDocSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  columns: z.array(ColumnDocSchema).min(1),
});

const DatasetSchema = z.object({
  id: z.string().regex(SQL_ID_PATTERN),
  title: z.string().min(1),
  engine: z.string().min(1),
  description: z.string().min(1),
  setupSql: z.string().min(1),
  tables: z.array(TableDocSchema).min(1),
});

const ExerciseSchema = z.object({
  id: z.string().regex(SQL_ID_PATTERN),
  datasetId: z.string().regex(SQL_ID_PATTERN),
  level: z.number().int().min(1).max(4),
  subTopic: z.string().min(1),
  title: z.string().min(1),
  task: z.string().min(1),
  referenceSql: z.string().min(1),
  verifySql: z.string().min(1).optional(),
  ordered: z.boolean(),
  hints: z.array(z.string().min(1)).length(HINTS_PER_EXERCISE),
  explanation: z.string().min(1),
  expectedRowCount: z.number().int().min(0),
});

const ContentSchema = z.object({
  version: z.literal(1),
  datasets: z.array(DatasetSchema).min(1),
  exercises: z.array(ExerciseSchema).min(1),
});

export type SqlDataset = z.infer<typeof DatasetSchema>;
export type SqlExercise = z.infer<typeof ExerciseSchema>;
export type SqlTableDoc = z.infer<typeof TableDocSchema>;

export interface SqlContent {
  datasets: SqlDataset[];
  exercises: SqlExercise[];
}

const duplicates = (ids: string[]) => ids.filter((id, index) => ids.indexOf(id) !== index);

export const buildSqlContent = (raw: unknown): SqlContent => {
  const content = ContentSchema.parse(raw);

  const repeated = [...duplicates(content.datasets.map((d) => d.id)), ...duplicates(content.exercises.map((e) => e.id))];
  if (repeated.length > 0) throw new Error(`Duplicate SQL sandbox ids: ${repeated.join(', ')}`);

  const datasetIds = new Set(content.datasets.map((dataset) => dataset.id));
  for (const exercise of content.exercises) {
    if (!datasetIds.has(exercise.datasetId)) throw new Error(`Exercise ${exercise.id} refers to the unknown dataset ${exercise.datasetId}`);
    const reference = guardSql(exercise.referenceSql);
    if (!reference.ok) throw new Error(`Reference SQL of ${exercise.id} is rejected by the guard: ${reference.message}`);
    const lastKind = reference.statements[reference.statements.length - 1].kind;
    if (!exercise.verifySql && lastKind !== 'query') throw new Error(`Exercise ${exercise.id} changes data and needs a verifySql`);
  }
  return { datasets: content.datasets, exercises: content.exercises };
};
