import { Injectable, Optional } from '@nestjs/common';
import { Prisma, SandboxPractice } from '@prisma/client';
import { PrismaService } from '@/common/config/prisma/prisma.service';
import { AppError, AppErrorCode } from '@/common/lib/error';
import { AssessmentGamifyService } from '@/v1/gamify/assessment-gamify.service';
import { RewardEngineService } from '@/v1/gamify/rewards/reward-engine.service';
import { LearnerEventsService } from '@/v1/learner-model/events/learner-events.service';
import { ConceptStateView, LearnerStateService } from '@/v1/learner-model/learner-state.service';
import { StrategyOutcomeService } from '@/v1/learner-model/strategy/strategy-outcome.service';
import { TeachingDecisionService } from '@/v1/learner-model/strategy/teaching-decision.service';
import { MisconceptionService } from '@/v1/personalization/misconception/misconception.service';
import { CheckJournalDto, ListScenariosQuery } from './dto/sandbox.dto';
import { paginate } from './paging';
import {
  HINT_LEVELS,
  JournalLine,
  MISCONCEPTION_LABELS,
  buildHints,
  describeKey,
  equationEffect,
  evaluateJournal,
  misconceptionsOf,
} from './engine';
import { SandboxContentService } from './sandbox-content.service';
import { SandboxScenarioDef } from './sandbox-content';

export const HINT_COOLDOWN_MS = 4000;
export const REVIEW_AFTER_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const DIFFICULTY_RANK = { BEGINNER: 0, INTERMEDIATE: 1, ADVANCED: 2 } as const;
const DIFFICULTY_THETA = { BEGINNER: -0.5, INTERMEDIATE: 0, ADVANCED: 0.75 } as const;
const MAX_EVIDENCE_ITEMS = 5;
const MIN_EVIDENCE_ITEMS = 3;
const GUESSING_ATTEMPTS = 3;

export type PracticeStatus = 'NEW' | 'IN_PROGRESS' | 'SOLVED';
export type Scaffold = 'HIGH' | 'MEDIUM' | 'MINIMAL';
export type RecommendationReason = 'START' | 'REMEDIATION' | 'PROGRESSION' | 'REVIEW';

export interface PracticeView {
  status: PracticeStatus;
  attempts: number;
  bestScore: number;
  hintLevel: number;
  revealed: boolean;
  solvedUnaided: boolean;
  solvedAt: Date | null;
}

export interface Recommendation {
  scenarioId: string;
  title: string;
  level: number;
  conceptId: string;
  reason: RecommendationReason;
  message: string;
}

export interface PracticeSignals {
  solved: number;
  total: number;
  openMisconceptions: Array<{ code: string; count: number; label: string }>;
  recentErrors: Array<{ code: string; count: number }>;
  weakConcepts: Array<{ conceptId: string; title: string; score: number }>;
  suggestion: Recommendation | null;
}

const EMPTY_VIEW: PracticeView = { status: 'NEW', attempts: 0, bestScore: 0, hintLevel: 0, revealed: false, solvedUnaided: false, solvedAt: null };

const viewOf = (row: SandboxPractice | null | undefined): PracticeView =>
  row
    ? {
        status: row.status === 'SOLVED' ? 'SOLVED' : row.attempts > 0 || row.hintLevel > 0 || row.revealed ? 'IN_PROGRESS' : 'NEW',
        attempts: row.attempts,
        bestScore: row.bestScore,
        hintLevel: row.hintLevel,
        revealed: row.revealed,
        solvedUnaided: row.solvedUnaided,
        solvedAt: row.solvedAt,
      }
    : EMPTY_VIEW;

const summaryOf = (scenario: SandboxScenarioDef, row?: SandboxPractice) => ({
  id: scenario.id,
  title: scenario.title,
  level: scenario.level,
  difficulty: scenario.difficulty,
  conceptId: scenario.conceptId,
  tags: scenario.tags,
  lineCount: scenario.key.length,
  practice: viewOf(row),
});

export const NOVICE_EVIDENCE = 2;
export const COMFORTABLE_MASTERY = 0.65;

export const scaffoldFor = (policyLevel: Scaffold | undefined, evidenceCount: number, mastery: number): Scaffold => {
  if (policyLevel === 'HIGH' || evidenceCount < NOVICE_EVIDENCE) return 'HIGH';
  if (policyLevel === 'MEDIUM' || mastery < COMFORTABLE_MASTERY) return 'MEDIUM';
  return 'MINIMAL';
};

