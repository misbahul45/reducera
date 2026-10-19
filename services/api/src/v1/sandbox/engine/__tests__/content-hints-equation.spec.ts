import { buildHints, equationEffect, JournalLine, misconceptionsOf, SANDBOX_MISCONCEPTION_CODES } from '../index';
import { SandboxContentError, buildSandboxContent } from '../../sandbox-content';
import { content, readSeed, scenario } from './test-content';

const chartFile = readSeed('sandbox-chart-of-accounts.json') as { currency: string; accounts: Array<Record<string, unknown>> };
const scenarioFile = readSeed('sandbox-scenarios.json') as { version: number; currency: string; scenarios: Array<Record<string, any>> };
const graph = readSeed('golden-accounting-graph.json') as { levels: Array<{ topics: Array<{ id: string }> }> };
const conceptIds = new Set(graph.levels.flatMap((level) => level.topics.map((topic) => topic.id)));

describe('sandbox content', () => {
  it('ships a useful bank of scenarios on every level used', () => {
    expect(content.scenarios.length).toBeGreaterThanOrEqual(36);
    for (const level of [1, 2, 3, 4]) expect(content.scenarios.some((s) => s.level === level)).toBe(true);
    expect(content.scenarios.filter((s) => s.level === 1).length).toBeGreaterThanOrEqual(10);
  });

  it('points every scenario at a concept of the graph and every known concept code', () => {
    for (const item of content.scenarios) {
      expect(conceptIds.has(item.conceptId)).toBe(true);
      for (const target of item.targets) expect(SANDBOX_MISCONCEPTION_CODES as readonly string[]).toContain(target);
    }
  });

  it('is written in Indonesian rupiah with an explanation and a story that carries the amount', () => {
    for (const item of content.scenarios) {
      expect(item.story).toMatch(/Rp\d/);
      expect(item.why.length).toBeGreaterThan(30);
      expect(item.story).not.toMatch(/\$/);
    }
  });

  it('offers worked examples that are themselves solvable and different from the task', () => {
    const withExample = content.scenarios.filter((item) => item.example);
    expect(withExample.length).toBeGreaterThanOrEqual(8);
    for (const item of withExample) expect(item.example!.story).not.toBe(item.story);
  });

  it('refuses content that cannot be solved', () => {
    const broken = (patch: (file: typeof scenarioFile) => void, concepts?: ReadonlySet<string>) => {
      const copy = JSON.parse(JSON.stringify(scenarioFile));
      patch(copy);
      return () => buildSandboxContent(chartFile, copy, concepts);
    };
    expect(broken((f) => { f.scenarios[0]!.key[0].amount += 1; })).toThrow(SandboxContentError);
    expect(broken((f) => { f.scenarios[0]!.key[0].account = '999'; })).toThrow(/unknown account/);
    expect(broken((f) => { f.scenarios[1]!.id = f.scenarios[0]!.id; })).toThrow(/duplicate/);
    expect(broken((f) => { f.scenarios[0]!.key[0].amount = 1.5; })).toThrow(SandboxContentError);
    expect(broken((f) => { f.scenarios[0]!.conceptId = 'nope'; }, conceptIds)).toThrow(/unknown concept/);
    expect(broken((f) => { f.scenarios[0]!.key = [f.scenarios[0]!.key[0]]; })).toThrow(SandboxContentError);
  });

  it('refuses a chart with a duplicate code or an unknown type', () => {
    const dup = JSON.parse(JSON.stringify(chartFile));
    dup.accounts[1].code = dup.accounts[0].code;
    expect(() => buildSandboxContent(dup, scenarioFile)).toThrow();
    const odd = JSON.parse(JSON.stringify(chartFile));
    odd.accounts[0].type = 'MAGIC';
    expect(() => buildSandboxContent(odd, scenarioFile)).toThrow(SandboxContentError);
  });
});

