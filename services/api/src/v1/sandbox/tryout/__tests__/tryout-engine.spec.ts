import { readSeedJson } from '../../seed-file';
import { CHAINS, CLAUSES, Clause } from '../generators/penalaran-umum';
import { buildTryoutBank } from '../tryout-bank';
import { MAX_ITEMS_PER_SESSION, TryoutEngine, UTBK_EXAM_KEY } from '../tryout-engine';
import { SUBTEST_KEYS, SubtestKey, TryoutItem } from '../tryout-types';

const bank = buildTryoutBank(readSeedJson('tryout-utbk-bank.json'));
const engine = new TryoutEngine(bank);

const BANNED_TERMS = /\b(SMK|BNSP|SKKNI|sertifikasi|siswa|Menjadi Guru|cervana|ceruana|Industri 4\.0|sertifikat kompetensi)\b/i;
const BROKEN_TEXT = /undefined|NaN|Infinity|\[object|null/;

const SEEDS = Array.from({ length: 40 }, (_, index) => 1000 + index * 7919);

const fullPlan = () => ({
  examKey: UTBK_EXAM_KEY,
  subtests: engine.subtests().map((info) => ({ key: info.key, count: info.maxCount })),
});

const correctOption = (item: TryoutItem) => item.options[item.answer];

describe('TryoutEngine', () => {
  describe('the exam definition', () => {
    it('lists the seven subtests with the official counts and times', () => {
      const info = Object.fromEntries(engine.subtests().map((subtest) => [subtest.key, subtest]));
      expect(Object.keys(info)).toEqual([...SUBTEST_KEYS]);
      expect(info['penalaran-umum']).toMatchObject({ officialCount: 30, officialSeconds: 1800, secondsPerItem: 60, component: 'TPS' });
      expect(info.ppu).toMatchObject({ officialCount: 20, officialSeconds: 900, secondsPerItem: 45 });
      expect(info.pbm).toMatchObject({ officialCount: 20, officialSeconds: 1500, secondsPerItem: 75 });
      expect(info['pengetahuan-kuantitatif']).toMatchObject({ officialCount: 20, officialSeconds: 1200, secondsPerItem: 60 });
      expect(info['literasi-indonesia']).toMatchObject({ officialCount: 30, officialSeconds: 2550, secondsPerItem: 85, component: 'LITERASI' });
      expect(info['literasi-inggris']).toMatchObject({ officialCount: 20, officialSeconds: 1200, secondsPerItem: 60 });
      expect(info['penalaran-matematika']).toMatchObject({ officialCount: 20, officialSeconds: 2550, secondsPerItem: 127.5 });
      const tps = ['penalaran-umum', 'ppu', 'pbm', 'pengetahuan-kuantitatif'] as const;
      expect(tps.reduce((sum, key) => sum + info[key].officialCount, 0)).toBe(90);
      expect(tps.reduce((sum, key) => sum + info[key].officialSeconds, 0)).toBe(90 * 60);
      expect(SUBTEST_KEYS.reduce((sum, key) => sum + info[key].officialCount, 0)).toBe(160);
      expect(SUBTEST_KEYS.reduce((sum, key) => sum + info[key].officialSeconds, 0)).toBe(195 * 60);
    });

    it('never offers more questions than the bank can fill, and says so', () => {
      for (const subtest of engine.subtests()) {
        expect(subtest.maxCount).toBeGreaterThanOrEqual(1);
        expect(subtest.maxCount).toBeLessThanOrEqual(subtest.officialCount);
      }
      const info = Object.fromEntries(engine.subtests().map((subtest) => [subtest.key, subtest]));
      expect(info['penalaran-umum'].maxCount).toBe(30);
      expect(info.ppu.maxCount).toBe(20);
      expect(info.pbm.maxCount).toBe(20);
      expect(info['pengetahuan-kuantitatif'].maxCount).toBe(20);
      expect(info['penalaran-matematika'].maxCount).toBe(20);
      expect(info['literasi-indonesia'].maxCount).toBeLessThan(30);
    });

    it('offers presets whose size and time add up, with the TPS preset equal to the official 90 questions in 90 minutes', () => {
      const presets = engine.presets();
      expect(presets.map((preset) => preset.id)).toEqual(['singkat', 'tps', 'literasi']);
      const tps = presets.find((preset) => preset.id === 'tps')!;
      expect(tps.itemCount).toBe(90);
      expect(tps.durationSeconds).toBe(90 * 60);
      for (const preset of presets) {
        expect(engine.validate({ examKey: UTBK_EXAM_KEY, subtests: preset.subtests })).toBeNull();
        expect(preset.itemCount).toBe(preset.subtests.reduce((sum, entry) => sum + entry.count, 0));
        expect(preset.durationSeconds).toBe(engine.durationSeconds(preset.subtests));
      }
    });
  });

  describe('validating a plan', () => {
    const plan = (subtests: Array<{ key: SubtestKey; count: number }>, examKey = UTBK_EXAM_KEY) => ({ examKey, subtests });

    it('accepts a valid plan', () => {
      expect(engine.validate(plan([{ key: 'ppu', count: 5 }]))).toBeNull();
    });

    it('refuses an unknown exam, an empty plan, a repeated subtest and a bad count', () => {
      expect(engine.validate(plan([{ key: 'ppu', count: 5 }], 'toefl'))).toMatch(/tidak dikenal/);
      expect(engine.validate(plan([]))).toMatch(/setidaknya satu/);
      expect(engine.validate(plan([{ key: 'ppu', count: 5 }, { key: 'ppu', count: 6 }]))).toMatch(/satu kali/);
      expect(engine.validate(plan([{ key: 'ppu', count: 0 }]))).toMatch(/bilangan bulat positif/);
      expect(engine.validate(plan([{ key: 'ppu', count: 2.5 }]))).toMatch(/bilangan bulat positif/);
      expect(engine.validate(plan([{ key: 'ppu', count: 21 }]))).toMatch(/paling banyak 20/);
    });

    it('caps a session at 160 questions', () => {
      expect(MAX_ITEMS_PER_SESSION).toBe(160);
      expect(engine.validate(fullPlan())).toBeNull();
    });

    it('computes the duration from the official time per question', () => {
      expect(engine.durationSeconds([{ key: 'penalaran-umum', count: 30 }])).toBe(1800);
      expect(engine.durationSeconds([{ key: 'ppu', count: 4 }])).toBe(180);
      expect(engine.durationSeconds([{ key: 'penalaran-matematika', count: 3 }])).toBe(383);
    });

    it('refuses to compose an invalid plan', () => {
      expect(() => engine.compose(plan([{ key: 'ppu', count: 99 }]), 1)).toThrow(/paling banyak/);
    });
  });

  describe('every generated item, across many seeds', () => {
    const sessions = SEEDS.map((seed) => ({ seed, items: engine.compose(fullPlan(), seed) }));

    it('has the requested number of items per subtest, in the official order, with sequential ids', () => {
      for (const { items } of sessions) {
        const counts = SUBTEST_KEYS.map((key) => items.filter((item) => item.subtest === key).length);
        expect(counts).toEqual(engine.subtests().map((info) => info.maxCount));
        expect(items.map((item) => item.id)).toEqual(items.map((_, index) => `q${index + 1}`));
        const order = items.map((item) => SUBTEST_KEYS.indexOf(item.subtest));
        expect([...order].sort((a, b) => a - b)).toEqual(order);
      }
    });

    it('has four or five distinct options, exactly one marked correct, and readable text', () => {
      for (const { seed, items } of sessions) {
        for (const item of items) {
          const where = `seed ${seed} ${item.id} (${item.subtest})`;
          expect({ where, size: item.options.length >= 4 && item.options.length <= 5 }).toEqual({ where, size: true });
          expect({ where, distinct: new Set(item.options).size === item.options.length }).toEqual({ where, distinct: true });
          expect({ where, inRange: Number.isInteger(item.answer) && item.answer >= 0 && item.answer < item.options.length }).toEqual({ where, inRange: true });
          expect({ where, broken: BROKEN_TEXT.test([item.stem, item.explanation, ...item.options].join('\n')) }).toEqual({ where, broken: false });
          expect({ where, stem: item.stem.length > 10, explanation: item.explanation.length > 10 }).toEqual({ where, stem: true, explanation: true });
          expect({ where, banned: BANNED_TERMS.test([item.stem, item.explanation, item.section, ...item.options, item.passage?.text ?? ''].join('\n')) }).toEqual({ where, banned: false });
        }
      }
    });

    it('never repeats a question inside one session', () => {
      for (const { seed, items } of sessions) {
        const stems = items.map((item) => JSON.stringify([item.stem, item.passage?.id ?? '', [...item.options].sort()]));
        expect({ seed, unique: new Set(stems).size }).toEqual({ seed, unique: stems.length });
      }
    });

    it('tags each item with a concept that belongs to its subtest', () => {
      const allowed = Object.fromEntries(engine.subtests().map((info) => [info.key, info.conceptIds]));
      for (const { items } of sessions) {
        for (const item of items) expect(allowed[item.subtest]).toContain(item.conceptId);
      }
    });

    it('spreads the correct answer over every position', () => {
      const tally = [0, 0, 0, 0, 0];
      for (const { items } of sessions) for (const item of items) tally[item.answer] += 1;
      const total = tally.reduce((sum, value) => sum + value, 0);
      for (const count of tally.slice(0, 4)) expect(count / total).toBeGreaterThan(0.1);
    });

    it('is deterministic for a seed and different for another', () => {
      expect(engine.compose(fullPlan(), 4242)).toEqual(engine.compose(fullPlan(), 4242));
      const a = engine.compose({ examKey: UTBK_EXAM_KEY, subtests: [{ key: 'penalaran-umum', count: 30 }] }, 1);
      const b = engine.compose({ examKey: UTBK_EXAM_KEY, subtests: [{ key: 'penalaran-umum', count: 30 }] }, 2);
      expect(a.map((item) => item.stem)).not.toEqual(b.map((item) => item.stem));
    });

    it('keeps a subtest the same when another subtest is added to the plan', () => {
      const alone = engine.compose({ examKey: UTBK_EXAM_KEY, subtests: [{ key: 'pengetahuan-kuantitatif', count: 10 }] }, 77);
      const together = engine
        .compose({ examKey: UTBK_EXAM_KEY, subtests: [{ key: 'ppu', count: 5 }, { key: 'pengetahuan-kuantitatif', count: 10 }] }, 77)
        .filter((item) => item.subtest === 'pengetahuan-kuantitatif');
      expect(together.map(({ stem, options, answer }) => ({ stem, options, answer }))).toEqual(alone.map(({ stem, options, answer }) => ({ stem, options, answer })));
    });

    it('keeps the questions of a passage together and shows the same passage text', () => {
      for (const { items } of sessions) {
        for (const key of ['literasi-indonesia', 'literasi-inggris'] as const) {
          const group = items.filter((item) => item.subtest === key);
          const ids = group.map((item) => item.passage?.id);
          expect(ids.every(Boolean)).toBe(true);
          const seen = new Set<string>();
          let previous: string | undefined;
          for (const id of ids as string[]) {
            if (id !== previous) {
              expect(seen.has(id)).toBe(false);
              seen.add(id);
              previous = id;
            }
          }
        }
      }
    });
  });

  describe('the answer keys, recomputed another way', () => {
    const itemsOf = (key: SubtestKey, count: number) => SEEDS.flatMap((seed) => engine.compose({ examKey: UTBK_EXAM_KEY, subtests: [{ key, count }] }, seed));
    const parseNumber = (text: string) => Number(text.replace(/\./g, '').replace(',', '.'));
    const numbers = (text: string) => (text.match(/-?\d+(?:[.,]\d+)*/g) ?? []).map(parseNumber);

    describe('number series', () => {
      const predictions = (terms: number[]): number[] => {
        const out: number[] = [];
        const n = terms.length;
        const diffs = terms.slice(1).map((term, i) => term - terms[i]);
        if (diffs.every((d) => d === diffs[0])) out.push(terms[n - 1] + diffs[0]);
        const ratio = terms[1] / terms[0];
        if (terms.slice(1).every((t, i) => t === terms[i] * ratio)) out.push(terms[n - 1] * ratio);
        const second = diffs.slice(1).map((d, i) => d - diffs[i]);
        if (second.length > 0 && second.every((d) => d === second[0])) out.push(terms[n - 1] + diffs[n - 2] + second[0]);
        if (n >= 4 && terms.slice(2).every((t, i) => t === terms[i] + terms[i + 1])) out.push(terms[n - 1] + terms[n - 2]);
        const oddDiffs = terms.filter((_, i) => i % 2 === 0).map((t, i, list) => (i === 0 ? null : t - list[i - 1])).filter((v): v is number => v !== null);
        const evenDiffs = terms.filter((_, i) => i % 2 === 1).map((t, i, list) => (i === 0 ? null : t - list[i - 1])).filter((v): v is number => v !== null);
        if (n % 2 === 0 && oddDiffs.length > 0 && oddDiffs.every((d) => d === oddDiffs[0]) && evenDiffs.every((d) => d === evenDiffs[0])) {
          out.push(terms[n - 2] + oddDiffs[0]);
        }
        const shift = terms[0] - 1;
        if (terms.every((t, i) => t - shift === (i + 1) ** 2)) out.push((n + 1) ** 2 + shift);
        const add = terms[1] - 2 * terms[0];
        if (terms.slice(1).every((t, i) => t === 2 * terms[i] + add)) out.push(2 * terms[n - 1] + add);
        return out;
      };

      it('gives the term that a rule fitting every shown term predicts', () => {
        const series = itemsOf('penalaran-umum', 30).filter((item) => item.stem.startsWith('Perhatikan deret bilangan'));
        expect(series.length).toBeGreaterThan(200);
        for (const item of series) {
          const line = item.stem.split('\n')[1].replace(/, \.\.\.$/, '');
          const terms = line.split(', ').map(parseNumber);
          const predicted = predictions(terms);
          expect({ stem: item.stem, fits: predicted.includes(parseNumber(correctOption(item))) }).toEqual({ stem: item.stem, fits: true });
        }
      });

      it('continues letter patterns by the same step', () => {
        const letters = itemsOf('penalaran-umum', 30).filter((item) => item.stem.startsWith('Perhatikan pola huruf'));
        expect(letters.length).toBeGreaterThan(20);
        for (const item of letters) {
          const shown = item.stem.split('\n')[1].replace(/, \.\.\.$/, '').split(', ').map((letter) => letter.charCodeAt(0) - 65);
          const step = shown[1] - shown[0];
          expect(shown.every((value, i) => i === 0 || value - shown[i - 1] === step)).toBe(true);
          expect(correctOption(item)).toBe(String.fromCharCode(65 + shown[shown.length - 1] + step));
        }
      });
    });

    describe('ranking puzzles', () => {
      const permutations = <T,>(list: T[]): T[][] => (list.length <= 1 ? [list] : list.flatMap((item, i) => permutations([...list.slice(0, i), ...list.slice(i + 1)]).map((rest) => [item, ...rest])));

      it('has exactly one ordering that fits the clues, and the key follows from it', () => {
        const puzzles = itemsOf('penalaran-umum', 30).filter((item) => item.stem.includes('berdiri berjajar'));
        expect(puzzles.length).toBeGreaterThan(50);
        for (const item of puzzles) {
          const people = item.stem.match(/yaitu (.+?), berdiri/)![1].split(', ');
          const clues = [...item.stem.matchAll(/(\w+) lebih tinggi daripada (\w+)\./g)].map((match) => [match[1], match[2]] as const);
          const fitting = permutations(people).filter((order) => clues.every(([taller, shorter]) => order.indexOf(taller) < order.indexOf(shorter)));
          expect({ stem: item.stem, orderings: fitting.length }).toEqual({ stem: item.stem, orderings: 1 });
          const expected = item.stem.includes('paling tinggi') ? fitting[0][0] : fitting[0][fitting[0].length - 1];
          expect(correctOption(item)).toBe(expected);
        }
      });
    });

    describe('conditional reasoning', () => {
      const atoms = new Map<string, { atom: string; positive: boolean }>();
      const register = (clause: Clause) => {
        atoms.set(clause.yes.toLowerCase(), { atom: clause.yes.toLowerCase(), positive: true });
        atoms.set(clause.no.toLowerCase(), { atom: clause.yes.toLowerCase(), positive: false });
      };
      CLAUSES.forEach(register);
      CHAINS.flat().forEach(register);

      type Formula = (model: Record<string, boolean>) => boolean;

      const literal = (text: string): Formula => {
        const entry = atoms.get(text.replace(/\.$/, '').toLowerCase());
        if (!entry) throw new Error(`Unknown clause: ${text}`);
        return (model) => model[entry.atom] === entry.positive;
      };

      const clauseTexts = [...atoms.keys()].sort((a, b) => b.length - a.length);
      const splitAnd = (text: string): string[] | null => {
        const lower = text.replace(/\.$/, '').toLowerCase();
        for (const left of clauseTexts) {
          if (lower.startsWith(`${left} dan `)) {
            const right = lower.slice(left.length + 5);
            if (atoms.has(right)) return [left, right];
          }
        }
        return null;
      };

      const statement = (text: string): Formula => {
        const body = text.replace(/\.$/, '');
        const conditional = body.match(/^Jika (.+?), maka (.+)$/);
        if (conditional) {
          const [left, right] = [literal(conditional[1]), literal(conditional[2])];
          return (model) => !left(model) || right(model);
        }
        const conjunction = splitAnd(text);
        if (conjunction) {
          const [left, right] = conjunction.map(literal);
          return (model) => left(model) && right(model);
        }
        return literal(text);
      };

      const everyModel = (names: string[]): Array<Record<string, boolean>> =>
        Array.from({ length: 2 ** names.length }, (_, mask) => Object.fromEntries(names.map((name, i) => [name, Boolean(mask & (1 << i))])));

      it('only marks a conclusion correct when the premises force it, and no wrong option is forced', () => {
        const items = itemsOf('penalaran-umum', 30).filter((item) => item.stem.includes('Kesimpulan yang pasti benar adalah'));
        expect(items.length).toBeGreaterThan(100);
        for (const item of items) {
          const premises = item.stem.split('\n').slice(0, -1).map(statement);
          const haystack = [item.stem, ...item.options].join('\n').toLowerCase();
          const names = [...new Set([...atoms.entries()].filter(([text]) => haystack.includes(text)).map(([, entry]) => entry.atom))];
          expect(names.length).toBeLessThanOrEqual(8);
          const models = everyModel(names).filter((model) => premises.every((premise) => premise(model)));
          expect(models.length).toBeGreaterThan(0);
          const entailed = (formula: Formula) => models.every((model) => formula(model));
          const noConclusion = (option: string) => {
            const subject = option.match(/^Tidak dapat ditarik kesimpulan tentang (.+)\.$/)![1];
            const yes = atoms.get(subject.toLowerCase())!.atom;
            const positive = literal(yes);
            const negative = (model: Record<string, boolean>) => model[yes] === false;
            return !entailed(positive) && !entailed(negative);
          };
          const holds = (option: string) => (option.startsWith('Tidak dapat ditarik kesimpulan') ? noConclusion(option) : entailed(statement(option)));
          item.options.forEach((option, index) => {
            expect({ stem: item.stem, option, holds: holds(option) }).toEqual({ stem: item.stem, option, holds: index === item.answer });
          });
        }
      });
    });

    describe('syllogisms', () => {
      it('conclude only what both premises give', () => {
        const items = itemsOf('penalaran-umum', 30).filter((item) => item.stem.startsWith('Semua '));
        expect(items.length).toBeGreaterThan(50);
        for (const item of items) {
          const lines = item.stem.split('\n');
          const first = lines[0].match(/^Semua (.+) adalah (.+)\.$/)!;
          const [, a, b] = first;
          if (lines[1].startsWith('Semua ')) {
            const c = lines[1].match(/^Semua (.+) adalah (.+)\.$/)![2];
            expect(correctOption(item)).toBe(`Semua ${a} adalah ${c}.`);
          } else {
            const other = lines[1].match(/^Tidak ada (.+) yang (.+)\.$/)!;
            expect(other[1]).toBe(b);
            expect(correctOption(item)).toBe(`Tidak ada ${a} yang ${other[2]}.`);
          }
        }
      });
    });

    describe('arithmetic and algebra', () => {
      it('solves each linear equation by trial', () => {
        const items = itemsOf('pengetahuan-kuantitatif', 20).filter((item) => /^Jika \d+x [+−] \d+ = -?\d+, maka nilai x/.test(item.stem));
        expect(items.length).toBeGreaterThan(20);
        for (const item of items) {
          const [, a, sign, b, c] = item.stem.match(/^Jika (\d+)x ([+−]) (\d+) = (-?\d+)/)!;
          const solutions = Array.from({ length: 201 }, (_, i) => i - 100).filter((x) => Number(a) * x + (sign === '+' ? 1 : -1) * Number(b) === Number(c));
          expect(solutions).toHaveLength(1);
          expect(parseNumber(correctOption(item))).toBe(solutions[0]);
        }
      });

      it('counts integers in an interval by listing them', () => {
        const items = itemsOf('pengetahuan-kuantitatif', 20).filter((item) => item.stem.startsWith('Banyaknya bilangan bulat x'));
        expect(items.length).toBeGreaterThan(20);
        for (const item of items) {
          const [, low, left, right, high] = item.stem.match(/memenuhi (-?\d+) ([<≤]) x ([<≤]) (-?\d+)/)!;
          const listed = Array.from({ length: 80 }, (_, i) => i - 40).filter((x) => (left === '<' ? x > Number(low) : x >= Number(low)) && (right === '<' ? x < Number(high) : x <= Number(high)));
          expect(parseNumber(correctOption(item))).toBe(listed.length);
        }
      });

      it('finds FPB and KPK by search', () => {
        const items = itemsOf('pengetahuan-kuantitatif', 20).filter((item) => /\(KPK\)|\(FPB\)/.test(item.stem));
        expect(items.length).toBeGreaterThan(10);
        for (const item of items) {
          const [, a, b] = item.stem.match(/dari (\d+) dan (\d+)/)!.map(Number) as unknown as [string, number, number];
          const isLcm = item.stem.includes('KPK');
          const candidates = Array.from({ length: a * b }, (_, i) => i + 1);
          const common = candidates.filter((n) => (isLcm ? n % a === 0 && n % b === 0 : a % n === 0 && b % n === 0));
          expect(parseNumber(correctOption(item))).toBe(isLcm ? common[0] : common[common.length - 1]);
        }
      });

      it('applies a discount, a ratio, a mean, a distance and an age problem correctly', () => {
        const items = itemsOf('penalaran-umum', 30);
        const discount = items.filter((item) => item.stem.includes('dijual dengan diskon'));
        expect(discount.length).toBeGreaterThan(10);
        for (const item of discount) {
          const [, price, percent] = item.stem.match(/Rp([\d.]+) dijual dengan diskon (\d+)%/)!;
          expect(parseNumber(correctOption(item).replace('Rp', ''))).toBe(parseNumber(price) * (100 - Number(percent)) / 100);
        }
        const ratio = items.filter((item) => item.stem.includes('berbanding'));
        expect(ratio.length).toBeGreaterThan(10);
        for (const item of ratio) {
          const [, m, n, total] = item.stem.match(/berbanding (\d+) : (\d+)\. Jika jumlah uang mereka Rp([\d.]+)/)!;
          expect(parseNumber(correctOption(item).replace('Rp', '').replace('.000', ''))).toBe((Number(m) * parseNumber(total)) / 1000 / (Number(m) + Number(n)));
        }
        const mean = items.filter((item) => item.stem.includes('Agar rata-rata'));
        expect(mean.length).toBeGreaterThan(10);
        for (const item of mean) {
          const [, count, current, target] = item.stem.match(/nilai (\d+) ujian Wati adalah (\d+)\. Agar rata-rata setelah ujian berikutnya menjadi (\d+)/)!;
          const next = parseNumber(correctOption(item));
          expect((Number(current) * Number(count) + next) / (Number(count) + 1)).toBe(Number(target));
        }
        const travel = items.filter((item) => item.stem.includes('melaju dengan kecepatan tetap'));
        expect(travel.length).toBeGreaterThan(10);
        for (const item of travel) {
          const [, speed, minutes] = item.stem.match(/tetap (\d+) km\/jam selama (\d+) menit/)!;
          expect(parseNumber(correctOption(item))).toBeCloseTo((Number(speed) * Number(minutes)) / 60, 6);
        }
        const age = items.filter((item) => item.stem.includes('Umur seorang ayah'));
        expect(age.length).toBeGreaterThan(10);
        for (const item of age) {
          const [, multiple, sum] = item.stem.match(/ayah (\d+) kali umur anaknya\. Jumlah umur keduanya (\d+)/)!;
          const child = parseNumber(correctOption(item));
          expect(child + Number(multiple) * child).toBe(Number(sum));
        }
        const work = items.filter((item) => item.stem.includes('Pak Anto'));
        expect(work.length).toBeGreaterThan(10);
        for (const item of work) {
          const [, a, b] = item.stem.match(/dalam (\d+) jam, sedangkan Pak Beni dalam (\d+) jam/)!;
          const hours = parseNumber(correctOption(item));
          expect(hours * (1 / Number(a) + 1 / Number(b))).toBeCloseTo(1, 9);
        }
      });
    });

    describe('geometry, data and probability', () => {
      const fractionValue = (text: string) => (text.includes('/') ? Number(text.split('/')[0]) / Number(text.split('/')[1]) : Number(text));

      it('computes areas, volumes, angles and sides', () => {
        const items = itemsOf('pengetahuan-kuantitatif', 20);
        for (const item of items.filter((entry) => entry.stem.startsWith('Keliling sebuah persegi panjang'))) {
          const [, perimeter, ratio] = item.stem.match(/adalah (\d+) cm\. Jika panjangnya (\d+) kali lebarnya/)!;
          const width = Number(perimeter) / (2 * (Number(ratio) + 1));
          expect(parseNumber(correctOption(item))).toBe(width * width * Number(ratio));
        }
        for (const item of items.filter((entry) => entry.stem.includes('segitiga siku-siku'))) {
          const given = item.stem.includes('sisi miringnya adalah') ? 'hyp' : 'leg';
          const sides = numbers(item.stem);
          const answer = parseNumber(correctOption(item));
          if (given === 'hyp') expect(answer * answer).toBe(sides[0] * sides[0] + sides[1] * sides[1]);
          else expect(answer * answer + sides[1] * sides[1]).toBe(sides[0] * sides[0]);
        }
        for (const item of items.filter((entry) => entry.stem.startsWith('Sebuah balok'))) {
          const [, p, l, t] = item.stem.match(/panjang (\d+) cm, lebar (\d+) cm, dan tinggi (\d+) cm/)!.map(Number) as unknown as [string, number, number, number];
          const expected = item.stem.includes('Volume') ? p * l * t : 2 * (p * l + p * t + l * t);
          expect(parseNumber(correctOption(item))).toBe(expected);
        }
        for (const item of items.filter((entry) => entry.stem.startsWith('Sebuah lingkaran'))) {
          const radius = Number(item.stem.match(/berjari-jari (\d+) cm/)![1]);
          const expected = item.stem.includes('luas') ? (22 / 7) * radius * radius : 2 * (22 / 7) * radius;
          expect(parseNumber(correctOption(item))).toBeCloseTo(expected, 6);
        }
        for (const item of items.filter((entry) => entry.stem.includes('sudut'))) {
          const answer = parseNumber(correctOption(item));
          if (item.stem.includes('sama kaki')) expect(answer * 2 + Number(item.stem.match(/puncak (\d+)°/)![1])).toBe(180);
          else expect(answer + numbers(item.stem)[0] + numbers(item.stem)[1]).toBe(180);
        }
      });

      it('computes the mean, the median, the combinations and the probabilities by enumeration', () => {
        const items = itemsOf('pengetahuan-kuantitatif', 20);
        for (const item of items.filter((entry) => entry.stem.startsWith('Data nilai'))) {
          const data = numbers(item.stem.split(':')[1]);
          expect(parseNumber(correctOption(item))).toBeCloseTo(data.reduce((sum, value) => sum + value, 0) / data.length, 9);
        }
        for (const item of items.filter((entry) => entry.stem.startsWith('Median'))) {
          const data = numbers(item.stem.replace('Median dari data', '')).sort((a, b) => a - b);
          expect(parseNumber(correctOption(item))).toBe(data[(data.length - 1) / 2]);
        }
        for (const item of items.filter((entry) => entry.stem.includes('perwakilan tanpa memperhatikan urutan'))) {
          const [, people, choose] = item.stem.match(/Dari (\d+) orang akan dipilih (\d+) orang/)!.map(Number) as unknown as [string, number, number];
          let count = 0;
          for (let a = 0; a < people; a += 1) for (let b = a + 1; b < people; b += 1) {
            if (choose === 2) count += 1;
            else for (let c = b + 1; c < people; c += 1) count += 1;
          }
          expect(parseNumber(correctOption(item))).toBe(count);
        }
        for (const item of items.filter((entry) => entry.stem.includes('bola merah'))) {
          const [, red, blue, white] = item.stem.match(/berisi (\d+) bola merah, (\d+) bola biru, dan (\d+) bola putih/)!.map(Number) as unknown as [string, number, number, number];
          const total = red + blue + white;
          const expected = item.stem.includes('bukan merah') ? (blue + white) / total : red / total;
          expect(fractionValue(correctOption(item))).toBeCloseTo(expected, 9);
        }
        const dice = items.filter((entry) => entry.stem.includes('dadu'));
        expect(dice.length).toBeGreaterThan(10);
        for (const item of dice) {
          const rolls: number[][] = [];
          for (let a = 1; a <= 6; a += 1) for (let b = 1; b <= 6; b += 1) rolls.push([a, b]);
          const faces = [1, 2, 3, 4, 5, 6];
          const predicate: Record<string, [number, boolean]> = {
            'mata dadu prima': [faces.filter((f) => [2, 3, 5].includes(f)).length / 6, false],
            'mata dadu kelipatan 3': [faces.filter((f) => f % 3 === 0).length / 6, false],
            'jumlah mata dua dadu sama dengan 7': [rolls.filter(([a, b]) => a + b === 7).length / 36, true],
            'jumlah mata dua dadu sama dengan 10': [rolls.filter(([a, b]) => a + b === 10).length / 36, true],
            'mata kedua dadu sama': [rolls.filter(([a, b]) => a === b).length / 36, true],
          };
          const key = Object.keys(predicate).find((text) => item.stem.includes(`munculnya ${text} `));
          expect(key).toBeDefined();
          expect(fractionValue(correctOption(item))).toBeCloseTo(predicate[key as string][0], 9);
        }
      });
    });

    describe('penalaran matematika', () => {
      it('computes the unit conversions, the savings goal and the interest correctly', () => {
        const items = itemsOf('penalaran-matematika', 20);
        const speed = items.filter((item) => item.stem.includes('km/jam. Kecepatan tersebut'));
        expect(speed.length).toBeGreaterThan(10);
        for (const item of speed) {
          const kmh = Number(item.stem.match(/kecepatan (\d+) km\/jam/)![1]);
          expect(parseNumber(correctOption(item).replace(' m/s', ''))).toBeCloseTo(kmh / 3.6, 6);
        }
        const savings = items.filter((item) => item.stem.includes('Paling sedikit berapa minggu'));
        expect(savings.length).toBeGreaterThan(10);
        for (const item of savings) {
          const [, have, weekly, target] = item.stem.match(/tabungan Rp([\d.]+) dan menabung Rp([\d.]+) setiap akhir pekan\. Ia ingin membeli sepeda seharga Rp([\d.]+)/)!.map((value, i) => (i === 0 ? 0 : parseNumber(value))) as unknown as [number, number, number, number];
          const weeks = parseNumber(correctOption(item).replace(' minggu', ''));
          expect(have + weekly * weeks).toBeGreaterThanOrEqual(target);
          expect(have + weekly * (weeks - 1)).toBeLessThan(target);
        }
        const interest = items.filter((item) => item.stem.includes('bunga tunggal'));
        expect(interest.length).toBeGreaterThan(10);
        for (const item of interest) {
          const [, principal, rate, years] = item.stem.match(/menabung Rp([\d.]+) di sebuah bank dengan bunga tunggal (\d+)% per tahun\. Setelah (\d+) tahun/)!;
          expect(parseNumber(correctOption(item).replace('Rp', ''))).toBeCloseTo(parseNumber(principal) * (1 + (Number(rate) * Number(years)) / 100), 4);
        }
        const profit = items.filter((item) => item.stem.includes('Persentase keuntungan'));
        expect(profit.length).toBeGreaterThan(5);
        for (const item of profit) {
          const [, cost, sell] = item.stem.match(/seharga Rp([\d.]+) dan menjualnya seharga Rp([\d.]+)/)!;
          expect(parseNumber(correctOption(item).replace('%', ''))).toBeCloseTo(((parseNumber(sell) - parseNumber(cost)) / parseNumber(cost)) * 100, 9);
        }
        const map = items.filter((item) => item.stem.includes('peta berskala'));
        expect(map.length).toBeGreaterThan(10);
        for (const item of map) {
          const [, scale, cm] = item.stem.match(/1 : ([\d.]+), jarak antara kota P dan kota Q adalah (\d+) cm/)!;
          expect(parseNumber(correctOption(item).replace(' km', ''))).toBeCloseTo((parseNumber(scale) * Number(cm)) / 100_000, 6);
        }
        const table = items.filter((item) => item.stem.includes('Hari | Terjual'));
        expect(table.length).toBeGreaterThan(10);
        for (const item of table) {
          const rows = [...item.stem.matchAll(/^(\w+) \| (\d+)$/gm)].map((match) => [match[1], Number(match[2])] as const);
          const values = rows.map(([, value]) => value);
          const answer = correctOption(item);
          if (item.stem.includes('Jumlah roti')) expect(parseNumber(answer)).toBe(values.reduce((sum, value) => sum + value, 0));
          else if (item.stem.includes('Rata-rata')) expect(parseNumber(answer)).toBe(values.reduce((sum, value) => sum + value, 0) / values.length);
          else if (item.stem.includes('tertinggi terjadi')) expect(answer).toBe(rows.find(([, value]) => value === Math.max(...values))![0]);
          else expect(parseNumber(answer)).toBe(Math.max(...values) - Math.min(...values));
        }
        const compare = items.filter((item) => item.stem.includes('Paket A: biaya tetap'));
        expect(compare.length).toBeGreaterThan(5);
        for (const item of compare) {
          const [, fee, perGb, flat, usage] = item.stem.match(/tetap Rp([\d.]+) per bulan ditambah Rp([\d.]+) per GB[\s\S]*?Paket B: Rp([\d.]+)[\s\S]*?memakai (\d+) GB/)!.map((value, i) => (i === 0 ? 0 : parseNumber(value))) as unknown as [number, number, number, number, number];
          const a = fee + perGb * usage;
          const expected = `Paket ${a < flat ? 'A' : 'B'} lebih murah Rp${(Math.abs(a - flat)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')}.`;
          expect(correctOption(item)).toBe(expected);
        }
      });
    });

    describe('the verbal bank', () => {
      it('keeps every authored answer inside its options and every baku item consistent with its pair', () => {
        for (const item of itemsOf('pbm', 20).filter((entry) => entry.section === 'Ejaan dan kata baku')) {
          const askBaku = item.stem.includes('adalah ...') && item.stem.startsWith('Kata yang penulisannya baku');
          const answer = correctOption(item);
          const pair = bank.pbm.bakuPairs.find((entry) => (askBaku ? entry.baku : entry.tidakBaku) === answer);
          expect(pair).toBeDefined();
          for (const option of item.options.filter((_, index) => index !== item.answer)) {
            const owner = bank.pbm.bakuPairs.find((entry) => entry.baku === option || entry.tidakBaku === option)!;
            expect(askBaku ? owner.tidakBaku : owner.baku).toBe(option);
            expect(owner).not.toBe(pair);
          }
        }
      });

      it('rejects a malformed bank', () => {
        const broken = JSON.parse(JSON.stringify(readSeedJson('tryout-utbk-bank.json')));
        broken.ppu[0].answer = 9;
        expect(() => buildTryoutBank(broken)).toThrow();
        const duplicated = JSON.parse(JSON.stringify(readSeedJson('tryout-utbk-bank.json')));
        duplicated.pbm.bakuPairs.push({ baku: 'analisis', tidakBaku: 'analisa2' });
        expect(() => buildTryoutBank(duplicated)).toThrow(/twice/);
        const samePassage = JSON.parse(JSON.stringify(readSeedJson('tryout-utbk-bank.json')));
        samePassage.passages['literasi-inggris'][0].id = samePassage.passages['literasi-indonesia'][0].id;
        expect(() => buildTryoutBank(samePassage)).toThrow(/Duplicate passage/);
      });
    });
  });
});