const notFound = () => new AppError('Skenario tidak ditemukan', 404, AppErrorCode.NOT_FOUND);

@Injectable()
export class SandboxPracticeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly content: SandboxContentService,
    @Optional() private readonly learnerEvents?: LearnerEventsService,
    @Optional() private readonly strategyOutcomes?: StrategyOutcomeService,
    @Optional() private readonly rewards?: RewardEngineService,
    @Optional() private readonly gamify?: AssessmentGamifyService,
    @Optional() private readonly misconceptions?: MisconceptionService,
    @Optional() private readonly learnerState?: LearnerStateService,
    @Optional() private readonly decisions?: TeachingDecisionService,
  ) {}

  private async statesOf(userId: string, conceptIds: string[]): Promise<ConceptStateView[]> {
    if (!this.learnerState || conceptIds.length === 0) return [];
    try {
      return await this.learnerState.conceptStates(userId, conceptIds);
    } catch {
      return [];
    }
  }

  accounts() {
    return this.content.chart.all().map((account) => ({
      code: account.code,
      name: account.name,
      type: account.type,
      group: account.group,
      class: this.content.chart.classOf(account.code),
    }));
  }

  async catalog(userId: string, query: ListScenariosQuery) {
    const rows = await this.prisma.sandboxPractice.findMany({ where: { userId } });
    const byScenario = new Map(rows.map((row) => [row.scenarioId, row]));
    const needle = query.q?.toLowerCase();

    const scenarios = this.content
      .list({ level: query.level, conceptId: query.conceptId, difficulty: query.difficulty, tag: query.tag })
      .filter((scenario) => !needle || scenario.title.toLowerCase().includes(needle) || scenario.story.toLowerCase().includes(needle))
      .map((scenario) => summaryOf(scenario, byScenario.get(scenario.id)))
      .filter((item) => !query.status || item.practice.status === query.status);

    const paged = paginate(scenarios, query.limit, query.cursor);
    return {
      summary: this.summarize(rows),
      scenarios: paged.items,
      page: paged.page,
      recommended: await this.recommend(userId, rows),
    };
  }

  private summarize(rows: SandboxPractice[]) {
    const all = this.content.list();
    const solvedIds = new Set(rows.filter((row) => row.status === 'SOLVED').map((row) => row.scenarioId));
    const levels = [1, 2, 3, 4].map((level) => {
      const inLevel = all.filter((scenario) => scenario.level === level);
      return { level, total: inLevel.length, solved: inLevel.filter((scenario) => solvedIds.has(scenario.id)).length };
    });
    return {
      total: all.length,
      solved: solvedIds.size,
      solvedUnaided: rows.filter((row) => row.status === 'SOLVED' && row.solvedUnaided).length,
      inProgress: rows.filter((row) => viewOf(row).status === 'IN_PROGRESS').length,
      levels: levels.filter((entry) => entry.total > 0),
    };
  }

  async detail(userId: string, id: string) {
    const scenario = this.content.find(id);
    if (!scenario) throw notFound();
    const row = await this.prisma.sandboxPractice.findUnique({ where: { userId_scenarioId: { userId, scenarioId: id } } });
    const practice = viewOf(row);
    const personalization = await this.personalize(userId, scenario, practice);
    const hints = buildHints(scenario.key, this.content.chart);

    return {
      ...summaryOf(scenario, row ?? undefined),
      story: scenario.story,
      accounts: this.accounts(),
      lastLines: practice.status === 'SOLVED' ? null : (row?.lastLines ?? null),
      hints: hints.slice(0, practice.hintLevel),
      personalization,
      example: personalization.showExample && scenario.example ? { story: scenario.example.story, key: describeKey(scenario.example.key, this.content.chart), why: scenario.example.why } : null,
      solution: practice.status === 'SOLVED' ? this.solutionOf(scenario) : null,
    };
  }

  private solutionOf(scenario: SandboxScenarioDef) {
    return { key: describeKey(scenario.key, this.content.chart), why: scenario.why, equation: equationEffect(scenario.key, this.content.chart) };
  }

  private async personalize(userId: string, scenario: SandboxScenarioDef, practice: PracticeView) {
    const [decision, [state]] = await Promise.all([
      this.decisions?.decide(userId, { conceptIds: [scenario.conceptId], intent: 'PRACTICE' }).catch(() => null) ?? Promise.resolve(null),
      this.statesOf(userId, [scenario.conceptId]),
    ]);
    const evidenceCount = state?.mastery.evidenceCount ?? 0;
    const mastery = state?.mastery.score ?? 0.5;
    const scaffold = scaffoldFor(decision?.scaffoldLevel, evidenceCount, mastery);
    return {
      scaffold,
      strategy: decision?.strategy ?? null,
      reasonCodes: decision?.reasonCodes ?? [],
      mastery: Math.round(mastery * 100) / 100,
      evidenceCount,
      showExample: scaffold === 'HIGH' && practice.status !== 'SOLVED',
      equationPanelOpen: scaffold !== 'MINIMAL',
    };
  }

  async check(userId: string, id: string, dto: CheckJournalDto) {
    const scenario = this.content.find(id);
    if (!scenario) throw notFound();
    const lines = dto.lines as JournalLine[];
    for (const line of lines) {
      if (!this.content.chart.has(line.account)) throw new AppError(`Akun ${line.account} tidak ada di bagan akun`, 400, AppErrorCode.VALIDATION_ERROR);
    }
    const diagnosis = evaluateJournal(lines, scenario, this.content.chart);

    const outcome = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sandbox:${userId}:${scenario.id}`}))`;
      const practice = await tx.sandboxPractice.upsert({
        where: { userId_scenarioId: { userId, scenarioId: scenario.id } },
        create: { userId, scenarioId: scenario.id },
        update: {},
      });
      const attemptNumber = practice.attempts + 1;
      const check = await tx.sandboxCheck.create({
        data: {
          userId,
          scenarioId: scenario.id,
          attemptNumber,
          lines: lines as unknown as Prisma.InputJsonValue,
          score: diagnosis.score,
          correct: diagnosis.correct,
          findingCodes: diagnosis.findings.map((finding) => finding.code),
          hintLevel: practice.hintLevel,
        },
        select: { id: true },
      });
      const firstSolve = diagnosis.correct && practice.status !== 'SOLVED';
      const updated = await tx.sandboxPractice.update({
        where: { id: practice.id },
        data: {
          attempts: attemptNumber,
          bestScore: Math.max(practice.bestScore, diagnosis.score),
          lastLines: lines as unknown as Prisma.InputJsonValue,
          ...(firstSolve ? { status: 'SOLVED', solvedAt: new Date(), solvedUnaided: !practice.revealed } : {}),
        },
      });
      const learning = firstSolve && !practice.revealed ? await this.recordEvidence(tx, userId, scenario, { attemptId: check.id, hintLevel: practice.hintLevel, attempts: attemptNumber }) : undefined;
      return { updated, firstSolve, learning, attemptNumber };
    });

    if (!diagnosis.correct) await this.recordMisconceptions(userId, scenario, diagnosis.findings);

    return {
      correct: diagnosis.correct,
      score: diagnosis.score,
      balanced: diagnosis.balanced,
      totalDebit: diagnosis.totalDebit,
      totalCredit: diagnosis.totalCredit,
      difference: diagnosis.difference,
      verdicts: diagnosis.verdicts,
      missingBySide: diagnosis.missingBySide,
      findings: diagnosis.findings,
      equation: diagnosis.equation,
      attemptNumber: outcome.attemptNumber,
      firstSolve: outcome.firstSolve,
      practice: viewOf(outcome.updated),
      explanation: diagnosis.correct ? scenario.why : null,
      learning: outcome.learning ?? null,
      next: diagnosis.correct ? await this.recommend(userId) : null,
    };
  }

  private async recordEvidence(
    tx: Prisma.TransactionClient,
    userId: string,
    scenario: SandboxScenarioDef,
    context: { attemptId: string; hintLevel: number; attempts: number },
  ) {
    if (!this.learnerEvents) return undefined;
    const concept = await tx.concept.findUnique({ where: { id: scenario.conceptId }, select: { status: true } });
    if (!concept || concept.status !== 'ACTIVE') return undefined;

    const idempotencyKey = `sandbox:${userId}:${scenario.id}`;
    const stored = await this.learnerEvents.append(
      {
        userId,
        conceptId: scenario.conceptId,
        idempotencyKey,
        payload: {
          attemptId: context.attemptId,
          quizId: `sandbox:${scenario.id}`,
          score: 1,
          items: Math.min(MAX_EVIDENCE_ITEMS, Math.max(MIN_EVIDENCE_ITEMS, scenario.key.length + 1)),
          hintsUsed: context.hintLevel,
          share: 1,
          attemptNumber: context.attempts > GUESSING_ATTEMPTS ? 2 : 1,
          difficulty: DIFFICULTY_THETA[scenario.difficulty],
        },
      },
      tx,
    );
    if (stored.duplicate) return undefined;

    await this.strategyOutcomes?.attribute(tx, {
      userId,
      conceptId: scenario.conceptId,
      eventKey: idempotencyKey,
      scoreBefore: stored.before.score,
      scoreAfter: stored.state.score,
    });
    const rewarded = await this.rewards?.onAssessment(
      { userId, conceptId: scenario.conceptId, eventId: stored.eventId, duplicate: false, after: stored.state },
      tx,
    );
    const gamified = this.gamify
      ? await this.gamify.afterAssessment({ userId, subTopicId: null, at: new Date(), xpGained: rewarded?.points ?? 0, passed: true }, tx)
      : undefined;

    return {
      conceptId: scenario.conceptId,
      masteryBefore: stored.before.score,
      masteryAfter: stored.state.score,
      xpGained: gamified?.xpGained ?? rewarded?.points ?? 0,
      starsGained: gamified?.starsGained ?? 0,
      streak: gamified?.streak ?? null,
      achievements: gamified?.achievements ?? [],
    };
  }

  private async recordMisconceptions(userId: string, scenario: SandboxScenarioDef, findings: Parameters<typeof misconceptionsOf>[0]) {
    if (!this.misconceptions) return;
    for (const code of misconceptionsOf(findings, scenario.targets)) {
      await this.misconceptions.recordTagged({ userId, code, questionId: `sandbox:${scenario.id}`, userAnswer: findings.map((finding) => finding.code).join(',') }).catch(() => null);
    }
  }

  private async variantOf(userId: string, id: string, seed: number) {
    const base = this.content.find(id);
    if (!base) throw notFound();
    const row = await this.prisma.sandboxPractice.findUnique({ where: { userId_scenarioId: { userId, scenarioId: id } }, select: { status: true } });
    if (row?.status !== 'SOLVED') {
      throw new AppError('Latihan dengan angka lain terbuka setelah kamu menyelesaikan skenario ini', 409, AppErrorCode.INVALID_STATE_TRANSITION);
    }
    const scaled = this.content.variant(base, seed);
    if (!scaled) throw new AppError('Skenario ini belum punya variasi angka', 409, AppErrorCode.INVALID_STATE_TRANSITION);
    return { base, scenario: scaled.scenario };
  }

  async variantDetail(userId: string, id: string, seed: number) {
    const { base, scenario } = await this.variantOf(userId, id, seed);
    return {
      seed,
      scenarioId: base.id,
      title: base.title,
      level: base.level,
      difficulty: base.difficulty,
      conceptId: base.conceptId,
      lineCount: scenario.key.length,
      story: scenario.story,
      accounts: this.accounts(),
      hints: buildHints(scenario.key, this.content.chart),
      variantCount: this.content.variantCount(base),
      countsAsEvidence: false,
    };
  }

  async checkVariant(userId: string, id: string, seed: number, dto: CheckJournalDto) {
    const { scenario } = await this.variantOf(userId, id, seed);
    const lines = dto.lines as JournalLine[];
    for (const line of lines) {
      if (!this.content.chart.has(line.account)) throw new AppError(`Akun ${line.account} tidak ada di bagan akun`, 400, AppErrorCode.VALIDATION_ERROR);
    }
    const diagnosis = evaluateJournal(lines, scenario, this.content.chart);
    return {
      seed,
      correct: diagnosis.correct,
      score: diagnosis.score,
      balanced: diagnosis.balanced,
      totalDebit: diagnosis.totalDebit,
      totalCredit: diagnosis.totalCredit,
      difference: diagnosis.difference,
      verdicts: diagnosis.verdicts,
      missingBySide: diagnosis.missingBySide,
      findings: diagnosis.findings,
      equation: diagnosis.equation,
      explanation: diagnosis.correct ? scenario.why : null,
      solution: diagnosis.correct ? this.solutionOf(scenario) : null,
      countsAsEvidence: false,
    };
  }

  async revealVariant(userId: string, id: string, seed: number) {
    const { scenario } = await this.variantOf(userId, id, seed);
    return { seed, ...this.solutionOf(scenario), countsAsEvidence: false };
  }

  async hint(userId: string, id: string) {
    const scenario = this.content.find(id);
    if (!scenario) throw notFound();
    const hints = buildHints(scenario.key, this.content.chart);

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sandbox:${userId}:${scenario.id}`}))`;
      const practice = await tx.sandboxPractice.upsert({
        where: { userId_scenarioId: { userId, scenarioId: scenario.id } },
        create: { userId, scenarioId: scenario.id },
        update: {},
      });
      if (practice.status === 'SOLVED') throw new AppError('Skenario ini sudah selesai', 409, AppErrorCode.INVALID_STATE_TRANSITION);
      if (practice.hintLevel >= HINT_LEVELS) return { level: HINT_LEVELS, hints, remaining: 0, canReveal: true };

      const waited = practice.hintAt ? Date.now() - practice.hintAt.getTime() : HINT_COOLDOWN_MS;
      if (practice.hintLevel > 0 && waited < HINT_COOLDOWN_MS) {
        const seconds = Math.ceil((HINT_COOLDOWN_MS - waited) / 1000);
        throw new AppError(`Baca petunjuk sebelumnya dulu. Petunjuk berikutnya bisa dibuka dalam ${seconds} detik.`, 429, AppErrorCode.TOO_MANY_REQUESTS);
      }
      const level = practice.hintLevel + 1;
      await tx.sandboxPractice.update({ where: { id: practice.id }, data: { hintLevel: level, hintAt: new Date() } });
      return { level, hints: hints.slice(0, level), remaining: HINT_LEVELS - level, canReveal: practice.attempts >= 1 || level >= HINT_LEVELS };
    });
  }

  async reveal(userId: string, id: string) {
    const scenario = this.content.find(id);
    if (!scenario) throw notFound();

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sandbox:${userId}:${scenario.id}`}))`;
      const practice = await tx.sandboxPractice.upsert({
        where: { userId_scenarioId: { userId, scenarioId: scenario.id } },
        create: { userId, scenarioId: scenario.id },
        update: {},
      });
      if (practice.status === 'SOLVED') return { ...this.solutionOf(scenario), countsAsEvidence: false };
      if (practice.attempts < 1 && practice.hintLevel < HINT_LEVELS) {
        throw new AppError('Coba catat jurnalnya dulu atau buka petunjuk sebelum melihat jawaban', 409, AppErrorCode.INVALID_STATE_TRANSITION);
      }
      if (!practice.revealed) await tx.sandboxPractice.update({ where: { id: practice.id }, data: { revealed: true } });
      return { ...this.solutionOf(scenario), countsAsEvidence: false };
    });
  }

  async recommend(userId: string, knownRows?: SandboxPractice[]): Promise<Recommendation | null> {
    const rows = knownRows ?? (await this.prisma.sandboxPractice.findMany({ where: { userId } }));
    const byScenario = new Map(rows.map((row) => [row.scenarioId, row]));
    const all = this.content.list();
    const [states, open] = await Promise.all([
      this.statesOf(userId, this.content.conceptIds()),
      this.prisma.misconception.findMany({ where: { userId, status: 'OPEN' }, select: { conceptKey: true, count: true } }),
    ]);
    const stateOf = new Map(states.map((state) => [state.conceptId, state]));
    const masteryOf = (conceptId: string) => stateOf.get(conceptId)?.mastery.score ?? 0.5;
    const evidenced = states.filter((state) => state.mastery.evidenceCount > 0);
    const average = evidenced.length > 0 ? evidenced.reduce((sum, state) => sum + state.mastery.score, 0) / evidenced.length : 0;
    const targetRank = average === 0 || average < 0.45 ? 0 : average < 0.7 ? 1 : 2;
    const openCounts = new Map(open.map((entry) => [entry.conceptKey, entry.count]));
    const lastConcept = [...rows].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
    const lastConceptId = lastConcept ? this.content.find(lastConcept.scenarioId)?.conceptId : undefined;
    const now = Date.now();

    const unsolved = all.filter((scenario) => byScenario.get(scenario.id)?.status !== 'SOLVED');
    const reviewable = all.filter((scenario) => {
      const row = byScenario.get(scenario.id);
      return row?.status === 'SOLVED' && row.solvedAt !== null && now - row.solvedAt.getTime() > REVIEW_AFTER_DAYS * DAY_MS && masteryOf(scenario.conceptId) < 0.8;
    });
    const pool = unsolved.length > 0 ? unsolved : reviewable;
    if (pool.length === 0) return null;

    const scored = pool.map((scenario) => {
      const matched = scenario.targets.filter((target) => openCounts.has(target));
      const remediation = matched.reduce((sum, target) => sum + Math.min(3, openCounts.get(target) ?? 0), 0);
      const value =
        Math.min(4, remediation) +
        (1 - masteryOf(scenario.conceptId)) * 2 -
        (stateOf.get(scenario.conceptId)?.prerequisiteMasteryMet === false ? 1.5 : 0) -
        0.7 * Math.abs(DIFFICULTY_RANK[scenario.difficulty] - targetRank) -
        (scenario.conceptId === lastConceptId ? 2 : 0) -
        0.1 * scenario.level;
      return { scenario, value, matched: matched.sort((a, b) => (openCounts.get(b) ?? 0) - (openCounts.get(a) ?? 0))[0] };
    });
    scored.sort((a, b) => b.value - a.value || a.scenario.id.localeCompare(b.scenario.id));
    const best = scored[0]!;

    const reason: RecommendationReason =
      unsolved.length === 0 ? 'REVIEW' : best.matched ? 'REMEDIATION' : rows.length === 0 ? 'START' : 'PROGRESSION';
    const messages: Record<RecommendationReason, string> = {
      START: 'Mulai dari sini: transaksi sederhana untuk membiasakan sisi debit dan kredit.',
      REMEDIATION: `Latihan ini menargetkan kebiasaan yang masih keliru: kamu ${MISCONCEPTION_LABELS[best.matched ?? ''] ?? 'masih perlu berlatih bagian ini'}.`,
      PROGRESSION: 'Langkah berikutnya yang pas dengan penguasaanmu saat ini.',
      REVIEW: 'Sudah lebih dari seminggu sejak kamu menyelesaikan ini. Ulangi sebentar supaya tidak lupa.',
    };

    return {
      scenarioId: best.scenario.id,
      title: best.scenario.title,
      level: best.scenario.level,
      conceptId: best.scenario.conceptId,
      reason,
      message: messages[reason],
    };
  }

  async signals(userId: string): Promise<PracticeSignals> {
    const since = new Date(Date.now() - 14 * DAY_MS);
    const [rows, open, recent] = await Promise.all([
      this.prisma.sandboxPractice.findMany({ where: { userId } }),
      this.prisma.misconception.findMany({ where: { userId, status: 'OPEN' }, orderBy: { count: 'desc' }, take: 3, select: { conceptKey: true, count: true } }),
      this.prisma.sandboxCheck.findMany({ where: { userId, createdAt: { gte: since }, correct: false }, select: { findingCodes: true }, take: 200, orderBy: { createdAt: 'desc' } }),
    ]);

    const errorCounts = new Map<string, number>();
    for (const check of recent) for (const code of new Set(check.findingCodes)) errorCounts.set(code, (errorCounts.get(code) ?? 0) + 1);

    const practiced = Array.from(new Set(rows.map((row) => this.content.find(row.scenarioId)?.conceptId).filter((value): value is string => Boolean(value))));
    const states = await this.statesOf(userId, practiced);

    return {
      solved: rows.filter((row) => row.status === 'SOLVED').length,
      total: this.content.list().length,
      openMisconceptions: open
        .filter((entry) => MISCONCEPTION_LABELS[entry.conceptKey])
        .map((entry) => ({ code: entry.conceptKey, count: entry.count, label: MISCONCEPTION_LABELS[entry.conceptKey]! })),
      recentErrors: Array.from(errorCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([code, count]) => ({ code, count })),
      weakConcepts: states
        .filter((state) => state.mastery.evidenceCount > 0)
        .sort((a, b) => a.mastery.score - b.mastery.score)
        .slice(0, 2)
        .map((state) => ({ conceptId: state.conceptId, title: state.title, score: Math.round(state.mastery.score * 100) / 100 })),
      suggestion: await this.recommend(userId, rows),
    };
  }
}
