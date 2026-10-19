import { createHash } from 'crypto';
import { z } from 'zod';

export const BENCHMARK_BEHAVIORS = ['ANSWER', 'HINT_ONLY', 'NOT_COVERED', 'REFUSE_REDIRECT', 'REDIRECT', 'CLARIFY', 'SUPPORT'] as const;
export const MIN_BENCHMARK_CASES = 50;
export const MIN_DEVELOPMENT_CASES = 20;
export const BENCHMARK_DATASET = 'tutor-chat-benchmark-v1';
export const DEVELOPMENT_DATASET = 'tutor-chat-dev-v1';
export type DatasetRole = 'BENCHMARK' | 'DEVELOPMENT';
const CASE_PREFIX: Record<DatasetRole, string> = { BENCHMARK: 'TC-', DEVELOPMENT: 'TD-' };

const compilesAsRegExp = (pattern: string): boolean => {
  try {
    new RegExp(pattern, 'is');
    return true;
  } catch {
    return false;
  }
};

const factGroupSchema = z
  .object({
    id: z.string().min(1).max(60),
    anyOf: z.array(z.string().min(1).refine(compilesAsRegExp, 'The pattern is not a valid regular expression')).min(1).max(12),
  })
  .strict();

const citationSchema = z
  .object({
    mode: z.enum(['REQUIRED', 'OPTIONAL', 'NONE']),
    mustCite: z.array(z.number().int().positive()).max(6),
    mustNotCite: z.array(z.number().int().positive()).max(6),
  })
  .strict();

const expectationSchema = z
  .object({
    behavior: z.enum(BENCHMARK_BEHAVIORS),
    requiredFacts: z.array(factGroupSchema).max(12),
    forbiddenFacts: z.array(factGroupSchema).max(12),
    citation: citationSchema,
    rubric: z.string().min(1).max(1000),
  })
  .strict();

const sourceSchema = z
  .object({
    kind: z.enum(['TOPIC', 'MATERIAL']),
    title: z.string().min(1).max(200),
    text: z.string().min(1).max(4000),
  })
  .strict();

const turnSchema = z.object({ role: z.enum(['learner', 'core']), text: z.string().min(1).max(1000) }).strict();

const caseSchema = z
  .object({
    id: z.string().regex(/^T[CD]-\d{2}$/),
    category: z.string().min(1).max(40),
    risk: z.enum(['standard', 'high']),
    stepTitle: z.string().min(1).max(200),
    learnerName: z.string().max(40),
    message: z.string().min(1).max(2000),
    currentMaterial: z.string().max(4000),
    conversation: z.array(turnSchema).max(12).optional(),
    sources: z.array(z.union([z.string().min(1), sourceSchema])).max(8),
    strategy: z.record(z.string(), z.unknown()).optional(),
    expect: expectationSchema,
  })
  .strict();

export const benchmarkDatasetSchema = z
  .object({
    schemaVersion: z.literal(1),
    datasetName: z.string().min(1).max(80),
    version: z.number().int().positive(),
    role: z.enum(['BENCHMARK', 'DEVELOPMENT']).optional(),
    scope: z.string().min(1).max(400),
    review: z.object({ status: z.string().min(1), note: z.string().min(1) }).strict(),
    protectedPhrases: z.array(z.string().min(1)).min(1).max(30),
    sourceLibrary: z.record(z.string(), sourceSchema),
    cases: z.array(caseSchema).min(1).max(200),
  })
  .strict()
  .superRefine((dataset, context) => {
    const role: DatasetRole = dataset.role ?? 'BENCHMARK';
    const minimum = role === 'DEVELOPMENT' ? MIN_DEVELOPMENT_CASES : MIN_BENCHMARK_CASES;
    if (dataset.cases.length < minimum) {
      context.addIssue({ code: 'custom', path: ['cases'], message: `A ${role.toLowerCase()} dataset needs at least ${minimum} cases` });
    }
    for (const item of dataset.cases) {
      if (!item.id.startsWith(CASE_PREFIX[role])) {
        context.addIssue({ code: 'custom', path: ['cases', item.id], message: `Case ids of a ${role.toLowerCase()} dataset start with ${CASE_PREFIX[role]}` });
      }
    }
    if (new Set(dataset.cases.map((item) => item.id)).size !== dataset.cases.length) {
      context.addIssue({ code: 'custom', path: ['cases'], message: 'Case ids must be unique' });
    }
  });

export type BenchmarkDataset = z.infer<typeof benchmarkDatasetSchema>;

export const datasetRole = (dataset: Pick<BenchmarkDataset, 'role'>): DatasetRole => dataset.role ?? 'BENCHMARK';
type RawCase = BenchmarkDataset['cases'][number];
type Source = z.infer<typeof sourceSchema>;

export interface ResolvedBenchmarkCase extends Omit<RawCase, 'sources' | 'conversation'> {
  sources: Source[];
  conversation: z.infer<typeof turnSchema>[];
}

export const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

export const datasetDigest = (raw: unknown): string => createHash('sha256').update(canonicalJson(raw)).digest('hex');

export const describeDataset = (digest: string, dataset: Pick<BenchmarkDataset, 'scope' | 'review'>): string =>
  `sha256:${digest}\nscope: ${dataset.scope}\nreview: ${dataset.review.status}`;

export const digestOfDescription = (description: string | null): string | null => /^sha256:([0-9a-f]{64})/.exec(description ?? '')?.[1] ?? null;

export const unknownSourceKeys = (dataset: BenchmarkDataset): string[] =>
  dataset.cases.flatMap((item) => item.sources.filter((source): source is string => typeof source === 'string' && !(source in dataset.sourceLibrary)).map((key) => `${item.id}:${key}`));

export const resolveCases = (dataset: BenchmarkDataset): ResolvedBenchmarkCase[] =>
  dataset.cases.map((item) => ({
    ...item,
    conversation: item.conversation ?? [],
    sources: item.sources.map((source) => (typeof source === 'string' ? dataset.sourceLibrary[source] : source)),
  }));
