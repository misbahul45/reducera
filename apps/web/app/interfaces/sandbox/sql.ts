export type SqlPracticeStatus = 'NEW' | 'IN_PROGRESS' | 'SOLVED'

export type SqlCell = string | null

export interface SqlColumnDoc {
  name: string
  type: string
  note?: string
}

export interface SqlTableDoc {
  name: string
  description: string
  columns: SqlColumnDoc[]
}

export interface SqlDatasetInfo {
  id: string
  title: string
  engine: string
  description: string
  tables: SqlTableDoc[]
}

export interface SqlProgress {
  status: SqlPracticeStatus
  attempts: number
  hintLevel: number
  hints: string[]
  revealed: boolean
  solvedAt: string | null
  lastSql: string | null
}

export interface SqlExerciseSummary {
  id: string
  datasetId: string
  level: number
  subTopic: string
  title: string
  task: string
  ordered: boolean
  hintCount: number
  progress: SqlProgress
}

export interface SqlCatalog {
  available: boolean
  datasets: SqlDatasetInfo[]
  exercises: SqlExerciseSummary[]
  summary: { solved: number; total: number }
}

export interface SqlStatementOutput {
  sql: string
  verb: string
  kind: 'query' | 'command'
  columns: string[]
  rows: SqlCell[][]
  rowCount: number | null
  truncated: boolean
  elapsedMs: number
}

export interface SqlErrorView {
  code: string
  friendly: string
  message: string
  detail: string | null
  hint: string | null
  position: number | null
  statementIndex: number
}

export interface SqlRunResult {
  accepted: boolean
  notice: string | null
  statementIndex: number | null
  outputs: SqlStatementOutput[]
  error: SqlErrorView | null
}

export type SqlVerdict = 'MATCH' | 'NO_RESULT' | 'COLUMN_COUNT' | 'ROW_COUNT' | 'VALUES' | 'ORDER' | 'ERROR' | 'REJECTED'

export interface SqlCheckResult {
  correct: boolean
  verdict: SqlVerdict
  feedback: string
  outputs: SqlStatementOutput[]
  error: SqlErrorView | null
  progress: SqlProgress
  explanation: string | null
}

export interface SqlHintResult {
  hintLevel: number
  hints: string[]
  hintCount: number
  notice: string | null
}

export interface SqlRevealResult {
  referenceSql: string
  explanation: string
  revealed: boolean
}
