import 'dotenv/config';
import { join } from 'path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { BenchmarkSeeder } from '../src/v1/optimization/benchmark/benchmark-seeder';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL must be set');
}

const FILES = ['tutor-chat-benchmark.v1.json', 'tutor-chat-dev.v1.json'];

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main() {
  for (const name of FILES) {
    const report = await new BenchmarkSeeder(prisma, join(process.cwd(), 'prisma', 'seed-data', 'evaluation', name)).run();
    console.log(`${report.created ? 'Froze' : 'Verified'} ${report.name} v${report.version}: ${report.cases} cases, sha256 ${report.digest}`);
  }
}

main()
  .catch((error) => {
    console.error('seed-evaluation failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
