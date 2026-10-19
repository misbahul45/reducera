import { Injectable } from '@nestjs/common';
import { Actor, PolicyService } from '@/common/authz/policy.service';
import { PrismaService } from '@/common/config/prisma/prisma.service';
import { AppError, AppErrorCode } from '@/common/lib/error';
import { ConceptRegistryService } from '../learner-model/concepts/concept-registry.service';
import { ASSESSMENT_COMPLETED } from '../learner-model/mastery/assessment-payload';
import { ConceptEvidence } from '../learner-model/mastery/topic-aggregate';
import { offlineCriteria } from '../optimization/acceptance-gate';
import { BENCHMARK_OPTIMIZER, BenchmarkPlan } from '../optimization/benchmark/benchmark.types';
import {
  BenchmarkRunRow,
  CIRCULARITY_DEFINITION_VERSION,
  CircularityReport,
  ConversionLearner,
  ConversionTopic,
  DEMO_ACCOUNT_DOMAIN,
  OutcomeRow,
  PromptAuditRow,
  ReuseHolder,
  ReuseProduct,
  ReuseUse,
  StoredAssessment,
  TimeWindow,
  creatorConversion,
  isDemoAccount,
  knowledgeReuse,
  masteryChange,
  observeAssessments,
  promptEvidence,
  resolveWindow,
  reviewOutcome,
} from './circularity-metrics';
import { CircularityQueryDtoType } from './circularity.dto';

const PROMPT_ACTIONS = ['PROMPT_PROPOSED', 'PROMPT_PROPOSED_BY_AI', 'PROMPT_CANARY_STARTED', 'PROMPT_ROLLED_BACK'];

interface UserInfo {
  email: string;
  role: string;
}

