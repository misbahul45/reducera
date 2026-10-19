import * as fs from 'fs';
import * as path from 'path';
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import {
  LinkFile,
  parseAliases,
  parseGoldenGraph,
  parseLinks,
} from '../src/v1/learner-model/concepts/concept-seed';
import { ConceptSeeder, ConceptSeedError } from '../src/v1/learner-model/concepts/concept-seeder';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL must be set');
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const seedDir = path.resolve(__dirname, 'seed-data');
const read = (name: string) => JSON.parse(fs.readFileSync(path.join(seedDir, name), 'utf8'));
const EXTRA_PACKS = ['utbk-snbt.concepts.json'];

async function main() {
  const accounting = parseGoldenGraph(read('golden-accounting-graph.json'));
  const packs = EXTRA_PACKS.map((name) => read(name) as { graph: unknown; links: unknown });
  const extraGraphs = packs.map((pack) => parseGoldenGraph(pack.graph));
  const extraLinks: LinkFile[] = [];
  for (const pack of packs) {
    const file = parseLinks(pack.links);
    if (await prisma.topic.findUnique({ where: { slug: file.topicSlug }, select: { id: true } })) extraLinks.push(file);
    else console.log(`topic ${file.topicSlug} is not seeded yet, its concepts are registered without curriculum links`);
  }
  const report = await new ConceptSeeder(prisma).run({
    graph: { levels: [...accounting.levels, ...extraGraphs.flatMap((graph) => graph.levels)] },
    aliases: parseAliases(read('concept-aliases.json')),
    links: parseLinks(read('concept-curriculum-links.json')),
    extraLinks,
  });
  console.log(`Seeded ${report.concepts} concepts, ${report.prerequisites} prerequisites, ${report.aliases} alias rows, ${report.subTopicLinks} sub-topic links, ${report.lessonLinks} lesson links.`);
}

main()
  .catch((error) => {
    if (error instanceof ConceptSeedError) {
      console.error('seed-concepts refused the seed:\n' + error.issues.map((issue) => `  - ${issue}`).join('\n'));
    } else {
      console.error('seed-concepts failed:', error);
    }
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
