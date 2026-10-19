import { readFileSync } from 'fs';
import { join } from 'path';
import { buildSandboxContent } from '../../sandbox-content';

const SEED = join(__dirname, '..', '..', '..', '..', '..', 'prisma', 'seed-data');

export const readSeed = (name: string): unknown => JSON.parse(readFileSync(join(SEED, name), 'utf-8'));

export const content = buildSandboxContent(readSeed('sandbox-chart-of-accounts.json'), readSeed('sandbox-scenarios.json'));

export const scenario = (id: string) => {
  const found = content.scenarios.find((item) => item.id === id);
  if (!found) throw new Error(`missing scenario ${id}`);
  return found;
};
