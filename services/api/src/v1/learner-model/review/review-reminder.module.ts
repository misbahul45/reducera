import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '@/common/config/prisma/prisma.module';
import { LearnerModelModule } from '../learner-model.module';
import { REVIEW_REMINDER_QUEUE } from './review-reminder';
import { ReviewReminderProcessor } from './review-reminder.processor';
import { ReviewReminderScheduler } from './review-reminder.scheduler';
import { ReviewReminderService } from './review-reminder.service';

@Module({
  imports: [PrismaModule, LearnerModelModule, BullModule.registerQueue({ name: REVIEW_REMINDER_QUEUE })],
  providers: [ReviewReminderService, ReviewReminderProcessor, ReviewReminderScheduler],
  exports: [ReviewReminderService],
})
export class ReviewReminderModule {}
