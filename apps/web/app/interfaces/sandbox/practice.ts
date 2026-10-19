import type { AssessmentGamify } from '~/interfaces/gamify'
import type { PageInfo } from '~/lib/paging'

export type Side = 'DEBIT' | 'CREDIT'
export type PracticeStatus = 'NEW' | 'IN_PROGRESS' | 'SOLVED'
export type Scaffold = 'HIGH' | 'MEDIUM' | 'MINIMAL'
export type RecommendationReason = 'START' | 'REMEDIATION' | 'PROGRESSION' | 'REVIEW'
export type Difficulty = 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED'
export type LineStatus = 'CORRECT' | 'REVERSED_SIDE' | 'WRONG_AMOUNT' | 'WRONG_ACCOUNT' | 'EXTRA'
export type FindingSeverity = 'GLOBAL' | 'FOCUS' | 'POLISH'

export interface PracticeView {
  status: PracticeStatus
  attempts: number
  bestScore: number
  hintLevel: number
  revealed: boolean
  solvedUnaided: boolean
  solvedAt: string | null
}

export interface ScenarioSummary {
  id: string
  title: string
  level: number
  difficulty: Difficulty
  conceptId: string
  tags: string[]
  lineCount: number
  practice: PracticeView
}

export interface Recommendation {
  scenarioId: string
  title: string
  level: number
  conceptId: string
  reason: RecommendationReason
  message: string
}

export interface LevelProgress {
  level: number
  total: number
  solved: number
}

export interface CatalogSummary {
  total: number
  solved: number
  solvedUnaided: number
  inProgress: number
  levels: LevelProgress[]
}

export interface Catalog {
  summary: CatalogSummary
  scenarios: ScenarioSummary[]
  page: PageInfo
  recommended: Recommendation | null
}

export interface SandboxAccount {
  code: string
  name: string
  type: string
  group: string
  class: string
}

export interface KeyLine {
  account: string
  name: string
  side: Side
  sideLabel: string
  amount: number
}

export interface EquationEffect {
  asset: number
  liability: number
  equity: number
  holds: boolean
}

export interface Solution {
  key: KeyLine[]
  why: string
  equation: EquationEffect
}

export interface Personalization {
  scaffold: Scaffold
  strategy: string | null
  reasonCodes: string[]
  mastery: number
  evidenceCount: number
  showExample: boolean
  equationPanelOpen: boolean
}

export interface SavedLine {
  account: string
  side: Side
  amount: number
}

export interface ScenarioDetail extends ScenarioSummary {
  story: string
  accounts: SandboxAccount[]
  lastLines: SavedLine[] | null
  hints: string[]
  personalization: Personalization
  example: { story: string; key: KeyLine[]; why: string } | null
  solution: Solution | null
}

export interface CheckFinding {
  code: string
  severity: FindingSeverity
  message: string
  lineIndexes: number[]
}

export interface LearningOutcome {
  conceptId: string
  masteryBefore: number
  masteryAfter: number
  xpGained: number
  starsGained: number
  streak: AssessmentGamify['streak'] | null
  achievements: AssessmentGamify['achievements']
}

export interface CheckResult {
  correct: boolean
  score: number
  balanced: boolean
  totalDebit: number
  totalCredit: number
  difference: number
  verdicts: Array<{ index: number; status: LineStatus }>
  missingBySide: { DEBIT: number; CREDIT: number }
  findings: CheckFinding[]
  equation: EquationEffect
  attemptNumber: number
  firstSolve: boolean
  practice: PracticeView
  explanation: string | null
  learning: LearningOutcome | null
  next: Recommendation | null
}

export interface HintResult {
  level: number
  hints: string[]
  remaining: number
  canReveal: boolean
}

export interface RevealResult extends Solution {
  countsAsEvidence: boolean
}

export interface PracticeSignals {
  solved: number
  total: number
  openMisconceptions: Array<{ code: string; count: number; label: string }>
  recentErrors: Array<{ code: string; count: number }>
  weakConcepts: Array<{ conceptId: string; title: string; score: number }>
  suggestion: Recommendation | null
}

export interface CatalogQuery {
  level?: number
  difficulty?: Difficulty
  status?: PracticeStatus
  q?: string
  limit?: number
  cursor?: number
}

export interface VariantDetail {
  seed: number
  scenarioId: string
  title: string
  level: number
  difficulty: Difficulty
  conceptId: string
  lineCount: number
  story: string
  accounts: SandboxAccount[]
  hints: string[]
  variantCount: number
  countsAsEvidence: boolean
}

export interface VariantCheckResult {
  seed: number
  correct: boolean
  score: number
  balanced: boolean
  totalDebit: number
  totalCredit: number
  difference: number
  verdicts: Array<{ index: number; status: LineStatus }>
  missingBySide: { DEBIT: number; CREDIT: number }
  findings: CheckFinding[]
  equation: EquationEffect
  explanation: string | null
  solution: Solution | null
  countsAsEvidence: boolean
}

export interface VariantReveal extends Solution {
  seed: number
  countsAsEvidence: boolean
}
