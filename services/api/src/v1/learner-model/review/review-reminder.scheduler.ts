import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { REVIEW_REMINDER_CRON, REVIEW_REMINDER_QUEUE } from './review-reminder';

@Injectable()
export class ReviewReminderScheduler implements OnModuleInit {
  private readonly logger = new Logger(ReviewReminderScheduler.name);

  constructor(@InjectQueue(REVIEW_REMINDER_QUEUE) private readonly queue: Queue) {}

  async onModuleInit() {
    try {
      await this.queue.add(
        'send-review-reminders',
        { trigger: 'cron' },
        {
          repeat: { pattern: REVIEW_REMINDER_CRON, tz: 'Asia/Jakarta' },
          removeOnComplete: true,
          removeOnFail: { age: 7 * 24 * 60 * 60, count: 100 },
        },
      );
      this.logger.log(`Review reminders scheduled (${REVIEW_REMINDER_CRON} Asia/Jakarta)`);
    } catch (err) {
      this.logger.warn(`Failed to schedule review reminders: ${(err as Error).message}`);
    }
  }
}
