import type { Paginated } from '~/interfaces/commerce';

export type { Paginated };

export interface AdminUserRow {
  id: string;
  name: string;
  email: string;
  emailVerified: string | null;
  image: { url: string } | null;
  provider: string;
  role: 'STUDENT' | 'TEACHER' | 'REVIEWER' | 'ADMIN';
  isActive: boolean;
  totalPoints: number;
  stars: number;
  currentStreak: number;
  createdAt: string;
}

export interface AdminTenantRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

export interface PersonRef {
  id: string;
  name: string;
  email: string;
}

export interface TenantRef {
  id: string;
  name: string;
  slug: string;
  status?: string;
}

export interface AdminPayoutRow {
  id: string;
  amount: string | number;
  status: 'REQUESTED' | 'UNDER_REVIEW' | 'APPROVED' | 'PAID' | 'REJECTED' | 'CANCELLED';
  destinationInfo: { bankName: string; accountNumber: string; accountName: string } | null;
  requestedAt: string;
  reviewedAt: string | null;
  rejectionReason: string | null;
  paidAt: string | null;
  evidenceUrl: string | null;
  creator: PersonRef | null;
  tenant: TenantRef | null;
}

export interface AdminRefundRow {
  id: string;
  orderId: string;
  amount: string | number;
  reason: string;
  status: 'REQUESTED' | 'APPROVED' | 'PROCESSED' | 'REJECTED';
  approvedAt: string | null;
  rejectionReason: string | null;
  processedAt: string | null;
  evidenceUrl: string | null;
  createdAt: string;
  requestedBy: PersonRef | null;
  order: { id: string; total: string | number; currency: string; userId: string } | null;
}

export type ContentKind = 'article' | 'class';

export interface AdminContentRow {
  id: string;
  title: string;
  slug: string | null;
  excerpt?: string | null;
  description?: string | null;
  accessType: 'FREE' | 'PAID';
  price: string | number | null;
  currency: string;
  format?: string;
  difficulty?: string;
  status: 'DRAFT' | 'PENDING_REVIEW' | 'PUBLISHED' | 'REJECTED' | 'SUSPENDED' | 'ARCHIVED';
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  tenant: TenantRef | null;
  author?: PersonRef | null;
  pendingConceptTags?: number;
}

export interface AdminConceptLink {
  conceptId: string;
  title: string;
  level: number;
  status: 'PROPOSED' | 'APPROVED' | 'REJECTED';
}

export interface AdminContentDetail extends AdminContentRow {
  conceptLinks?: AdminConceptLink[];
  versions?: Array<{ id: string; versionNumber: number; title: string; content: string; publishedAt: string | null }>;
  sessions?: Array<{ id: string; startsAt: string; endsAt: string; meetingUrl?: string | null; status?: string }>;
}

export interface AdminApplicationRow {
  id: string;
  userId: string;
  fullName: string;
  bio: string | null;
  cvUrl: string | null;
  portfolioUrl: string | null;
  expertise: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  feedback: string | null;
  reviewedAt: string | null;
  createdAt: string;
  user?: PersonRef | null;
}

export interface AuditActor {
  id: string;
  name: string;
  email: string;
  role: string;
}

export interface AuditLogRow {
  id: string;
  actorId: string | null;
  actorRole: string | null;
  tenantId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  reason: string | null;
  traceId: string | null;
  createdAt: string;
  actor: AuditActor | null;
}

export interface AuditLogDetail extends AuditLogRow {
  before: unknown;
  after: unknown;
}

export interface QueueCounts {
  payments: number;
  payouts: number;
  refunds: number;
  articles: number;
  classes: number;
  applications: number;
}

export interface PromptMetricsView {
  episodes: number;
  outcomes: number;
  successRate: number | null;
  groundedRate: number | null;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  avgTokensIn: number | null;
  avgTokensOut: number | null;
}

export interface PromptVersionRow {
  id: string;
  name: string;
  version: number;
  label: string;
  status: string;
  canaryPercent: number;
  modelName: string;
  createdBy: string;
  createdAt: string;
  parentVersionId: string | null;
  rationale: string | null;
  origin: 'AI_PROPOSED' | 'HUMAN' | string;
  changes: string[];
  body: string;
  metrics: PromptMetricsView;
}

