import * as fc from 'fast-check';
import { evaluateJournal, JournalLine } from '../index';
import { content, scenario } from './test-content';

const run = (id: string, lines: JournalLine[]) => evaluateJournal(lines, scenario(id), content.chart);
const codes = (id: string, lines: JournalLine[]) => run(id, lines).findings.map((finding) => finding.code);
const line = (account: string, side: 'DEBIT' | 'CREDIT', amount: number): JournalLine => ({ account, side, amount });

describe('evaluateJournal on the real scenarios', () => {
  it.each(content.scenarios.map((item) => [item.id, item.key] as const))('%s is correct with its own key', (id, key) => {
    const result = run(id, [...key]);
    expect(result.correct).toBe(true);
    expect(result.score).toBe(1);
    expect(result.findings).toEqual([]);
    expect(result.equation.holds).toBe(true);
  });

  it.each(content.scenarios.map((item) => [item.id, item.key] as const))('%s does not care about line order', (id, key) => {
    expect(run(id, [...key].reverse()).correct).toBe(true);
  });

  it.each(content.scenarios.map((item) => [item.id, item.key] as const))('%s flags a fully swapped journal as one global finding', (id, key) => {
    const swapped = key.map((l) => ({ ...l, side: l.side === 'DEBIT' ? ('CREDIT' as const) : ('DEBIT' as const) }));
    const result = run(id, swapped);
    expect(result.correct).toBe(false);
    expect(result.findings[0]).toMatchObject({ code: 'REVERSED_ALL_SIDES', severity: 'GLOBAL' });
    expect(result.findings.filter((finding) => finding.code === 'REVERSED_SIDE')).toHaveLength(0);
  });
});

describe('what the learner did', () => {
  it('accepts a split of one position over several lines', () => {
    const result = run('j-setor-modal', [line('101', 'DEBIT', 4000000), line('101', 'DEBIT', 6000000), line('301', 'CREDIT', 10000000)]);
    expect(result.correct).toBe(true);
    expect(result.verdicts.map((v) => v.status)).toEqual(['CORRECT', 'CORRECT', 'CORRECT']);
  });

  it('names a single reversed account in a compound entry', () => {
    const result = run('j-peralatan-campuran', [line('111', 'DEBIT', 8000000), line('101', 'DEBIT', 3000000), line('201', 'CREDIT', 5000000)]);
    expect(result.correct).toBe(false);
    expect(result.balanced).toBe(false);
    expect(result.verdicts.map((v) => v.status)).toEqual(['CORRECT', 'REVERSED_SIDE', 'CORRECT']);
    expect(result.findings.map((f) => f.code)).toEqual(expect.arrayContaining(['UNBALANCED', 'REVERSED_SIDE']));
  });

  it('spots transposed digits and zero slips as polish findings', () => {
    expect(codes('j-bayar-gaji', [line('511', 'DEBIT', 2100000), line('101', 'CREDIT', 2100000)])).toContain('TRANSPOSED_DIGITS');
    expect(codes('j-bayar-gaji', [line('511', 'DEBIT', 12000000), line('101', 'CREDIT', 12000000)])).toContain('ZERO_SLIP');
    const polish = run('j-bayar-gaji', [line('511', 'DEBIT', 2100000), line('101', 'CREDIT', 2100000)]).findings.find((f) => f.code === 'TRANSPOSED_DIGITS');
    expect(polish?.severity).toBe('POLISH');
  });

  it('reports a plain wrong amount', () => {
    const result = run('j-bayar-gaji', [line('511', 'DEBIT', 1300000), line('101', 'CREDIT', 1300000)]);
    expect(result.findings.map((f) => f.code)).toContain('WRONG_AMOUNT');
    expect(result.score).toBeCloseTo(0.5, 2);
  });

  it('tells a similar account from an account of another class', () => {
    expect(codes('j-bayar-gaji', [line('512', 'DEBIT', 1200000), line('101', 'CREDIT', 1200000)])).toContain('WRONG_ACCOUNT_SAME_CLASS');
    expect(codes('j-bayar-gaji', [line('106', 'DEBIT', 1200000), line('101', 'CREDIT', 1200000)])).toContain('WRONG_ACCOUNT_CLASS');
  });

  it('catches the contra account mix-up', () => {
    const result = run('j-ayat-penyusutan', [line('514', 'DEBIT', 150000), line('111', 'CREDIT', 150000)]);
    expect(result.findings.map((f) => f.code)).toContain('CONTRA_CONFUSION');
    expect(result.correct).toBe(false);
  });

  it('counts the lines still missing per side', () => {
    const result = run('j-peralatan-campuran', [line('111', 'DEBIT', 8000000), line('101', 'CREDIT', 3000000)]);
    expect(result.missingBySide).toEqual({ DEBIT: 0, CREDIT: 1 });
    expect(result.findings.map((f) => f.code)).toEqual(expect.arrayContaining(['UNBALANCED', 'MISSING_LINE']));
  });

  it('marks a line that has no place in the answer as extra', () => {
    const result = run('j-bayar-gaji', [line('511', 'DEBIT', 1200000), line('101', 'CREDIT', 1200000), line('106', 'DEBIT', 50000), line('102', 'CREDIT', 50000)]);
    expect(result.correct).toBe(false);
    expect(result.verdicts.slice(2).map((v) => v.status)).toEqual(['EXTRA', 'EXTRA']);
    expect(result.score).toBeLessThanOrEqual(0.5);
  });

  it('explains an unbalanced journal with the learner own totals', () => {
    const result = run('j-bayar-gaji', [line('511', 'DEBIT', 1200000), line('101', 'CREDIT', 1000000)]);
    const message = result.findings.find((f) => f.code === 'UNBALANCED')?.message ?? '';
    expect(message).toContain('Rp1.200.000');
    expect(message).toContain('Rp1.000.000');
    expect(message).toContain('Rp200.000');
  });

  it('asks for two sides when there is only one', () => {
    expect(codes('j-bayar-gaji', [line('511', 'DEBIT', 1200000)])).toEqual(expect.arrayContaining(['TOO_FEW_LINES', 'MISSING_SIDE', 'UNBALANCED']));
    expect(codes('j-bayar-gaji', [line('511', 'DEBIT', 600000), line('101', 'DEBIT', 600000)])).toContain('MISSING_SIDE');
  });

  it('warns when one account sits on both sides', () => {
    expect(codes('j-bayar-gaji', [line('511', 'DEBIT', 1200000), line('101', 'CREDIT', 1200000), line('101', 'DEBIT', 10000), line('101', 'CREDIT', 10000)])).toContain('SAME_ACCOUNT_BOTH_SIDES');
  });

  it('orders global findings before focus and polish ones', () => {
    const result = run('j-bayar-gaji', [line('511', 'DEBIT', 2100000), line('101', 'CREDIT', 1000000)]);
    const order = result.findings.map((f) => f.severity);
    expect(order).toEqual([...order].sort((a, b) => ['GLOBAL', 'FOCUS', 'POLISH'].indexOf(a) - ['GLOBAL', 'FOCUS', 'POLISH'].indexOf(b)));
  });
});