@Injectable()
export class CircularityMetricsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly registry: ConceptRegistryService,
  ) {}

  async report(actor: Actor, query: CircularityQueryDtoType, now: Date = new Date()) {
    this.policy.assertAdmin(actor);
    const window = this.window(query, now);

    const assessments = await this.assessments(window);
    const products = await this.products();
    const holders = await this.holders(products, window);
    const topics = await this.topics();
    const mastery = await this.masteryByUser(topics);
    const creators = await this.approvedCreators();
    const outcomes = await this.outcomes(window);

    const userIds = new Set<string>([
      ...assessments.map((row) => row.userId),
      ...holders.map((row) => row.userId),
      ...products.map((row) => row.ownerId),
      ...mastery.keys(),
      ...outcomes.map((row) => row.userId),
    ]);
    const users = await this.users([...userIds]);
    const isDemo = (userId: string) => {
      const info = users.get(userId);
      return info ? isDemoAccount(info.email) : false;
    };

    const observations = observeAssessments(assessments, window);
    const uses: ReuseUse[] = assessments.map((row) => ({ userId: row.userId, conceptId: row.conceptId, occurredAt: row.occurredAt }));
    const reuseProducts: ReuseProduct[] = products.map((product) => ({ ...product, ownerIsDemo: isDemo(product.ownerId) }));
    const learners: ConversionLearner[] = [...mastery.entries()].map(([userId, rows]) => ({
      userId,
      isDemo: isDemo(userId),
      isAdmin: users.get(userId)?.role === 'ADMIN',
      mastery: rows,
      approvedCreator: creators.has(userId),
    }));

    const report: CircularityReport = {
      definitionVersion: CIRCULARITY_DEFINITION_VERSION,
      generatedAt: now,
      window,
      demoAccountDomain: DEMO_ACCOUNT_DOMAIN,
      metrics: [
        masteryChange(observations, isDemo),
        reviewOutcome(observations, isDemo),
        knowledgeReuse(reuseProducts, holders, uses, window, isDemo),
        creatorConversion(topics, learners),
        await this.prompts(window, outcomes, isDemo),
      ],
    };
    return { message: 'Successfully retrieved circularity metrics', data: report };
  }

  private window(query: CircularityQueryDtoType, now: Date): TimeWindow {
    try {
      return resolveWindow(query, now);
    } catch (error) {
      throw new AppError((error as Error).message, 422, AppErrorCode.VALIDATION_ERROR);
    }
  }

  private async assessments(window: TimeWindow): Promise<StoredAssessment[]> {
    const active = await this.prisma.learningEvent.findMany({
      where: { eventType: ASSESSMENT_COMPLETED, conceptId: { not: null }, occurredAt: { gte: window.from, lt: window.to } },
      select: { userId: true },
      distinct: ['userId'],
    });
    if (active.length === 0) return [];
    const rows = await this.prisma.learningEvent.findMany({
      where: {
        eventType: ASSESSMENT_COMPLETED,
        conceptId: { not: null },
        streamSeq: { not: null },
        userId: { in: active.map((row) => row.userId) },
        occurredAt: { lt: window.to },
      },
      select: { userId: true, conceptId: true, streamSeq: true, occurredAt: true, payload: true },
      orderBy: [{ userId: 'asc' }, { streamSeq: 'asc' }],
    });
    return rows.map((row) => ({
      userId: row.userId,
      conceptId: row.conceptId as string,
      streamSeq: row.streamSeq as number,
      occurredAt: row.occurredAt,
      payload: row.payload,
    }));
  }

  private async products(): Promise<Array<Omit<ReuseProduct, 'ownerIsDemo'>>> {
    const approved = { some: { status: 'APPROVED' as const } };
    const [classes, articles] = await Promise.all([
      this.prisma.classProduct.findMany({
        where: { status: 'PUBLISHED', conceptLinks: approved },
        select: { id: true, title: true, instructorId: true, conceptLinks: { where: { status: 'APPROVED' }, select: { conceptId: true } } },
      }),
      this.prisma.article.findMany({
        where: { status: 'PUBLISHED', conceptLinks: approved },
        select: { id: true, title: true, authorId: true, conceptLinks: { where: { status: 'APPROVED' }, select: { conceptId: true } } },
      }),
    ]);
    return [
      ...classes.map((row) => ({ kind: 'class' as const, id: row.id, title: row.title, ownerId: row.instructorId, conceptIds: row.conceptLinks.map((link) => link.conceptId) })),
      ...articles.map((row) => ({ kind: 'article' as const, id: row.id, title: row.title, ownerId: row.authorId, conceptIds: row.conceptLinks.map((link) => link.conceptId) })),
    ];
  }

  private async holders(products: Array<Omit<ReuseProduct, 'ownerIsDemo'>>, window: TimeWindow): Promise<ReuseHolder[]> {
    const classIds = products.filter((product) => product.kind === 'class').map((product) => product.id);
    const articleIds = products.filter((product) => product.kind === 'article').map((product) => product.id);
    if (classIds.length === 0 && articleIds.length === 0) return [];
    const rows = await this.prisma.entitlement.findMany({
      where: {
        status: 'ACTIVE',
        createdAt: { gte: window.from, lt: window.to },
        OR: [{ classId: { in: classIds } }, { articleId: { in: articleIds } }],
      },
      select: { userId: true, classId: true, articleId: true, startsAt: true },
    });
    return rows.flatMap((row): ReuseHolder[] => {
      if (row.classId) return [{ kind: 'class', productId: row.classId, userId: row.userId, startsAt: row.startsAt }];
      if (row.articleId) return [{ kind: 'article', productId: row.articleId, userId: row.userId, startsAt: row.startsAt }];
      return [];
    });
  }

  private async topics(): Promise<ConversionTopic[]> {
    const topics = await this.prisma.topic.findMany({ select: { id: true, title: true }, orderBy: { title: 'asc' } });
    const resolved = await Promise.all(topics.map(async (topic) => ({ topicId: topic.id, title: topic.title, conceptIds: await this.registry.topicConceptIds(topic.id) })));
    return resolved.filter((topic) => topic.conceptIds.length > 0);
  }

  private async masteryByUser(topics: ConversionTopic[]): Promise<Map<string, Map<string, ConceptEvidence>>> {
    const conceptIds = [...new Set(topics.flatMap((topic) => topic.conceptIds))];
    const byUser = new Map<string, Map<string, ConceptEvidence>>();
    if (conceptIds.length === 0) return byUser;
    const rows = await this.prisma.conceptMastery.findMany({
      where: { conceptId: { in: conceptIds } },
      select: { userId: true, conceptId: true, score: true, evidenceCount: true, lastEventAt: true },
    });
    for (const row of rows) {
      const own = byUser.get(row.userId) ?? new Map<string, ConceptEvidence>();
      own.set(row.conceptId, { score: row.score, evidenceCount: row.evidenceCount, lastEventAt: row.lastEventAt });
      byUser.set(row.userId, own);
    }
    return byUser;
  }

  private async approvedCreators(): Promise<Set<string>> {
    const rows = await this.prisma.teacherApplication.findMany({ where: { status: 'APPROVED' }, select: { userId: true } });
    return new Set(rows.map((row) => row.userId));
  }

  private async outcomes(window: TimeWindow): Promise<OutcomeRow[]> {
    return this.prisma.strategyOutcome.findMany({
      where: { createdAt: { gte: window.from, lt: window.to } },
      select: { userId: true, promptVersion: true, success: true },
    });
  }

  private async users(ids: string[]): Promise<Map<string, UserInfo>> {
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, email: true, role: true } });
    return new Map(rows.map((row) => [row.id, { email: row.email, role: row.role }]));
  }

  private async prompts(window: TimeWindow, outcomes: OutcomeRow[], isDemo: (userId: string) => boolean) {
    const inWindow = { gte: window.from, lt: window.to };
    const [versions, audit, runs] = await Promise.all([
      this.prisma.promptVersion.findMany({ select: { id: true, status: true } }),
      this.prisma.auditLog.findMany({ where: { action: { in: PROMPT_ACTIONS }, createdAt: inWindow }, select: { action: true, entityId: true } }),
      this.prisma.optimizationRun.findMany({ where: { optimizerName: BENCHMARK_OPTIMIZER, createdAt: inWindow }, select: { decision: true, candidateJson: true } }),
    ]);
    const runRows: BenchmarkRunRow[] = runs.map((run) => {
      const plan = run.candidateJson as unknown as BenchmarkPlan;
      return {
        completed: plan.status === 'COMPLETED',
        decided: run.decision !== 'PENDING',
        identicalArms: plan.identicalArms,
        criteria: plan.report ? offlineCriteria(plan.report.evidence).map((criterion) => ({ id: criterion.id, status: criterion.status })) : [],
      };
    });
    const auditRows: PromptAuditRow[] = audit;
    return promptEvidence(versions, auditRows, runRows, outcomes, isDemo);
  }
}
