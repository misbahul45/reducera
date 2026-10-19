import { ResolvedBenchmarkCase } from '../benchmark-dataset';
import { CaseTask, FatalBenchmarkError, buildTasks, executeTasks } from '../benchmark-executor';
import { CaseResult } from '../benchmark-report';
import { BenchmarkTemplate } from '../benchmark.types';

const template = (label: string): BenchmarkTemplate => ({ label, hash: `hash-${label}`, promptId: null, body: `body ${label}` });
const templates = { baseline: template('base'), candidate: template('cand') };

const item = (id: string): ResolvedBenchmarkCase =>
  ({
    id,
    category: 'concept',
    risk: 'standard',
    stepTitle: 's',
    learnerName: '',
    message: 'm',
    currentMaterial: '',
    conversation: [],
    sources: [],
    expect: { behavior: 'ANSWER', requiredFacts: [], forbiddenFacts: [], citation: { mode: 'OPTIONAL', mustCite: [], mustNotCite: [] }, rubric: 'r' },
  }) as ResolvedBenchmarkCase;

const cases = ['TC-01', 'TC-02', 'TC-03'].map(item);

const resultOf = (task: CaseTask): CaseResult =>
  ({
    caseId: task.item.id,
    repeat: task.repeat,
    templateLabel: task.template.label,
    templateHash: task.template.hash,
    dimensions: { correctness: true, coverage: 1, citation: true, safety: true, pedagogy: null, behavior: null, grounding: null },
  }) as unknown as CaseResult;

const options = (over: Partial<Parameters<typeof executeTasks>[3]> = {}) => ({
  concurrency: 4,
  retries: 2,
  retryDelayMs: 0,
  isRetryable: () => false,
  sleep: async () => undefined,
  ...over,
});

describe('buildTasks', () => {
  it('runs the baseline and the candidate of a case back to back, repeat after repeat', () => {
    const tasks = buildTasks(templates, cases.slice(0, 2), 2);

    expect(tasks.map((task) => `${task.item.id}:${task.repeat}:${task.arm}`)).toEqual([
      'TC-01:0:baseline',
      'TC-01:0:candidate',
      'TC-01:1:baseline',
      'TC-01:1:candidate',
      'TC-02:0:baseline',
      'TC-02:0:candidate',
      'TC-02:1:baseline',
      'TC-02:1:candidate',
    ]);
  });

  it('plans cases x repeats x two arms and nothing else', () => {
    expect(buildTasks(templates, cases, 3)).toHaveLength(3 * 3 * 2);
  });
});

describe('executeTasks', () => {
  it('collects the results of each arm, sorted by case and repeat, with the label and hash of the template', async () => {
    const arms = await executeTasks(templates, buildTasks(templates, cases, 2), async (task) => resultOf(task), options());

    expect(arms.baseline.label).toBe('base');
    expect(arms.candidate.hash).toBe('hash-cand');
    expect(arms.baseline.results.map((entry) => `${entry.caseId}:${entry.repeat}`)).toEqual(['TC-01:0', 'TC-01:1', 'TC-02:0', 'TC-02:1', 'TC-03:0', 'TC-03:1']);
    expect(arms.baseline.results.every((entry) => entry.templateLabel === 'base')).toBe(true);
    expect(arms.candidate.results.every((entry) => entry.templateLabel === 'cand')).toBe(true);
  });

  it('never has more calls in flight than the limit', async () => {
    let active = 0;
    let peak = 0;
    const run = async (task: CaseTask) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return resultOf(task);
    };

    await executeTasks(templates, buildTasks(templates, cases, 3), run, options({ concurrency: 3 }));

    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });

  it('retries a failure that can be retried and keeps the result of the retry', async () => {
    const calls = new Map<string, number>();
    const run = async (task: CaseTask) => {
      const key = `${task.arm}:${task.item.id}`;
      calls.set(key, (calls.get(key) ?? 0) + 1);
      if (task.item.id === 'TC-02' && calls.get(key) === 1) throw new Error('timeout');
      return resultOf(task);
    };
    const sleep = jest.fn(async () => undefined);

    const arms = await executeTasks(templates, buildTasks(templates, cases, 1), run, options({ isRetryable: () => true, sleep, retryDelayMs: 10 }));

    expect(arms.baseline.failures).toEqual([]);
    expect(arms.baseline.results).toHaveLength(3);
    expect(calls.get('baseline:TC-02')).toBe(2);
    expect(sleep).toHaveBeenCalledWith(10);
  });

  it('records a call that keeps failing as a failure instead of inventing a result', async () => {
    const run = async (task: CaseTask) => {
      if (task.item.id === 'TC-02' && task.arm === 'candidate') throw new Error('model down');
      return resultOf(task);
    };

    const arms = await executeTasks(templates, buildTasks(templates, cases, 1), run, options({ isRetryable: () => true, retries: 2 }));

    expect(arms.candidate.failures).toEqual([{ caseId: 'TC-02', repeat: 0, message: 'model down' }]);
    expect(arms.candidate.results.map((entry) => entry.caseId)).toEqual(['TC-01', 'TC-03']);
    expect(arms.baseline.results).toHaveLength(3);
  });

  it('does not retry a failure that is not retryable', async () => {
    const run = jest.fn(async (task: CaseTask) => {
      if (task.item.id === 'TC-01') throw new Error('bad request');
      return resultOf(task);
    });

    const arms = await executeTasks(templates, buildTasks(templates, cases.slice(0, 1), 1), run, options());

    expect(run).toHaveBeenCalledTimes(2);
    expect(arms.baseline.failures).toHaveLength(1);
  });

  it('stops everything on a fatal error and throws it, without starting the rest', async () => {
    const run = jest.fn(async (task: CaseTask) => {
      if (task.item.id === 'TC-01' && task.arm === 'baseline') throw new FatalBenchmarkError('identity refused');
      await new Promise((resolve) => setTimeout(resolve, 5));
      return resultOf(task);
    });

    await expect(executeTasks(templates, buildTasks(templates, cases, 3), run, options({ concurrency: 1 }))).rejects.toThrow('identity refused');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('reports progress after every finished call, failures included', async () => {
    const seen: Array<[number, number]> = [];
    const run = async (task: CaseTask) => {
      if (task.item.id === 'TC-02') throw new Error('x');
      return resultOf(task);
    };

    await executeTasks(templates, buildTasks(templates, cases, 1), run, options({ concurrency: 1, onProgress: (done, total) => void seen.push([done, total]) }));

    expect(seen).toEqual([1, 2, 3, 4, 5, 6].map((done) => [done, 6]));
  });
});