describe('the answer key stays private', () => {
  it.each(content.scenarios.map((item) => item.id))('%s: feedback on a wrong account never names the expected one', (id) => {
    const target = scenario(id);
    const first = target.key[0]!;
    const decoy = content.chart.all().find((a) => a.code !== first.account && content.chart.classOf(a.code) === content.chart.classOf(first.account))!;
    const lines = target.key.map((l, index) => (index === 0 ? { ...l, account: decoy.code } : l));
    const learnerNames = new Set(lines.map((l) => content.chart.nameOf(l.account)));
    let text = run(id, lines).findings.map((f) => f.message).join(' ');
    for (const own of Array.from(learnerNames).sort((a, b) => b.length - a.length)) text = text.split(own).join('');
    for (const expected of target.key) {
      const name = content.chart.nameOf(expected.account);
      if (!learnerNames.has(name)) expect(text).not.toContain(name);
    }
  });
});

describe('invariants under random input', () => {
  const lineArb = fc.record({
    account: fc.constantFrom(...content.chart.all().map((a) => a.code)),
    side: fc.constantFrom('DEBIT' as const, 'CREDIT' as const),
    amount: fc.integer({ min: 1, max: 99_999_999 }),
  });

  it('never throws, keeps the score in range and only calls an exact match correct', () => {
    fc.assert(
      fc.property(fc.constantFrom(...content.scenarios.map((s) => s.id)), fc.array(lineArb, { minLength: 0, maxLength: 7 }), (id, lines) => {
        const result = run(id, lines);
        expect(result.score).toBeGreaterThanOrEqual(0);
        expect(result.score).toBeLessThanOrEqual(1);
        expect(result.verdicts).toHaveLength(lines.length);
        expect(result.balanced).toBe(result.totalDebit === result.totalCredit);
        if (result.correct) {
          expect(result.score).toBe(1);
          expect(result.balanced).toBe(true);
          expect(result.findings).toEqual([]);
        } else {
          expect(result.score).toBeLessThan(1);
        }
      }),
      { numRuns: 400 },
    );
  });

  it('a journal equal to the key after any shuffle and split is correct', () => {
    fc.assert(
      fc.property(fc.constantFrom(...content.scenarios.map((s) => s.id)), fc.integer({ min: 0, max: 1000 }), (id, seed) => {
        const key = scenario(id).key;
        const split = key.flatMap((l, index) => ((seed + index) % 2 === 0 && l.amount > 1 ? [{ ...l, amount: 1 }, { ...l, amount: l.amount - 1 }] : [l]));
        const shuffled = [...split].sort((a, b) => ((a.amount * 31 + seed) % 7) - ((b.amount * 31 + seed) % 7));
        expect(run(id, shuffled).correct).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it('a balanced entry always satisfies the accounting equation', () => {
    const accountArb = fc.constantFrom(...content.chart.all().map((a) => a.code));
    const balancedArb = fc
      .tuple(fc.array(fc.tuple(accountArb, fc.integer({ min: 1, max: 9_999_999 })), { minLength: 1, maxLength: 3 }), fc.array(accountArb, { minLength: 1, maxLength: 3 }))
      .map(([debits, creditAccounts]) => {
        const total = debits.reduce((sum, [, amount]) => sum + amount, 0);
        const base = Math.floor(total / creditAccounts.length);
        const credits = creditAccounts.map((account, index) => ({
          account,
          side: 'CREDIT' as const,
          amount: index === creditAccounts.length - 1 ? total - base * (creditAccounts.length - 1) : base,
        }));
        return [...debits.map(([account, amount]) => ({ account, side: 'DEBIT' as const, amount })), ...credits];
      })
      .filter((lines) => lines.every((l) => l.amount >= 1));
    fc.assert(
      fc.property(balancedArb, (lines) => {
        expect(run('j-bayar-gaji', lines).equation.holds).toBe(true);
      }),
      { numRuns: 300 },
    );
  });
});
