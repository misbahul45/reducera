import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { REVIEW_REMINDER_QUEUE, ReminderSweep } from './review-reminder';
import { ReviewReminderService } from './review-reminder.service';

@Processor(REVIEW_REMINDER_QUEUE)
export class ReviewReminderProcessor extends WorkerHost {
  private readonly logger = new Logger(ReviewReminderProcessor.name);

  constructor(private readonly reminders: ReviewReminderService) {
    super();
  }

  async process(): Promise<ReminderSweep> {
    const sweep = await this.reminders.run();
    this.logger.log(`Review reminders: ${JSON.stringify(sweep)}`);
    return sweep;
  }
}
