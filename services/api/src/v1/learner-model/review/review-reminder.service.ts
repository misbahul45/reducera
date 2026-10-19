import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/common/config/prisma/prisma.service';
import { ReviewService } from './review.service';
import { REMINDER_BATCH, ReminderSweep, activeSince, emptySweep, pausedSince, reminderCopy, reminderKey } from './review-reminder';

const isDuplicate = (error: unknown): boolean => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

@Injectable()
export class ReviewReminderService {
  private readonly logger = new Logger(ReviewReminderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly review: ReviewService,
  ) {}

  async run(now: Date = new Date(), only?: string[]): Promise<ReminderSweep> {
    const sweep = emptySweep();
    let cursor: string | undefined;
    for (;;) {
      const users = await this.prisma.user.findMany({
        where: {
          ...(only ? { id: { in: only } } : {}),
          isActive: true,
          reviewReminders: true,
          conceptMasteries: { some: { evidenceCount: { gt: 0 }, lastEventAt: { gte: activeSince(now) } } },
        },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: REMINDER_BATCH,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });
      if (users.length === 0) break;
      for (const { id } of users) await this.remind(id, now, sweep);
      cursor = users[users.length - 1]!.id;
    }
    return sweep;
  }

  private async remind(userId: string, now: Date, sweep: ReminderSweep): Promise<void> {
    sweep.considered += 1;
    try {
      const waiting = await this.prisma.notification.count({ where: { userId, type: 'REVIEW', readAt: null, createdAt: { gte: pausedSince(now) } } });
      if (waiting > 0) {
        sweep.paused += 1;
        return;
      }
      const copy = reminderCopy(await this.review.queue(userId, now));
      if (!copy) {
        sweep.nothingDue += 1;
        return;
      }
      await this.prisma.notification.create({ data: { userId, type: 'REVIEW', title: copy.title, body: copy.body, dedupeKey: reminderKey(userId, now) } });
      sweep.sent += 1;
    } catch (error) {
      if (isDuplicate(error)) {
        sweep.duplicate += 1;
        return;
      }
      sweep.failed += 1;
      this.logger.warn(`Review reminder for ${userId} failed: ${(error as Error).message}`);
    }
  }
}
