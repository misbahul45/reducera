import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PROMPT_EVALUATION_QUEUE } from './prompt-evaluation.processor';

export const PROMPT_EVALUATION_CRON = '0 * * * *';

@Injectable()
export class PromptEvaluationScheduler implements OnModuleInit {
  private readonly logger = new Logger(PromptEvaluationScheduler.name);

  constructor(@InjectQueue(PROMPT_EVALUATION_QUEUE) private readonly queue: Queue) {}

  async onModuleInit() {
    try {
      await this.queue.add(
        'evaluate-canaries',
        { trigger: 'cron' },
        {
          repeat: { pattern: PROMPT_EVALUATION_CRON, tz: 'Asia/Jakarta' },
          removeOnComplete: true,
          removeOnFail: { age: 7 * 24 * 60 * 60, count: 100 },
        },
      );
      this.logger.log(`Canary evaluation scheduled (${PROMPT_EVALUATION_CRON} Asia/Jakarta)`);
    } catch (err) {
      this.logger.warn(`Failed to schedule canary evaluation: ${(err as Error).message}`);
    }
  }
}
