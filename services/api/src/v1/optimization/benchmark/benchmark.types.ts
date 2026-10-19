import { OfflineEvidence } from '../acceptance-gate';
import { DatasetRole } from './benchmark-dataset';
import { ArmSummary, Comparison } from './benchmark-report';

export const BENCHMARK_OPTIMIZER = 'offline-benchmark-v1';
export const PROMPT_BENCHMARK_QUEUE = 'prompt-benchmark';
export const BENCHMARK_CASE_PATH = '/benchmark/run-case';

export type BenchmarkStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED';
export type ArmName = 'baseline' | 'candidate';

export interface BenchmarkTemplate {
  label: string;
  hash: string;
  promptId: string | null;
  body: string;
}

export interface BenchmarkReport {
  baseline: ArmSummary;
  candidate: ArmSummary;
  comparison: Comparison;
  evidence: OfflineEvidence;
}

export interface BenchmarkPlan {
  status: BenchmarkStatus;
  name: string;
  actorId: string;
  datasetName: string;
  datasetRole: DatasetRole;
  datasetVersion: number;
  datasetDigest: string;
  repeats: number;
  judge: boolean;
  identicalArms: boolean;
  baseline: BenchmarkTemplate;
  candidate: BenchmarkTemplate;
  progress: { done: number; total: number };
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  report: BenchmarkReport | null;
}

export interface BenchmarkQueueJob {
  runId: string;
}
