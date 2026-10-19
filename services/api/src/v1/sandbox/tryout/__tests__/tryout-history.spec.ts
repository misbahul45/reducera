import { HistoryEntry, bandOf, filterHistory } from '../tryout-history';

const entry = (id: string, percent: number, minutesAgo: number, keys: string[] = ['ppu']): HistoryEntry => ({
  id,
  startedAt: new Date(Date.UTC(2026, 9, 16, 10, 0) - minutesAgo * 60_000 - 600_000),
  submittedAt: new Date(Date.UTC(2026, 9, 16, 10, 0) - minutesAgo * 60_000),
  total: 10,
  correct: Math.round(percent / 10),
  percent,
  usedSeconds: 600,
  subtests: keys.map((key) => ({ key, title: key, total: 5, percent })),
});

describe('bandOf', () => {
  it.each([
    [100, 'SANGAT_BAIK'],
    [80, 'SANGAT_BAIK'],
    [79.9, 'BAIK'],
    [60, 'BAIK'],
    [59.9, 'CUKUP'],
    [40, 'CUKUP'],
    [39.9, 'LATIH'],
    [0, 'LATIH'],
  ])('puts %s in %s', (percent, band) => {
    expect(bandOf(percent)).toBe(band);
  });
});

describe('filterHistory', () => {
  const entries = [
    entry('a', 90, 10, ['ppu', 'pbm']),
    entry('b', 55, 30, ['penalaran-umum']),
    entry('c', 20, 20, ['ppu']),
    entry('d', 70, 40, ['pbm']),
    entry('e', 55, 5, ['penalaran-umum', 'ppu']),
  ];
  const ids = (list: HistoryEntry[]) => list.map((item) => item.id);

  it('sorts newest first by default order of the request', () => {
    expect(ids(filterHistory(entries, { sort: 'NEWEST' }))).toEqual(['e', 'a', 'c', 'b', 'd']);
    expect(ids(filterHistory(entries, { sort: 'OLDEST' }))).toEqual(['d', 'b', 'c', 'a', 'e']);
  });

  it('sorts by score and breaks a tie with the newer one first', () => {
    expect(ids(filterHistory(entries, { sort: 'HIGHEST' }))).toEqual(['a', 'd', 'e', 'b', 'c']);
    expect(ids(filterHistory(entries, { sort: 'LOWEST' }))).toEqual(['c', 'e', 'b', 'd', 'a']);
  });

  it('keeps only the chosen score band', () => {
    expect(ids(filterHistory(entries, { band: 'CUKUP', sort: 'NEWEST' }))).toEqual(['e', 'b']);
    expect(ids(filterHistory(entries, { band: 'LATIH', sort: 'NEWEST' }))).toEqual(['c']);
    expect(filterHistory(entries, { band: 'SANGAT_BAIK', sort: 'NEWEST' })).toHaveLength(1);
  });

  it('keeps only the sessions that included the chosen subtest', () => {
    expect(ids(filterHistory(entries, { subtest: 'pbm', sort: 'NEWEST' }))).toEqual(['a', 'd']);
    expect(ids(filterHistory(entries, { subtest: 'penalaran-matematika', sort: 'NEWEST' }))).toEqual([]);
  });

  it('combines the filters', () => {
    expect(ids(filterHistory(entries, { band: 'CUKUP', subtest: 'ppu', sort: 'NEWEST' }))).toEqual(['e']);
  });

  it('does not reorder the list it is given', () => {
    const before = ids(entries);
    filterHistory(entries, { sort: 'LOWEST' });
    expect(ids(entries)).toEqual(before);
  });
});
