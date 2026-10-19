import { describe, expect, it } from 'vitest';
import { buildPathNodes, pathOffset, pathSummary } from '~/lib/learning-path';

const sub = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  title: `Bagian ${id}`,
  description: null,
  isUnlocked: true,
  progress: null,
  _count: { lessons: 3 },
  ...overrides,
});

describe('buildPathNodes', () => {
  it('marks an unlocked, unfinished part as available and links it to its lessons', () => {
    const [node] = buildPathNodes([sub('a')]);

    expect(node).toMatchObject({ id: 'a', title: 'Bagian a', state: 'current', to: '/my-learning/sub-topics/a', lessons: 3 });
  });

  it('marks a locked part as locked and gives it no link', () => {
    const nodes = buildPathNodes([sub('a', { progress: { status: 'COMPLETED' } }), sub('b', { isUnlocked: false })]);

    expect(nodes[1]).toMatchObject({ state: 'locked', to: null });
  });

  it('marks a finished part as done and keeps it reachable for review', () => {
    const [node] = buildPathNodes([sub('a', { progress: { status: 'COMPLETED' } })]);

    expect(node).toMatchObject({ state: 'done', to: '/my-learning/sub-topics/a' });
  });

  it('points at exactly one current part: the first unlocked one that is not finished', () => {
    const nodes = buildPathNodes([
      sub('a', { progress: { status: 'COMPLETED' } }),
      sub('b'),
      sub('c'),
    ]);

    expect(nodes.map((n) => n.state)).toEqual(['done', 'current', 'available']);
  });

  it('has no current part once everything is finished, and none while everything is locked', () => {
    expect(buildPathNodes([sub('a', { progress: { status: 'COMPLETED' } })]).some((n) => n.state === 'current')).toBe(false);
    expect(buildPathNodes([sub('a', { isUnlocked: false })]).some((n) => n.state === 'current')).toBe(false);
  });

  it('orders parts by sortOrder when the server provides one, keeping input order otherwise', () => {
    const ordered = buildPathNodes([sub('b', { sortOrder: 2 }), sub('a', { sortOrder: 1 })]);
    expect(ordered.map((n) => n.id)).toEqual(['a', 'b']);

    const plain = buildPathNodes([sub('x'), sub('y')]);
    expect(plain.map((n) => n.id)).toEqual(['x', 'y']);
  });

  it('turns a description into plain text and drops markup', () => {
    const [node] = buildPathNodes([sub('a', { description: '<p>Dasar <b>jurnal</b></p><script>alert(1)</script>' })]);

    expect(node?.summary).toBe('Dasar jurnal');
  });

  it('copes with a missing list, a missing lesson count and a missing title', () => {
    expect(buildPathNodes(undefined)).toEqual([]);
    expect(buildPathNodes(null)).toEqual([]);
    const [node] = buildPathNodes([{ id: 'z', isUnlocked: true } as never]);
    expect(node).toMatchObject({ title: 'Tanpa judul', lessons: 0 });
  });
});

describe('pathOffset', () => {
  it('walks a gentle wave and repeats', () => {
    const wave = Array.from({ length: 8 }, (_, index) => pathOffset(index));

    expect(wave).toEqual([0, 1, 2, 1, 0, -1, -2, -1]);
    expect(pathOffset(8)).toBe(pathOffset(0));
    expect(pathOffset(11)).toBe(pathOffset(3));
  });

  it('is zero for a negative or invalid index', () => {
    expect(pathOffset(-1)).toBe(0);
    expect(pathOffset(Number.NaN)).toBe(0);
  });
});

describe('pathSummary', () => {
  it('counts finished parts and a rounded percentage', () => {
    const nodes = buildPathNodes([sub('a', { progress: { status: 'COMPLETED' } }), sub('b'), sub('c', { isUnlocked: false }), sub('d', { progress: { status: 'COMPLETED' } })]);

    expect(pathSummary(nodes)).toEqual({ total: 4, done: 2, percent: 50 });
  });

  it('is zero for an empty path instead of dividing by zero', () => {
    expect(pathSummary([])).toEqual({ total: 0, done: 0, percent: 0 });
  });
});

import { buildStepPath, stepHref, type PathStepGroup } from '~/lib/learning-path';

const stepItem = (id: string, order: number, isDone: boolean, isUnlocked: boolean, title = `Langkah ${id}`) => ({ id, order, isDone, isUnlocked, title });

