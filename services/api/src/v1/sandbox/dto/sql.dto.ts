import { z } from 'zod';
import { MAX_SQL_LENGTH } from '../sql/sql-guard';

const SQL_ID = /^[a-z0-9-]{3,80}$/;

const SqlTextSchema = z.string().min(1).max(MAX_SQL_LENGTH);

export const RunSqlSchema = z
  .object({
    datasetId: z.string().regex(SQL_ID),
    sql: SqlTextSchema,
  })
  .strict();
export type RunSqlDto = z.infer<typeof RunSqlSchema>;

export const CheckSqlSchema = z.object({ sql: SqlTextSchema }).strict();
export type CheckSqlDto = z.infer<typeof CheckSqlSchema>;

export const SqlExerciseParamSchema = z.string().regex(SQL_ID);
