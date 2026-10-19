import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { CanarySweep, PromptRegistryService } from './prompt-registry.service';

export const PROMPT_EVALUATION_QUEUE = 'prompt-evaluation';

@Processor(PROMPT_EVALUATION_QUEUE)
export class PromptEvaluationProcessor extends WorkerHost {
  private readonly logger = new Logger(PromptEvaluationProcessor.name);

  constructor(private readonly registry: PromptRegistryService) {
    super();
  }

  async process(job: Job): Promise<CanarySweep> {
    const sweep = await this.registry.evaluateRunningCanaries(`prompt-evaluation:${job.id ?? 'manual'}`);
    for (const failure of sweep.failed) {
      this.logger.warn(`Canary ${failure.label} could not be evaluated: ${failure.message}`);
    }
    if (sweep.rolledBack.length > 0) this.logger.warn(`Canaries rolled back: ${sweep.rolledBack.join(', ')}`);
    if (sweep.validated.length > 0) this.logger.log(`Canaries waiting for approval: ${sweep.validated.join(', ')}`);
    return sweep;
  }
}
