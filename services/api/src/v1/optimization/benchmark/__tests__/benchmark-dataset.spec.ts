import { readFileSync } from 'fs';
import { join } from 'path';
import {
  BENCHMARK_DATASET,
  DEVELOPMENT_DATASET,
  MIN_BENCHMARK_CASES,
  MIN_DEVELOPMENT_CASES,
  benchmarkDatasetSchema,
  canonicalJson,
  datasetDigest,
  datasetRole,
  describeDataset,
  digestOfDescription,
  resolveCases,
  unknownSourceKeys,
} from '../benchmark-dataset';

const FILE = join(process.cwd(), 'prisma', 'seed-data', 'evaluation', 'tutor-chat-benchmark.v1.json');
const raw: unknown = JSON.parse(readFileSync(FILE, 'utf8'));

describe('the frozen tutor benchmark file', () => {
  it('has the shape the gate expects and is large enough', () => {
    const dataset = benchmarkDatasetSchema.parse(raw);

    expect(dataset.datasetName).toBe('tutor-chat-benchmark-v1');
    expect(dataset.version).toBe(1);
    expect(dataset.cases.length).toBeGreaterThanOrEqual(MIN_BENCHMARK_CASES);
    expect(new Set(dataset.cases.map((item) => item.id)).size).toBe(dataset.cases.length);
  });

  it('only names sources that exist in its library', () => {
    expect(unknownSourceKeys(benchmarkDatasetSchema.parse(raw))).toEqual([]);
  });

  it('resolves every source into a full record and never leaves a key behind', () => {
    const resolved = resolveCases(benchmarkDatasetSchema.parse(raw));

    expect(resolved).toHaveLength(benchmarkDatasetSchema.parse(raw).cases.length);
    for (const item of resolved) {
      for (const source of item.sources) expect(source).toEqual(expect.objectContaining({ kind: expect.stringMatching(/TOPIC|MATERIAL/), title: expect.any(String), text: expect.any(String) }));
      expect(Array.isArray(item.conversation)).toBe(true);
    }
  });

  it('covers every kind of situation the evaluation promises, with enough high risk cases', () => {
    const cases = benchmarkDatasetSchema.parse(raw).cases;
    const categories = new Set(cases.map((item) => item.category));

    for (const expected of ['concept', 'worked_example', 'misconception', 'hint_only', 'safety', 'no_evidence', 'citation_precision', 'ambiguous', 'off_topic', 'wellbeing', 'answer_after_attempt']) {
      expect(categories).toContain(expected);
    }
    expect(cases.filter((item) => item.risk === 'high').length).toBeGreaterThanOrEqual(10);
  });

  it('keeps every pattern a plain regular expression both services can read', () => {
    for (const item of benchmarkDatasetSchema.parse(raw).cases) {
      for (const group of [...item.expect.requiredFacts, ...item.expect.forbiddenFacts]) {
        for (const pattern of group.anyOf) {
          expect(() => new RegExp(pattern, 'is')).not.toThrow();
          expect(pattern).not.toMatch(/\(\?P<|\(\?<|\(\?i\)|\\A|\\Z/);
        }
      }
    }
  });

  it('is refused when it is too small, has an unknown field, or a pattern that is not a regular expression', () => {
    const base = raw as { cases: Array<Record<string, unknown>> };
    const small = { ...base, cases: base.cases.slice(0, 10) };
    const extra = { ...base, surprise: true };
    const broken = {
      ...base,
      cases: base.cases.map((item, index) => (index === 0 ? { ...item, expect: { ...(item.expect as object), requiredFacts: [{ id: 'x', anyOf: ['('] }] } } : item)),
    };

    expect(benchmarkDatasetSchema.safeParse(small).success).toBe(false);
    expect(benchmarkDatasetSchema.safeParse(extra).success).toBe(false);
    expect(benchmarkDatasetSchema.safeParse(broken).success).toBe(false);
  });
});

describe('the digest that proves a dataset did not change', () => {
  it('does not depend on the order of keys or on formatting', () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }] })).toBe(canonicalJson({ a: [{ c: 3, d: 2 }], b: 1 }));
    expect(datasetDigest({ a: 1, b: 2 })).toBe(datasetDigest(JSON.parse('{ "b": 2,\n "a": 1 }')));
  });

  it('changes when a single character of a case changes', () => {
    const original = datasetDigest(raw);
    const changed = JSON.parse(JSON.stringify(raw).replace('Apa sih bedanya', 'Apa bedanya'));

    expect(datasetDigest(changed)).not.toBe(original);
  });

  it('is a sha256 hex string and round trips through the stored description', () => {
    const digest = datasetDigest(raw);
    const dataset = benchmarkDatasetSchema.parse(raw);

    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digestOfDescription(describeDataset(digest, dataset))).toBe(digest);
    expect(digestOfDescription(null)).toBeNull();
    expect(digestOfDescription('no digest here')).toBeNull();
  });
});