const group = (id: string, sortOrder: number, steps: ReturnType<typeof stepItem>[], title = `Bagian ${id}`): PathStepGroup => ({ id, sortOrder, title, steps });

describe('buildStepPath', () => {
  const sample = [
    group('g1', 1, [stepItem('a', 1, true, true), stepItem('b', 2, true, true), stepItem('c', 3, false, true)]),
    group('g2', 2, [stepItem('d', 4, false, false), stepItem('e', 5, false, false)]),
  ];

  it('walks the sections in order and marks done, current and locked steps', () => {
    const nodes = buildStepPath(sample);

    expect(nodes.map((node) => [node.id, node.state])).toEqual([
      ['a', 'done'],
      ['b', 'done'],
      ['c', 'current'],
      ['d', 'locked'],
      ['e', 'locked'],
    ]);
  });

  it('points at exactly one current step and calls later open steps available', () => {
    const nodes = buildStepPath([group('g1', 1, [stepItem('a', 1, false, true), stepItem('b', 2, false, true), stepItem('c', 3, false, true)])]);

    expect(nodes.map((node) => node.state)).toEqual(['current', 'available', 'available']);
  });

  it('keeps a step reachable once it is done, even if it is no longer unlocked', () => {
    const [node] = buildStepPath([group('g1', 1, [stepItem('a', 1, true, false)])]);

    expect(node).toMatchObject({ state: 'done', to: '/my-learning/steps/g1/a' });
  });

  it('gives a locked step no link and an open step the link of the step page with the lesson', () => {
    const nodes = buildStepPath(sample, { lessonId: 'lesson-1' });

    expect(nodes[2].to).toBe('/my-learning/steps/g1/c?lessonId=lesson-1');
    expect(nodes[3].to).toBeNull();
  });

  it('labels every step with its section and the progress of that section', () => {
    const nodes = buildStepPath(sample);

    expect(nodes[0]).toMatchObject({ unit: 'Bagian g1', unitDone: 2, unitTotal: 3 });
    expect(nodes[4]).toMatchObject({ unit: 'Bagian g2', unitDone: 0, unitTotal: 2 });
  });

  it('marks the step that is open on the page', () => {
    const nodes = buildStepPath(sample, { activeId: 'c' });

    expect(nodes.filter((node) => node.active).map((node) => node.id)).toEqual(['c']);
  });

  it('orders sections by sortOrder and steps by their order, keeping input order for ties', () => {
    const nodes = buildStepPath([
      group('later', 2, [stepItem('y', 2, false, true), stepItem('x', 1, false, true)]),
      group('first', 1, [stepItem('z', 1, false, true)]),
    ]);

    expect(nodes.map((node) => node.id)).toEqual(['z', 'x', 'y']);
    const ties = buildStepPath([group('g', 1, [stepItem('p', 1, false, true), stepItem('q', 1, false, true)])]);
    expect(ties.map((node) => node.id)).toEqual(['p', 'q']);
  });

  it('skips a section that has no steps yet', () => {
    expect(buildStepPath([group('empty', 1, []), group('g', 2, [stepItem('a', 1, false, true)])]).map((node) => node.id)).toEqual(['a']);
  });

  it('has no current step when everything is done or everything is locked', () => {
    expect(buildStepPath([group('g', 1, [stepItem('a', 1, true, true)])]).some((node) => node.state === 'current')).toBe(false);
    expect(buildStepPath([group('g', 1, [stepItem('a', 1, false, false)])]).some((node) => node.state === 'current')).toBe(false);
  });

  it('treats a missing flag as not done and locked, so nothing opens by accident', () => {
    const [node] = buildStepPath([{ id: 'g', steps: [{ id: 's', title: 'Tanpa tanda' }] }]);

    expect(node).toMatchObject({ state: 'locked', to: null });
  });

  it('names an untitled section or step and copes with no input', () => {
    const [node] = buildStepPath([{ id: 'g', title: '  ', steps: [{ id: 's', title: null, isUnlocked: true }] }]);

    expect(node).toMatchObject({ unit: 'Tanpa judul', title: 'Tanpa judul' });
    expect(buildStepPath(null)).toEqual([]);
    expect(buildStepPath(undefined)).toEqual([]);
  });

  it('builds the link of a step page', () => {
    expect(stepHref('g', 's')).toBe('/my-learning/steps/g/s');
    expect(stepHref('g', 's', 'l 1')).toBe('/my-learning/steps/g/s?lessonId=l%201');
  });
});
