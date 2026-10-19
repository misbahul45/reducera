import { SandboxContentError, VARIANT_FACTORS, buildSandboxContent, scaleScenario, variantFor, variantsOf } from '../sandbox-content';
import { content, readSeed, scenario } from '../engine/__tests__/test-content';

const DOTTED = /(?<![\d.])\d{1,3}(?:\.\d{3})+(?!\d)/g;
const amountsIn = (text: string) => (text.match(DOTTED) ?? []).map((token) => Number(token.replace(/\./g, '')));
const sum = (lines: Array<{ side: string; amount: number }>, side: string) => lines.filter((line) => line.side === side).reduce((total, line) => total + line.amount, 0);

describe('scenario variants', () => {
  it('gives every scenario at least four variants with new numbers', () => {
    for (const item of content.scenarios) {
      const variants = variantsOf(item);
      expect({ id: item.id, count: variants.length >= 4 }).toEqual({ id: item.id, count: true });
      for (const variant of variants) expect(variant.scenario.story).not.toBe(item.story);
    }
  });

  it('keeps the key balanced and every amount a whole number of rupiah', () => {
    for (const item of content.scenarios) {
      for (const { scenario: scaled } of variantsOf(item)) {
        expect(sum(scaled.key, 'DEBIT')).toBe(sum(scaled.key, 'CREDIT'));
        for (const line of scaled.key) expect(Number.isSafeInteger(line.amount) && line.amount >= 1).toBe(true);
      }
    }
  });

  it('scales the key and the text by the same factor, so the story still explains the key', () => {
    for (const item of content.scenarios) {
      for (const { scenario: scaled, factor } of variantsOf(item)) {
        const [numerator, denominator] = factor;
        item.key.forEach((line, index) => expect(scaled.key[index]!.amount * denominator).toBe(line.amount * numerator));
        const before = amountsIn(item.story + item.why);
        const after = amountsIn(scaled.story + scaled.why);
        expect(after).toHaveLength(before.length);
        before.forEach((value, index) => expect(after[index]! * denominator).toBe(value * numerator));
      }
    }
  });

  it('scales an amount that is written right after the currency sign', () => {
    const [first] = variantsOf(scenario('j-bayar-gaji'));
    expect(first!.scenario.story).toBe('Bersih Kilat membayar gaji karyawan Rp600.000 secara tunai.');
    expect(first!.scenario.key.map((line) => line.amount)).toEqual([600000, 600000]);
  });

  it('keeps accounts, sides, concept, tags and targets of the original', () => {
    const base = scenario('j-bayar-gaji');
    const [first] = variantsOf(base);
    expect(first!.scenario.key.map((line) => [line.account, line.side])).toEqual(base.key.map((line) => [line.account, line.side]));
    expect(first!.scenario).toMatchObject({ id: base.id, conceptId: base.conceptId, targets: base.targets, tags: base.tags, level: base.level });
  });

  it('leaves percentages, months and years of the story alone', () => {
    const discount = variantsOf(scenario('j-potongan-jual'));
    for (const { scenario: scaled } of discount) expect(scaled.story).toContain('2 persen');
    const depreciation = variantsOf(scenario('j-ayat-penyusutan'));
    for (const { scenario: scaled } of depreciation) expect(scaled.story).toContain('5 tahun (60 bulan)');
  });

  it('checks the example of a computed scenario: 9.000.000 over 60 months stays exact', () => {
    for (const { scenario: scaled } of variantsOf(scenario('j-ayat-penyusutan'))) {
      const [total] = amountsIn(scaled.story);
      expect(scaled.key[0]!.amount).toBe(total! / 60);
    }
  });

  it('picks the variant from the seed the same way every time and cycles through all of them', () => {
    const base = scenario('j-bayar-gaji');
    const count = variantsOf(base).length;
    expect(variantFor(base, 1)!.scenario.story).toBe(variantFor(base, 1)!.scenario.story);
    expect(variantFor(base, 1)!.scenario.story).toBe(variantFor(base, 1 + count)!.scenario.story);
    expect(new Set(Array.from({ length: count }, (_, index) => variantFor(base, index + 1)!.scenario.story)).size).toBe(count);
  });

  it('refuses a seed that is not a positive whole number', () => {
    const base = scenario('j-bayar-gaji');
    for (const seed of [0, -1, 1.5, Number.NaN]) expect(variantFor(base, seed)).toBeNull();
  });

  it('returns nothing when a factor would break a whole rupiah amount', () => {
    const odd = { ...scenario('j-bayar-gaji'), story: 'Bersih Kilat membayar gaji Rp1.001.', key: [{ account: '511', side: 'DEBIT' as const, amount: 1001 }, { account: '101', side: 'CREDIT' as const, amount: 1001 }] };
    expect(scaleScenario(odd, [1, 2])).toBeNull();
    expect(scaleScenario(odd, [2, 1])).not.toBeNull();
  });

  it('exposes the factors in the order the seeds walk through them', () => {
    expect(VARIANT_FACTORS.length).toBeGreaterThanOrEqual(6);
  });

  it('rejects content that writes an amount without thousand separators', () => {
    const chart = readSeed('sandbox-chart-of-accounts.json');
    const file = readSeed('sandbox-scenarios.json') as { scenarios: Array<Record<string, unknown>> };
    const broken = { ...file, scenarios: [{ ...file.scenarios[0], story: 'Pemilik menyetor modal Rp10000000 tunai untuk usaha laundry.' }] };
    expect(() => buildSandboxContent(chart, broken)).toThrow(SandboxContentError);
  });
});