export interface BuiltinPromptRow {
  name: string;
  label: string;
  metrics: PromptMetricsView;
}

export interface PromptListView {
  versions: PromptVersionRow[];
  builtin: BuiltinPromptRow[];
}

export interface GateCriterionView {
  id: string;
  status: string;
  baseline: number | null;
  candidate: number | null;
  rule: string;
}

export interface GateView {
  passed: boolean;
  sampleSufficient: boolean;
  regression: boolean;
  criteria: GateCriterionView[];
  notMeasured: string[];
}

export interface PromptEvaluationView {
  status: string;
  gate: GateView;
  baselineLabel: string;
  candidateLabel: string;
  runId: string;
  decision: string;
}

export interface OptimizationRunRow {
  id: string;
  optimizerName: string;
  decision: string;
  rationale: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
  candidateJson: { label?: string; baselineLabel?: string; gate?: GateView } | null;
}

export interface GamifyRuleField {
  key: string;
  target: 'amount' | 'param';
  label: string;
  hint: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  integer: boolean;
}

export interface GamifyRuleInForce {
  version: number;
  builtin: boolean;
  values: Record<string, number>;
}

export interface GamifyRuleVersion {
  version: number;
  active: boolean;
  inForce: boolean;
  builtin: boolean;
  values: Record<string, number>;
  createdAt: string | null;
}

export interface GamifyRuleView {
  code: string;
  label: string;
  summary: string;
  eventType: string;
  rewardKind: string;
  fields: GamifyRuleField[];
  inForce: GamifyRuleInForce | null;
  latestVersion: number;
  versions: GamifyRuleVersion[];
}

export interface GamifyLevelRow {
  level: number;
  xp: number;
}

export interface GamifyLadderView {
  levels: GamifyLevelRow[];
  builtin: boolean;
  fingerprint: string;
}

export interface GamifyMetricSpec {
  metric: string;
  label: string;
  unit: string;
  max: number;
  type: string;
}

export interface GamifyAchievementRule {
  metric: string;
  op: string;
  value: number;
}

export interface GamifyAchievementView {
  code: string | null;
  title: string;
  description: string | null;
  iconName: string | null;
  type: string;
  rule: GamifyAchievementRule | null;
  sortOrder: number;
  active: boolean;
  unlockedCount: number;
  createdAt: string;
}

export interface GamifyAchievementsView {
  achievements: GamifyAchievementView[];
  metrics: GamifyMetricSpec[];
  icons: string[];
}

export type BenchmarkRunStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED';
export type BenchmarkDatasetRole = 'BENCHMARK' | 'DEVELOPMENT';
export type BenchmarkDecision = 'ACCEPTED' | 'REJECTED' | 'DEFERRED';
export type BenchmarkDatasetName = 'tutor-chat-benchmark-v1' | 'tutor-chat-dev-v1';

export interface BenchmarkRunSummary {
  id: string;
  createdAt: string;
  status: BenchmarkRunStatus;
  name: string;
  baseline: string;
  candidate: string;
  candidatePromptId: string | null;
  identicalArms: boolean;
  datasetName: string;
  datasetRole: BenchmarkDatasetRole;
  datasetDigest: string;
  repeats: number;
  judge: boolean;
  progress: { done: number; total: number };
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  decision: string;
  decisionRationale: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
}

export interface BenchmarkInterval {
  mean: number | null;
  lower: number | null;
  upper: number | null;
}

export interface BenchmarkPairedDifference {
  baseline: number | null;
  candidate: number | null;
  diff: number | null;
  lower: number | null;
  upper: number | null;
  pairedCases: number;
  wins: number;
  losses: number;
  ties: number;
  regressions: string[];
}

export interface BenchmarkArmSummary {
  label: string;
  cases: number;
  samples: number;
  failures: number;
  latencyMs: { p50: number | null; p95: number | null };
  tokens: { meanIn: number | null; meanOut: number | null };
  byCategory: Record<string, { cases: number; correctness: number; citation: number; safety: number }>;
}

