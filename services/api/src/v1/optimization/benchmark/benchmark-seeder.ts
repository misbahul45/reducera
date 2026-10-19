import { readFileSync } from 'fs';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';
import { benchmarkDatasetSchema, datasetDigest, describeDataset, digestOfDescription, unknownSourceKeys } from './benchmark-dataset';

export const DEFAULT_BENCHMARK_FILE = join(process.cwd(), 'prisma', 'seed-data', 'evaluation', 'tutor-chat-benchmark.v1.json');

export interface BenchmarkSeedReport {
  name: string;
  version: number;
  cases: number;
  digest: string;
  created: boolean;
}

export class BenchmarkSeeder {
  constructor(
    private readonly prisma: Pick<PrismaClient, 'evaluationDataset'>,
    private readonly file: string = DEFAULT_BENCHMARK_FILE,
  ) {}

  async run(): Promise<BenchmarkSeedReport> {
    const raw: unknown = JSON.parse(readFileSync(this.file, 'utf8'));
    const dataset = benchmarkDatasetSchema.parse(raw);
    const unknown = unknownSourceKeys(dataset);
    if (unknown.length > 0) throw new Error(`The dataset names unknown sources: ${unknown.join(', ')}`);
    const digest = datasetDigest(raw);
    const report = { name: dataset.datasetName, version: dataset.version, cases: dataset.cases.length, digest };

    const existing = await this.prisma.evaluationDataset.findUnique({ where: { name: dataset.datasetName } });
    if (existing) {
      const stored = datasetDigest(existing.examplesJson);
      if (!existing.isFrozen || stored !== digest || digestOfDescription(existing.description) !== digest) {
        throw new Error(
          `The frozen dataset ${dataset.datasetName} differs from ${this.file}. A frozen dataset never changes: give the new content a new datasetName and version.`,
        );
      }
      return { ...report, created: false };
    }

    await this.prisma.evaluationDataset.create({
      data: {
        name: dataset.datasetName,
        version: dataset.version,
        isFrozen: true,
        examplesJson: raw as object,
        description: describeDataset(digest, dataset),
      },
    });
    return { ...report, created: true };
  }
}
