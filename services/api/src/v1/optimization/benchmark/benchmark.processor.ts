import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { BenchmarkService } from './benchmark.service';
import { BenchmarkQueueJob, PROMPT_BENCHMARK_QUEUE } from './benchmark.types';

@Processor(PROMPT_BENCHMARK_QUEUE, { concurrency: 1 })
export class PromptBenchmarkProcessor extends WorkerHost {
  constructor(private readonly benchmarks: BenchmarkService) {
    super();
  }

  async process(job: Job<BenchmarkQueueJob>): Promise<void> {
    await this.benchmarks.execute(job.data.runId, `prompt-benchmark:${job.id ?? 'manual'}`);
  }
}
