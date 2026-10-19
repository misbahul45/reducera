import { ASSESSMENT_COMPLETED, assessmentPayloadSchema } from '../learner-model/mastery/assessment-payload';
import { ConceptState, EMPTY_CONCEPT_STATE, foldAssessment } from '../learner-model/mastery/mastery-v1';
import { ConceptEvidence, aggregateTopic, isCreatorEligible } from '../learner-model/mastery/topic-aggregate';
import { PASS_SCORE } from '../learner-model/policy/learner-policy.service';
import { scheduleReview } from '../learner-model/review/review-schedule';

export const CIRCULARITY_DEFINITION_VERSION = 'circularity-v1';
export const DEMO_ACCOUNT_DOMAIN = 'reducera.local';
export const DEFAULT_WINDOW_DAYS = 30;
export const MAX_WINDOW_DAYS = 366;
export const MINIMUM_EVIDENCE = {
  masteryChange: { events: 30, learners: 10 },
  reviewOutcome: { events: 20, learners: 10 },
  knowledgeReuse: { products: 5 },
  creatorConversion: { eligible: 20 },
  promptEvidence: { decidedRuns: 1 },
} as const;
export const MIN_QUALIFYING_LEARNERS = 2;

export type MetricId = 'MASTERY_CHANGE' | 'REVIEW_OUTCOME' | 'KNOWLEDGE_REUSE' | 'CREATOR_CONVERSION' | 'PROMPT_EVIDENCE';
export type MetricState = 'OK' | 'NOT_ENOUGH_EVIDENCE';

export interface TimeWindow {
  from: Date;
  to: Date;
}

export interface Sample {
  n: number;
  learners: number;
}