describe('equationEffect', () => {
  const line = (account: string, side: 'DEBIT' | 'CREDIT', amount: number): JournalLine => ({ account, side, amount });
  it.each([
    ['capital paid in cash', [line('101', 'DEBIT', 10), line('301', 'CREDIT', 10)], { asset: 10, liability: 0, equity: 10 }],
    ['equipment on credit', [line('111', 'DEBIT', 5), line('201', 'CREDIT', 5)], { asset: 5, liability: 5, equity: 0 }],
    ['asset swap', [line('106', 'DEBIT', 7), line('101', 'CREDIT', 7)], { asset: 0, liability: 0, equity: 0 }],
    ['expense paid', [line('511', 'DEBIT', 3), line('101', 'CREDIT', 3)], { asset: -3, liability: 0, equity: -3 }],
    ['drawing', [line('302', 'DEBIT', 2), line('101', 'CREDIT', 2)], { asset: -2, liability: 0, equity: -2 }],
    ['contra asset (depreciation)', [line('514', 'DEBIT', 4), line('112', 'CREDIT', 4)], { asset: -4, liability: 0, equity: -4 }],
    ['unearned revenue earned', [line('204', 'DEBIT', 6), line('401', 'CREDIT', 6)], { asset: 0, liability: -6, equity: 6 }],
  ])('%s', (_name, lines, expected) => {
    const effect = equationEffect(lines, content.chart);
    expect(effect).toMatchObject({ ...expected, holds: true });
  });
});

describe('buildHints', () => {
  it('walks from the effect to the shape to the account names and never gives a number', () => {
    const [first, second, third] = buildHints(scenario('j-beli-perlengkapan').key, content.chart);
    expect(first).toContain('Aset bertambah');
    expect(first).toContain('Aset berkurang');
    expect(second).toContain('2 baris');
    expect(second).toContain('1 di sisi Debit');
    expect(third).toContain('Perlengkapan');
    expect(third).toContain('Kas');
    for (const hint of [first, second, third]) expect(hint).not.toMatch(/Rp|\d{3}/);
  });

  it('keeps sides and amounts out of the account hint', () => {
    for (const item of content.scenarios) {
      const hint = buildHints(item.key, content.chart)[2];
      expect(hint).not.toMatch(/Debit|Kredit|Rp/);
    }
  });

  it('describes closing accounts without inventing a direction', () => {
    expect(buildHints(scenario('j-tutup-pendapatan').key, content.chart)[0]).toContain('akun penutup');
  });
});

describe('misconceptionsOf', () => {
  it('maps a swapped side and an unbalanced entry to their misconception codes', () => {
    const found = misconceptionsOf(
      [
        { code: 'REVERSED_SIDE', severity: 'FOCUS', message: '', lineIndexes: [0] },
        { code: 'UNBALANCED', severity: 'GLOBAL', message: '', lineIndexes: [] },
      ],
      [],
    );
    expect(found).toEqual(['debit_credit_swap', 'accounting_equation_imbalance']);
  });

  it('uses the scenario targets to name the cause of a wrong account', () => {
    const wrong = [{ code: 'WRONG_ACCOUNT_CLASS' as const, severity: 'FOCUS' as const, message: '', lineIndexes: [0] }];
    expect(misconceptionsOf(wrong, ['adjusting_entry_error'])).toEqual(['adjusting_entry_error']);
    expect(misconceptionsOf(wrong, ['accrual_cash_confusion'])).toEqual(['accrual_cash_confusion']);
    expect(misconceptionsOf(wrong, [])).toEqual([]);
  });

  it('caps what one check can record', () => {
    const many = (['REVERSED_SIDE', 'CONTRA_CONFUSION', 'UNBALANCED', 'MISSING_SIDE'] as const).map((code) => ({ code, severity: 'FOCUS' as const, message: '', lineIndexes: [] }));
    expect(misconceptionsOf(many, [])).toHaveLength(3);
  });
});
