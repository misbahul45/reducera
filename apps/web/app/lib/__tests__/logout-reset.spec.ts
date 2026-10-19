import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const APP_ROOT = join(__dirname, '..', '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return entry === '__tests__' ? [] : sourceFiles(path);
    return /\.(vue|ts)$/.test(entry) ? [path] : [];
  });
}

const signOuts = sourceFiles(APP_ROOT).filter((file) => /authService\.logout\(/.test(readFileSync(file, 'utf8')) && !file.endsWith(join('services', 'auth.ts')));

describe('signing out', () => {
  it('is done from at least one place', () => {
    expect(signOuts.length).toBeGreaterThan(0);
  });

  it.each(signOuts.map((file) => [relative(APP_ROOT, file), file]))('%s clears the persisted learning ids of the previous account', (_name, file) => {
    const source = readFileSync(file as string, 'utf8');

    expect(source).toMatch(/useLearning\(\)/);
    expect(source).toMatch(/\.resetAll\(\)/);
  });
});
