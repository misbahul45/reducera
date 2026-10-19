import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/common/config/prisma/prisma.service';
import {
  REVIEW_MODEL_VERSION,
  ReviewInput,
  ReviewItem,
  ReviewKind,
  ReviewSessionPlan,
  buildReviewQueue,
  planReviewSession,
} from './review-schedule';

export const REVIEW_LIST_LIMIT = 20;

export interface ReviewTarget {
  userStepId: string;
  stepTemplateId: string | null;
}

export interface ReviewEntry {
  conceptId: string;
  title: string;
  level: number;
  kind: ReviewKind;
  score: number;
  evidenceCount: number;
  daysSince: number;
  retrievability: number;
  intervalDays: number;
  dueAt: Date;
  overdueDays: number;
  target: ReviewTarget | null;
}

export interface ReviewView {
  reminders: boolean;
  policyVersion: string;
  generatedAt: Date;
  dueTotal: number;
  due: ReviewEntry[];
  upcoming: ReviewEntry[];
  session: ReviewSessionPlan;
}

const round = (value: number, places: number): number => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

@Injectable()
export class ReviewService {
  constructor(private readonly prisma: PrismaService) {}

  async setReminders(userId: string, enabled: boolean) {
    await this.prisma.user.update({ where: { id: userId }, data: { reviewReminders: enabled } });
    return { reminders: enabled };
  }

  async queue(userId: string, now: Date = new Date()): Promise<ReviewView> {
    const [owner, rows] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { reviewReminders: true } }),
      this.prisma.conceptMastery.findMany({
        where: { userId, evidenceCount: { gt: 0 }, concept: { status: 'ACTIVE' } },
        select: {
          conceptId: true,
          score: true,
          evidenceCount: true,
          lastEventAt: true,
          concept: { select: { title: true, level: true, sortOrder: true } },
        },
      }),
    ]);

    const details = new Map(rows.map((row) => [row.conceptId, row.concept]));
    const inputs: ReviewInput[] = rows.map((row) => ({
      conceptId: row.conceptId,
      score: row.score,
      evidenceCount: row.evidenceCount,
      lastEventAt: row.lastEventAt,
    }));

    const { due, upcoming } = buildReviewQueue(inputs, now);
    const shownDue = due.slice(0, REVIEW_LIST_LIMIT);
    const targets = await this.targets(userId, [...shownDue, ...upcoming].map((item) => item.conceptId));
    const entry = (item: ReviewItem): ReviewEntry => {
      const concept = details.get(item.conceptId);
      return {
        conceptId: item.conceptId,
        title: concept?.title ?? item.conceptId,
        level: concept?.level ?? 0,
        kind: item.kind,
        score: round(item.score, 4),
        evidenceCount: item.evidenceCount,
        daysSince: round(item.daysSince, 1),
        retrievability: round(item.retrievability, 3),
        intervalDays: round(item.intervalDays, 1),
        dueAt: item.dueAt,
        overdueDays: round(item.overdueDays, 1),
        target: targets.get(item.conceptId) ?? null,
      };
    };

    const dueEntries = shownDue.map(entry);
    const reachable = shownDue.filter((item) => targets.has(item.conceptId));

    return {
      reminders: owner?.reviewReminders ?? true,
      policyVersion: REVIEW_MODEL_VERSION,
      generatedAt: now,
      dueTotal: due.length,
      due: dueEntries,
      upcoming: upcoming.map(entry),
      session: planReviewSession(reachable),
    };
  }

  private async targets(userId: string, conceptIds: string[]): Promise<Map<string, ReviewTarget>> {
    const wanted = [...new Set(conceptIds)];
    if (wanted.length === 0) return new Map();

    const links = await this.prisma.conceptCurriculumLink.findMany({
      where: { conceptId: { in: wanted }, status: 'APPROVED' },
      select: { conceptId: true, lessonId: true, subTopic: { select: { lessons: { select: { id: true } } } } },
    });

    const lessonsByConcept = new Map<string, Set<string>>();
    for (const link of links) {
      const lessons = lessonsByConcept.get(link.conceptId) ?? new Set<string>();
      if (link.lessonId) lessons.add(link.lessonId);
      for (const lesson of link.subTopic?.lessons ?? []) lessons.add(lesson.id);
      lessonsByConcept.set(link.conceptId, lessons);
    }

    const lessonIds = [...new Set([...lessonsByConcept.values()].flatMap((lessons) => [...lessons]))];
    if (lessonIds.length === 0) return new Map();

    const userSteps = await this.prisma.userStep.findMany({
      where: { userId, stepTemplate: { lessonId: { in: lessonIds } } },
      select: { id: true, stepTemplateId: true, stepTemplate: { select: { lessonId: true } } },
      orderBy: { updatedAt: 'desc' },
    });

    const targets = new Map<string, ReviewTarget>();
    for (const conceptId of wanted) {
      const lessons = lessonsByConcept.get(conceptId);
      if (!lessons) continue;
      const found = userSteps.find((step) => step.stepTemplate !== null && lessons.has(step.stepTemplate.lessonId));
      if (found) targets.set(conceptId, { userStepId: found.id, stepTemplateId: found.stepTemplateId });
    }
    return targets;
  }
}
