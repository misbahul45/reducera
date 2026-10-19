import { ResolvedBenchmarkCase } from './benchmark-dataset';
import { Arm, ArmFailure, CaseResult } from './benchmark-report';
import { ArmName, BenchmarkTemplate } from './benchmark.types';

export class FatalBenchmarkError extends Error {}

export interface CaseTask {
  arm: ArmName;
  template: BenchmarkTemplate;
  item: ResolvedBenchmarkCase;
  repeat: number;
}

export type CaseRunner = (task: CaseTask) => Promise<CaseResult>;

export interface ExecutorOptions {
  concurrency: number;
  retries: number;
  retryDelayMs: number;
  isRetryable: (error: unknown) => boolean;
  onProgress?: (done: number, total: number) => void | Promise<void>;
  sleep?: (ms: number) => Promise<void>;
}

const ARMS: readonly ArmName[] = ['baseline', 'candidate'];

export const buildTasks = (templates: Record<ArmName, BenchmarkTemplate>, cases: readonly ResolvedBenchmarkCase[], repeats: number): CaseTask[] =>
  cases.flatMap((item) =>
    Array.from({ length: repeats }, (_, repeat) => repeat).flatMap((repeat) => ARMS.map((arm): CaseTask => ({ arm, template: templates[arm], item, repeat }))),
  );

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error)).slice(0, 300);

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function executeTasks(templates: Record<ArmName, BenchmarkTemplate>, tasks: readonly CaseTask[], run: CaseRunner, options: ExecutorOptions): Promise<Record<ArmName, Arm>> {
  const arms: Record<ArmName, Arm> = {
    baseline: { label: templates.baseline.label, hash: templates.baseline.hash, results: [], failures: [] },
    candidate: { label: templates.candidate.label, hash: templates.candidate.hash, results: [], failures: [] },
  };
  const sleep = options.sleep ?? delay;
  let cursor = 0;
  let done = 0;
  let fatal: FatalBenchmarkError | null = null;

  const attempt = async (task: CaseTask): Promise<void> => {
    for (let tries = 0; ; tries += 1) {
      try {
        arms[task.arm].results.push(await run(task));
        return;
      } catch (error) {
        if (error instanceof FatalBenchmarkError) {
          fatal = error;
          return;
        }
        if (options.isRetryable(error) && tries < options.retries) {
          await sleep(options.retryDelayMs * (tries + 1));
          continue;
        }
        const failure: ArmFailure = { caseId: task.item.id, repeat: task.repeat, message: messageOf(error) };
        arms[task.arm].failures.push(failure);
        return;
      }
    }
  };

  const worker = async (): Promise<void> => {
    while (fatal === null) {
      const index = cursor;
      cursor += 1;
      if (index >= tasks.length) return;
      await attempt(tasks[index]);
      done += 1;
      await options.onProgress?.(done, tasks.length);
    }
  };

  await Promise.all(Array.from({ length: Math.max(1, options.concurrency) }, worker));
  if (fatal !== null) throw fatal;

  const order = (left: CaseResult, right: CaseResult) => (left.caseId === right.caseId ? left.repeat - right.repeat : left.caseId < right.caseId ? -1 : 1);
  for (const arm of Object.values(arms)) arm.results.sort(order);
  return arms;
}