export interface MetricResult<T> {
  id: MetricId;
  state: MetricState;
  organic: Sample;
  demo: Sample;
  minimum: Record<string, number>;
  value: T | null;
  demoValue: T | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export const resolveWindow = (query: { from?: Date; to?: Date }, now: Date): TimeWindow => {
  const to = query.to ?? now;
  const from = query.from ?? new Date(to.getTime() - DEFAULT_WINDOW_DAYS * DAY_MS);
  if (from.getTime() >= to.getTime()) throw new RangeError('from must be before to');
  if (to.getTime() - from.getTime() > MAX_WINDOW_DAYS * DAY_MS) throw new RangeError(`the window is longer than ${MAX_WINDOW_DAYS} days`);
  return { from, to };
};

export const isDemoAccount = (email: string): boolean => email.trim().toLowerCase().endsWith(`@${DEMO_ACCOUNT_DOMAIN}`);

const round = (value: number, places = 4): number => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

const mean = (values: number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const inWindow = (at: Date, window: TimeWindow): boolean => at.getTime() >= window.from.getTime() && at.getTime() < window.to.getTime();

const sampleOf = (rows: Array<{ userId: string }>): Sample => ({ n: rows.length, learners: new Set(rows.map((row) => row.userId)).size });

export interface StoredAssessment {
  userId: string;
  conceptId: string;
  streamSeq: number;
  occurredAt: Date;
  payload: unknown;
  eventType?: string;
}

export interface AssessmentObservation {
  userId: string;
  conceptId: string;
  occurredAt: Date;
  delta: number;
  hadPriorState: boolean;
  due: boolean;
  passed: boolean;
}

export const observeAssessments = (events: StoredAssessment[], window: TimeWindow): AssessmentObservation[] => {
  const ordered = events
    .filter((event) => (event.eventType ?? ASSESSMENT_COMPLETED) === ASSESSMENT_COMPLETED && event.occurredAt.getTime() < window.to.getTime())
    .sort((a, b) => a.userId.localeCompare(b.userId) || a.streamSeq - b.streamSeq);

  const states = new Map<string, ConceptState>();
  const observations: AssessmentObservation[] = [];
  for (const event of ordered) {
    const parsed = assessmentPayloadSchema.safeParse(event.payload);
    if (!parsed.success) continue;

    const key = `${event.userId}:${event.conceptId}`;
    const prior = states.get(key) ?? EMPTY_CONCEPT_STATE;
    const next = foldAssessment(prior, parsed.data, { occurredAt: event.occurredAt, streamSeq: event.streamSeq });
    states.set(key, next);

    if (!inWindow(event.occurredAt, window)) continue;
    const hadPriorState = prior.evidenceCount > 0 && prior.lastEventAt !== null;
    const due = hadPriorState
      ? (scheduleReview({ conceptId: event.conceptId, score: prior.score, evidenceCount: prior.evidenceCount, lastEventAt: prior.lastEventAt }, event.occurredAt)?.due ?? false)
      : false;
    observations.push({
      userId: event.userId,
      conceptId: event.conceptId,
      occurredAt: event.occurredAt,
      delta: next.score - prior.score,
      hadPriorState,
      due,
      passed: parsed.data.score >= PASS_SCORE,
    });
  }
  return observations;
};

export interface MasteryChangeValue {
  meanDelta: number;
  medianDelta: number;
  shareImproved: number;
}

const summarizeChange = (rows: AssessmentObservation[]): MasteryChangeValue | null => {
  if (rows.length === 0) return null;
  const deltas = rows.map((row) => row.delta);
  return {
    meanDelta: round(mean(deltas)),
    medianDelta: round(median(deltas)),
    shareImproved: round(deltas.filter((delta) => delta > 0).length / deltas.length),
  };
};

export const masteryChange = (observations: AssessmentObservation[], isDemo: (userId: string) => boolean): MetricResult<MasteryChangeValue> => {
  const demoRows = observations.filter((row) => isDemo(row.userId));
  const organicRows = observations.filter((row) => !isDemo(row.userId));
  const minimum = MINIMUM_EVIDENCE.masteryChange;
  const organic = sampleOf(organicRows);
  const enough = organic.n >= minimum.events && organic.learners >= minimum.learners;
  return {
    id: 'MASTERY_CHANGE',
    state: enough ? 'OK' : 'NOT_ENOUGH_EVIDENCE',
    organic,
    demo: sampleOf(demoRows),
    minimum,
    value: enough ? summarizeChange(organicRows) : null,
    demoValue: summarizeChange(demoRows),
  };
};

export interface ReviewOutcomeValue {
  dueEvents: number;
  passed: number;
  passRate: number;
  notDueEvents: number;
  notDuePassRate: number | null;
}

const summarizeReview = (rows: AssessmentObservation[]): ReviewOutcomeValue | null => {
  const withState = rows.filter((row) => row.hadPriorState);
  const due = withState.filter((row) => row.due);
  if (due.length === 0) return null;
  const notDue = withState.filter((row) => !row.due);
  const passed = due.filter((row) => row.passed).length;
  return {
    dueEvents: due.length,
    passed,
    passRate: round(passed / due.length),
    notDueEvents: notDue.length,
    notDuePassRate: notDue.length === 0 ? null : round(notDue.filter((row) => row.passed).length / notDue.length),
  };
};

export const reviewOutcome = (observations: AssessmentObservation[], isDemo: (userId: string) => boolean): MetricResult<ReviewOutcomeValue> => {
  const demoRows = observations.filter((row) => isDemo(row.userId));
  const organicRows = observations.filter((row) => !isDemo(row.userId));
  const minimum = MINIMUM_EVIDENCE.reviewOutcome;
  const organic = sampleOf(organicRows.filter((row) => row.hadPriorState && row.due));
  const enough = organic.n >= minimum.events && organic.learners >= minimum.learners;
  return {
    id: 'REVIEW_OUTCOME',
    state: enough ? 'OK' : 'NOT_ENOUGH_EVIDENCE',
    organic,
    demo: sampleOf(demoRows.filter((row) => row.hadPriorState && row.due)),
    minimum,
    value: enough ? summarizeReview(organicRows) : null,
    demoValue: summarizeReview(demoRows),
  };
};

export interface ReuseProduct {
  kind: 'class' | 'article';
  id: string;
  title: string;
  ownerId: string;
  ownerIsDemo: boolean;
  conceptIds: string[];
}

export interface ReuseHolder {
  kind: 'class' | 'article';
  productId: string;
  userId: string;
  startsAt: Date;
}

export interface ReuseUse {
  userId: string;
  conceptId: string;
  occurredAt: Date;
}

export interface ReuseProductValue {
  kind: 'class' | 'article';
  id: string;
  title: string;
  holders: number;
  qualifyingLearners: number;
}

export interface KnowledgeReuseValue {
  denominator: number;
  numerator: number;
  reuseRate: number;
  products: ReuseProductValue[];
}

const summarizeReuse = (
  products: ReuseProduct[],
  holders: ReuseHolder[],
  uses: ReuseUse[],
  window: TimeWindow,
  isDemo: (userId: string) => boolean,
  demoGroup: boolean,
): { value: KnowledgeReuseValue | null; learners: number } => {
  if (products.length === 0) return { value: null, learners: 0 };
  const allHolders = new Set<string>();
  const rows: ReuseProductValue[] = products.map((product) => {
    const concepts = new Set(product.conceptIds);
    const own = holders.filter(
      (holder) => holder.kind === product.kind && holder.productId === product.id && holder.userId !== product.ownerId && isDemo(holder.userId) === demoGroup,
    );
    own.forEach((holder) => allHolders.add(holder.userId));
    const qualifying = new Set(
      own
        .filter((holder) =>
          uses.some(
            (use) => use.userId === holder.userId && concepts.has(use.conceptId) && use.occurredAt.getTime() >= holder.startsAt.getTime() && use.occurredAt.getTime() < window.to.getTime(),
          ),
        )
        .map((holder) => holder.userId),
    );
    return { kind: product.kind, id: product.id, title: product.title, holders: new Set(own.map((holder) => holder.userId)).size, qualifyingLearners: qualifying.size };
  });
  const numerator = rows.filter((row) => row.qualifyingLearners >= MIN_QUALIFYING_LEARNERS).length;
  return {
    value: { denominator: rows.length, numerator, reuseRate: round(numerator / rows.length), products: rows },
    learners: allHolders.size,
  };
};

export const knowledgeReuse = (
  products: ReuseProduct[],
  holders: ReuseHolder[],
  uses: ReuseUse[],
  window: TimeWindow,
  isDemo: (userId: string) => boolean,
): MetricResult<KnowledgeReuseValue> => {
  const organicProducts = products.filter((product) => !product.ownerIsDemo);
  const demoProducts = products.filter((product) => product.ownerIsDemo);
  const organic = summarizeReuse(organicProducts, holders, uses, window, isDemo, false);
  const demo = summarizeReuse(demoProducts, holders, uses, window, isDemo, true);
  const minimum = MINIMUM_EVIDENCE.knowledgeReuse;
  const enough = organicProducts.length >= minimum.products;
  return {
    id: 'KNOWLEDGE_REUSE',
    state: enough ? 'OK' : 'NOT_ENOUGH_EVIDENCE',
    organic: { n: organicProducts.length, learners: organic.learners },
    demo: { n: demoProducts.length, learners: demo.learners },
    minimum,
    value: enough ? organic.value : null,
    demoValue: demo.value,
  };
};

export interface ConversionTopic {
  topicId: string;
  title: string;
  conceptIds: string[];
}

export interface ConversionLearner {
  userId: string;
  isDemo: boolean;
  isAdmin: boolean;
  mastery: Map<string, ConceptEvidence>;
  approvedCreator: boolean;
}

export interface ConversionTopicValue {
  topicId: string;
  title: string;
  concepts: number;
  eligible: number;
  converted: number;
}

export interface CreatorConversionValue {
  eligible: number;
  converted: number;
  conversion: number;
  topics: ConversionTopicValue[];
}

const summarizeConversion = (topics: ConversionTopic[], learners: ConversionLearner[]): CreatorConversionValue | null => {
  const eligibleUsers = new Set<string>();
  const convertedUsers = new Set<string>();
  const rows: ConversionTopicValue[] = topics.map((topic) => {
    const eligible = learners.filter((learner) => isCreatorEligible(aggregateTopic(topic.conceptIds, learner.mastery)));
    eligible.forEach((learner) => {
      eligibleUsers.add(learner.userId);
      if (learner.approvedCreator) convertedUsers.add(learner.userId);
    });
    return {
      topicId: topic.topicId,
      title: topic.title,
      concepts: new Set(topic.conceptIds).size,
      eligible: eligible.length,
      converted: eligible.filter((learner) => learner.approvedCreator).length,
    };
  });
  if (eligibleUsers.size === 0) return null;
  return { eligible: eligibleUsers.size, converted: convertedUsers.size, conversion: round(convertedUsers.size / eligibleUsers.size), topics: rows };
};

export const creatorConversion = (topics: ConversionTopic[], learners: ConversionLearner[]): MetricResult<CreatorConversionValue> => {
  const people = learners.filter((learner) => !learner.isAdmin);
  const organicPeople = people.filter((learner) => !learner.isDemo);
  const demoPeople = people.filter((learner) => learner.isDemo);
  const eligibleOf = (group: ConversionLearner[]) =>
    group.filter((learner) => topics.some((topic) => isCreatorEligible(aggregateTopic(topic.conceptIds, learner.mastery)))).map((learner) => ({ userId: learner.userId }));
  const organicEligible = eligibleOf(organicPeople);
  const demoEligible = eligibleOf(demoPeople);
  const minimum = MINIMUM_EVIDENCE.creatorConversion;
  const enough = organicEligible.length >= minimum.eligible;
  return {
    id: 'CREATOR_CONVERSION',
    state: enough ? 'OK' : 'NOT_ENOUGH_EVIDENCE',
    organic: { n: organicEligible.length, learners: organicEligible.length },
    demo: { n: demoEligible.length, learners: demoEligible.length },
    minimum,
    value: enough ? summarizeConversion(topics, organicPeople) : null,
    demoValue: summarizeConversion(topics, demoPeople),
  };
};

export interface PromptVersionRow {
  id: string;
  status: string;
}

export interface PromptAuditRow {
  action: string;
  entityId: string;
}

export interface BenchmarkRunRow {
  completed: boolean;
  decided: boolean;
  identicalArms: boolean;
  criteria: Array<{ id: string; status: string }>;
}

export interface OutcomeRow {
  userId: string;
  promptVersion: string;
  success: boolean;
}

export interface PromptEvidenceValue {
  drafts: { aiProposed: number; engineer: number; byStatus: Record<string, number> };
  benchmarkRuns: { completed: number; candidateRuns: number; identicalArmsRuns: number; decided: number; verdicts: Record<string, Record<string, number>> };
  canariesStarted: number;
  rollbacks: number;
  strategyOutcomes: Array<{ promptVersion: string; n: number; successes: number }>;
}

const count = (rows: PromptAuditRow[], action: string): number => rows.filter((row) => row.action === action).length;

export const promptEvidence = (
  versions: PromptVersionRow[],
  audit: PromptAuditRow[],
  runs: BenchmarkRunRow[],
  outcomes: OutcomeRow[],
  isDemo: (userId: string) => boolean,
): MetricResult<PromptEvidenceValue> => {
  const completed = runs.filter((run) => run.completed);
  const verdicts: Record<string, Record<string, number>> = {};
  for (const run of completed.filter((item) => !item.identicalArms)) {
    for (const criterion of run.criteria) {
      verdicts[criterion.id] = verdicts[criterion.id] ?? {};
      verdicts[criterion.id][criterion.status] = (verdicts[criterion.id][criterion.status] ?? 0) + 1;
    }
  }
  const byStatus: Record<string, number> = {};
  versions.forEach((version) => {
    byStatus[version.status] = (byStatus[version.status] ?? 0) + 1;
  });
  const perPrompt = new Map<string, { n: number; successes: number }>();
  outcomes.forEach((outcome) => {
    const current = perPrompt.get(outcome.promptVersion) ?? { n: 0, successes: 0 };
    perPrompt.set(outcome.promptVersion, { n: current.n + 1, successes: current.successes + (outcome.success ? 1 : 0) });
  });

  const decided = completed.filter((run) => run.decided).length;
  const minimum = MINIMUM_EVIDENCE.promptEvidence;
  const value: PromptEvidenceValue = {
    drafts: { aiProposed: count(audit, 'PROMPT_PROPOSED_BY_AI'), engineer: count(audit, 'PROMPT_PROPOSED'), byStatus },
    benchmarkRuns: {
      completed: completed.length,
      candidateRuns: completed.filter((run) => !run.identicalArms).length,
      identicalArmsRuns: completed.filter((run) => run.identicalArms).length,
      decided,
      verdicts,
    },
    canariesStarted: count(audit, 'PROMPT_CANARY_STARTED'),
    rollbacks: count(audit, 'PROMPT_ROLLED_BACK'),
    strategyOutcomes: [...perPrompt.entries()].map(([promptVersion, item]) => ({ promptVersion, ...item })).sort((a, b) => a.promptVersion.localeCompare(b.promptVersion)),
  };
  return {
    id: 'PROMPT_EVIDENCE',
    state: decided >= minimum.decidedRuns ? 'OK' : 'NOT_ENOUGH_EVIDENCE',
    organic: sampleOf(outcomes.filter((outcome) => !isDemo(outcome.userId))),
    demo: sampleOf(outcomes.filter((outcome) => isDemo(outcome.userId))),
    minimum,
    value,
    demoValue: null,
  };
};

export interface CircularityReport {
  definitionVersion: string;
  generatedAt: Date;
  window: TimeWindow;
  demoAccountDomain: string;
  metrics: Array<MetricResult<unknown>>;
}