describe('the development set', () => {
  const developmentRaw: unknown = JSON.parse(readFileSync(join(process.cwd(), 'prisma', 'seed-data', 'evaluation', 'tutor-chat-dev.v1.json'), 'utf8'));
  const benchmark = benchmarkDatasetSchema.parse(raw);
  const development = benchmarkDatasetSchema.parse(developmentRaw);
  const words = (text: string) => new Set(text.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((word) => word.length > 2));
  const similarity = (left: string, right: string) => {
    const a = words(left);
    const b = words(right);
    const shared = [...a].filter((word) => b.has(word)).length;
    return shared / Math.max(1, new Set([...a, ...b]).size);
  };

  it('is a separate dataset with its own role, name and case ids', () => {
    expect(datasetRole(development)).toBe('DEVELOPMENT');
    expect(datasetRole(benchmark)).toBe('BENCHMARK');
    expect(development.datasetName).toBe(DEVELOPMENT_DATASET);
    expect(benchmark.datasetName).toBe(BENCHMARK_DATASET);
    expect(development.cases.length).toBeGreaterThanOrEqual(MIN_DEVELOPMENT_CASES);
    expect(development.cases.every((item) => item.id.startsWith('TD-'))).toBe(true);
    expect(benchmark.cases.every((item) => item.id.startsWith('TC-'))).toBe(true);
  });

  const figuresOf = (text: string) => [...new Set((text.match(/\d[\d.]*/g) ?? []).map((value) => value.replace(/\./g, '')))].sort();

  it('shares no learner message with the benchmark, and no item that only changes the wording', () => {
    for (const dev of development.cases) {
      for (const test of benchmark.cases) {
        expect(dev.message.toLowerCase()).not.toBe(test.message.toLowerCase());
        if (similarity(dev.message, test.message) >= 0.7) {
          expect(figuresOf(dev.message)).not.toEqual(figuresOf(test.message));
        }
      }
    }
  });

  it('never repeats the numbers of a benchmark exercise, so a remembered answer cannot pass', () => {
    for (const dev of development.cases.filter((item) => item.category === 'worked_example' || item.category === 'hint_only')) {
      const own = figuresOf(`${dev.message} ${dev.currentMaterial}`);
      for (const test of benchmark.cases.filter((item) => item.category === dev.category)) {
        const theirs = figuresOf(`${test.message} ${test.currentMaterial}`);
        const shared = own.filter((value) => theirs.includes(value) && value.length >= 3);
        expect(shared.length).toBeLessThan(Math.max(1, Math.min(own.length, theirs.length)));
      }
    }
  });

  it('never lets the learner message alone satisfy the required facts of a case', () => {
    const echoes = development.cases
      .filter((item) => item.expect.requiredFacts.length > 0)
      .filter((item) => item.expect.requiredFacts.every((group) => group.anyOf.some((pattern) => new RegExp(pattern, 'is').test(item.message))))
      .map((item) => item.id);

    expect(echoes).toEqual([]);
  });

  it('covers the same kinds of situation as the benchmark', () => {
    const categories = new Set(development.cases.map((item) => item.category));

    for (const expected of ['concept', 'worked_example', 'misconception', 'hint_only', 'safety', 'no_evidence', 'citation_precision', 'ambiguous', 'wellbeing']) {
      expect(categories).toContain(expected);
    }
  });

  it('is refused when its ids do not match its role', () => {
    const wrongRole = { ...(developmentRaw as object), role: 'BENCHMARK' };

    expect(benchmarkDatasetSchema.safeParse(wrongRole).success).toBe(false);
  });

  it('digests differently from the benchmark', () => {
    expect(datasetDigest(developmentRaw)).not.toBe(datasetDigest(raw));
  });
});
