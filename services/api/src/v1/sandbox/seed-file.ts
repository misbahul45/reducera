import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const seedPaths = (name: string) => [
  join(process.cwd(), 'prisma', 'seed-data', name),
  join(__dirname, '..', '..', '..', 'prisma', 'seed-data', name),
];

export const readSeedJson = (name: string): unknown => {
  const path = seedPaths(name).find((candidate) => existsSync(candidate));
  if (!path) throw new Error(`Sandbox content file ${name} was not found`);
  return JSON.parse(readFileSync(path, 'utf-8'));
};
