import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const PAGES_DIR = join(__dirname, '..', '..', 'pages');

const vueFilesUnder = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return vueFilesUnder(full);
    return entry.name.endsWith('.vue') ? [full] : [];
  });

export const immediateWatchersThatMutate = (source: string): number =>
  source
    .split(/\bwatch\(/)
    .slice(1)
    .map((chunk) => chunk.split(/\n(?=(?:const|let|function|onMounted|onBeforeUnmount|watch|definePage|useHead)\b)/)[0])
    .filter((chunk) => /immediate:\s*true/.test(chunk) && /\bcall\(/.test(chunk)).length;

describe('pages do not mutate data from an immediate watcher', () => {
  it('finds an immediate watcher that calls a mutation, so the check is not vacuous', () => {
    const bad = "watch(lesson, async (value) => {\n  call({ id: value.id })\n}, { immediate: true })\nconst other = 1";
    const fine = "watch(lesson, (value) => {\n  title.value = value.title\n}, { immediate: true })\nconst other = 1";
    const lateOnly = "watch(lesson, async (value) => {\n  call({ id: value.id })\n})\nconst other = 1";

    expect(immediateWatchersThatMutate(bad)).toBe(1);
    expect(immediateWatchersThatMutate(fine)).toBe(0);
    expect(immediateWatchersThatMutate(lateOnly)).toBe(0);
  });

  it('has no page that writes from a watcher that also runs during server render: the server and the browser would both send the write', () => {
    const offenders = vueFilesUnder(PAGES_DIR)
      .filter((path) => immediateWatchersThatMutate(readFileSync(path, 'utf8')) > 0)
      .map((path) => relative(PAGES_DIR, path));

    expect(offenders).toEqual([]);
  });
});
