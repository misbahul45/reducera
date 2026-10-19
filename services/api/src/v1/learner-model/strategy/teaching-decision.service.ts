import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/common/config/prisma/prisma.service';
import { ConceptRegistryService } from '../concepts/concept-registry.service';
import { ConceptView } from '../concepts/concept.types';
import { LearnerStateService } from '../learner-state.service';
import { LearnerPolicyService, TEACHING_POLICY_VERSION } from '../policy/learner-policy.service';
import { PolicyIntent, ScaffoldLevel, StrategyReasonCode, TeachingStrategy } from '../policy/policy.types';
import { hasPassed } from '../mastery/topic-aggregate';
import { MicrolearningPlan, planMicrolearning } from './microlearning';
import { StrategyOutcomeService } from './strategy-outcome.service';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface TeachingDecisionView {
  conceptId: string;
  intent: PolicyIntent;
  strategy: TeachingStrategy;
  hintLevel: 0 | 1 | 2 | 3;
  scaffoldLevel: ScaffoldLevel;
  difficultyTarget: number;
  maxAttempts: number;
  reasonCodes: StrategyReasonCode[];
  policyVersion: string;
  personalEvidenceAttempts: number;
  evidenceSufficient: boolean;
  microlearning: MicrolearningPlan;
}

export const conceptDifficulty = (level: number, concepts: Pick<ConceptView, 'level'>[]): number => {
  if (concepts.length === 0) return 0.5;
  const levels = concepts.map((concept) => concept.level);
  const low = Math.min(...levels);
  const high = Math.max(...levels);
  return high === low ? 0.5 : (level - low) / (high - low);
};

@Injectable()
export class TeachingDecisionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly state: LearnerStateService,
    private readonly registry: ConceptRegistryService,
    private readonly policy: LearnerPolicyService,
    private readonly outcomes: StrategyOutcomeService,
  ) {}

  async decide(
    userId: string,
    input: { conceptIds: string[]; intent: PolicyIntent },
    now: Date = new Date(),
  ): Promise<TeachingDecisionView | null> {
    const conceptId = input.conceptIds[0];
    if (!conceptId) return null;

    const [concept, concepts, openMisconceptions, evidence, chunkEvidence] = await Promise.all([
      this.state.conceptState(userId, conceptId),
      this.registry.listActive(),
      this.prisma.misconception.count({ where: { userId, status: 'OPEN' } }),
      this.outcomes.evidence(userId),
      this.outcomes.chunkEvidence(userId),
    ]);
    if (!concept) return null;

    const difficulty = conceptDifficulty(concept.level, concepts);
    const lastEventAt = concept.mastery.lastEventAt;
    const decision = this.policy.teachingStrategy({
      intent: input.intent,
      learner: {
        mastery: concept.mastery.score,
        evidenceCount: concept.mastery.evidenceCount,
        openMisconceptionCount: openMisconceptions,
        daysSinceLastReview: lastEventAt ? Math.max(0, Math.floor((now.getTime() - lastEventAt.getTime()) / DAY_MS)) : 0,
        recentItemDifficulty: difficulty,
      },
      concept: {
        prerequisiteMasteryMet: concept.prerequisiteMasteryMet,
        isTransferEligible: hasPassed({ score: concept.mastery.score, evidenceCount: concept.mastery.evidenceCount }),
        difficulty,
      },
      policy: { strategyEvidence: evidence },
    });

    return {
      conceptId,
      intent: input.intent,
      strategy: decision.strategy,
      hintLevel: decision.hintLevel,
      scaffoldLevel: decision.scaffoldLevel,
      difficultyTarget: decision.difficultyTarget,
      maxAttempts: decision.maxAttempts,
      reasonCodes: decision.reasonCodes,
      policyVersion: TEACHING_POLICY_VERSION,
      personalEvidenceAttempts: Object.values(evidence).reduce((sum, stat) => sum + stat.attempts, 0),
      evidenceSufficient: decision.invariants.policyEvidenceSufficient,
      microlearning: planMicrolearning({
        scaffoldLevel: decision.scaffoldLevel,
        mastery: concept.mastery.score,
        evidenceCount: concept.mastery.evidenceCount,
        prerequisiteMasteryMet: concept.prerequisiteMasteryMet,
        evidence: chunkEvidence,
      }),
    };
  }
}