export interface BenchmarkReportView {
  baseline: BenchmarkArmSummary;
  candidate: BenchmarkArmSummary;
  comparison: {
    pairedCases: number;
    rates: Record<'correctness' | 'citation' | 'safety', BenchmarkPairedDifference>;
    scores: Record<'pedagogy' | 'behavior' | 'grounding', BenchmarkPairedDifference>;
    safetyRegressions: string[];
  };
  evidence: { judged: boolean; judgeCalibrated: boolean; repeats: number; pairedCases: number };
}

export interface BenchmarkRunDetail extends BenchmarkRunSummary {
  baselineHash: string;
  candidateHash: string;
  report: BenchmarkReportView | null;
  criteria: GateCriterionView[];
}

export interface BenchmarkSampleView {
  caseId: string;
  repeat: number;
  text: string;
  checks: { facts?: { missing?: string[]; violated?: string[] }; citations?: { passed?: boolean; invalid?: number[]; misattributed?: number[] }; leaks?: string[] };
  judge: { verdict: { behavior: number; pedagogy: number; grounding: number; unsafe: boolean; notes: string } } | null;
  dimensions: { correctness: boolean; citation: boolean; safety: boolean; pedagogy: number | null };
}

export interface BenchmarkCaseView {
  case: { id: string; category: string; risk: string; message: string; expect: { behavior: string; rubric: string } };
  baseline: BenchmarkSampleView[];
  candidate: BenchmarkSampleView[];
}

export interface BenchmarkStartBody {
  name: string;
  datasetName: BenchmarkDatasetName;
  candidatePromptId?: string;
  repeats: number;
  judge: boolean;
}

export type CircularityMetricId = 'MASTERY_CHANGE' | 'REVIEW_OUTCOME' | 'KNOWLEDGE_REUSE' | 'CREATOR_CONVERSION' | 'PROMPT_EVIDENCE';
export type CircularityMetricState = 'OK' | 'NOT_ENOUGH_EVIDENCE';

export interface CircularitySample {
  n: number;
  learners: number;
}

export interface MasteryChangeValue {
  meanDelta: number;
  medianDelta: number;
  shareImproved: number;
}

export interface ReviewOutcomeValue {
  dueEvents: number;
  passed: number;
  passRate: number;
  notDueEvents: number;
  notDuePassRate: number | null;
}

export interface KnowledgeReuseValue {
  denominator: number;
  numerator: number;
  reuseRate: number;
  products: Array<{ kind: 'class' | 'article'; id: string; title: string; holders: number; qualifyingLearners: number }>;
}

export interface CreatorConversionValue {
  eligible: number;
  converted: number;
  conversion: number;
  topics: Array<{ topicId: string; title: string; concepts: number; eligible: number; converted: number }>;
}

export interface PromptEvidenceValue {
  drafts: { aiProposed: number; engineer: number; byStatus: Record<string, number> };
  benchmarkRuns: { completed: number; candidateRuns: number; identicalArmsRuns: number; decided: number; verdicts: Record<string, Record<string, number>> };
  canariesStarted: number;
  rollbacks: number;
  strategyOutcomes: Array<{ promptVersion: string; n: number; successes: number }>;
}

export interface CircularityValues {
  MASTERY_CHANGE: MasteryChangeValue;
  REVIEW_OUTCOME: ReviewOutcomeValue;
  KNOWLEDGE_REUSE: KnowledgeReuseValue;
  CREATOR_CONVERSION: CreatorConversionValue;
  PROMPT_EVIDENCE: PromptEvidenceValue;
}

export interface CircularityMetric<Id extends CircularityMetricId = CircularityMetricId> {
  id: Id;
  state: CircularityMetricState;
  organic: CircularitySample;
  demo: CircularitySample;
  minimum: Record<string, number>;
  value: CircularityValues[Id] | null;
  demoValue: CircularityValues[Id] | null;
}

export interface CircularityReport {
  definitionVersion: string;
  generatedAt: string;
  window: { from: string; to: string };
  demoAccountDomain: string;
  metrics: CircularityMetric[];
}
