import { Rng } from '../rng';
import { ItemDraft } from '../tryout-types';
import { Generator, Retryable, buildChoices, formatNumber, fraction, gcd, generateMany, lcm, numericChoices } from './support';

const SUBTEST = 'pengetahuan-kuantitatif' as const;
const ALGEBRA = { section: 'Bilangan dan aljabar', conceptId: 'utbk-pk-bilangan-aljabar' } as const;
const GEOMETRY = { section: 'Geometri dan pengukuran', conceptId: 'utbk-pk-geometri-pengukuran' } as const;
const DATA = { section: 'Data dan peluang', conceptId: 'utbk-pk-data-peluang' } as const;

const SUPERSCRIPT = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'];

const power = (base: number, exponent: number) => `${base}${String(exponent).split('').map((digit) => SUPERSCRIPT[Number(digit)]).join('')}`;

const signed = (value: number) => (value < 0 ? `− ${-value}` : `+ ${value}`);

const linearEquation: Generator = (rng) => {
  const a = rng.int(2, 9);
  const x = rng.int(-5, 12);
  const b = rng.int(-10, 15);
  const c = a * x + b;
  const { options, answer } = numericChoices(rng, x, [(c + b) / a, (c - b) * a, c / a - b, x + 1, x - 1], (v) => formatNumber(Math.round(v * 100) / 100));
  return {
    subtest: SUBTEST,
    ...ALGEBRA,
    stem: `Jika ${a}x ${signed(b)} = ${c}, maka nilai x adalah ...`,
    options,
    answer,
    explanation: `${a}x = ${c} ${b < 0 ? `+ ${-b}` : `− ${b}`} = ${c - b}, sehingga x = ${c - b} ÷ ${a} = ${x}.`,
  };
};

const exponents: Generator = (rng) => {
  const base = rng.pick([2, 3, 5]);
  const a = rng.int(2, 6);
  const b = rng.int(2, 6);
  const c = rng.int(1, a + b - 1);
  const exponent = a + b - c;
  const value = base ** exponent;
  const { options, answer } = numericChoices(rng, value, [base ** (exponent + 1), base ** Math.max(0, exponent - 1), base ** a, base ** b, base ** (a + b)]);
  return {
    subtest: SUBTEST,
    ...ALGEBRA,
    stem: `Nilai dari ${power(base, a)} × ${power(base, b)} ÷ ${power(base, c)} adalah ...`,
    options,
    answer,
    explanation: `Pangkat dijumlahkan saat dikali dan dikurangkan saat dibagi: ${base}^(${a} + ${b} − ${c}) = ${power(base, exponent)} = ${formatNumber(value)}.`,
  };
};

const percentOf: Generator = (rng) => {
  const percent = rng.pick([5, 10, 12.5, 15, 20, 25, 30, 40, 60, 75]);
  const whole = rng.int(2, 40) * 40;
  const value = (percent * whole) / 100;
  const { options, answer } = numericChoices(rng, value, [percent * 10, whole / percent, whole - value, value * 2]);
  return {
    subtest: SUBTEST,
    ...ALGEBRA,
    stem: `${formatNumber(percent)}% dari ${formatNumber(whole)} adalah ...`,
    options,
    answer,
    explanation: `${formatNumber(percent)}/100 × ${formatNumber(whole)} = ${formatNumber(value)}.`,
  };
};

const fractionSum: Generator = (rng) => {
  const b = rng.int(2, 9);
  const d = rng.int(2, 9);
  if (b === d) throw new Retryable('retry');
  const a = rng.int(1, b - 1);
  const c = rng.int(1, d - 1);
  const common = lcm(b, d);
  const numerator = a * (common / b) + c * (common / d);
  const correct = fraction(numerator, common);
  const { options, answer } = buildChoices(rng, correct, [
    fraction(a + c, b + d),
    fraction(a * c, b * d),
    fraction(numerator + 1, common),
    fraction(numerator, common + 1),
    fraction(Math.abs(a * d - c * b), b * d),
  ]);
  return {
    subtest: SUBTEST,
    ...ALGEBRA,
    stem: `Hasil dari ${a}/${b} + ${c}/${d} adalah ...`,
    options,
    answer,
    explanation: `Samakan penyebut menjadi ${common}: ${a * (common / b)}/${common} + ${c * (common / d)}/${common} = ${numerator}/${common}${correct === `${numerator}/${common}` ? '' : ` = ${correct}`}.`,
  };
};

const pairOfEquations: Generator = (rng) => {
  const x = rng.int(4, 15);
  const y = rng.int(1, x - 1);
  const sum = x + y;
  const difference = x - y;
  const product = x * y;
  const { options, answer } = numericChoices(rng, product, [sum * difference, x + y + 1, x * x, y * y, product + x]);
  return {
    subtest: SUBTEST,
    ...ALGEBRA,
    stem: `Jika x + y = ${sum} dan x − y = ${difference}, maka nilai xy adalah ...`,
    options,
    answer,
    explanation: `Jumlahkan kedua persamaan: 2x = ${sum + difference}, sehingga x = ${x} dan y = ${y}. Maka xy = ${product}.`,
  };
};

const functionValue: Generator = (rng) => {
  const a = rng.int(2, 6);
  const b = rng.int(-9, 9);
  const k = rng.int(-4, 8);
  const value = a * k + b;
  const { options, answer } = numericChoices(rng, value, [a + k + b, a * (k + b), a * k - b, -value, a * b + k]);
  return {
    subtest: SUBTEST,
    ...ALGEBRA,
    stem: `Diketahui f(x) = ${a}x ${signed(b)}. Nilai f(${k}) adalah ...`,
    options,
    answer,
    explanation: `f(${k}) = ${a} × ${k < 0 ? `(${k})` : k} ${signed(b)} = ${value}.`,
  };
};

const countIntegers: Generator = (rng) => {
  const low = rng.int(-6, 3);
  const high = low + rng.int(4, 9);
  const kind = rng.int(0, 3);
  const leftStrict = kind === 0 || kind === 2;
  const rightStrict = kind === 0 || kind === 1;
  const first = leftStrict ? low + 1 : low;
  const last = rightStrict ? high - 1 : high;
  const count = last - first + 1;
  const { options, answer } = numericChoices(rng, count, [high - low, high - low + 1, high - low - 1, high - low + 2]);
  return {
    subtest: SUBTEST,
    ...ALGEBRA,
    stem: `Banyaknya bilangan bulat x yang memenuhi ${low} ${leftStrict ? '<' : '≤'} x ${rightStrict ? '<' : '≤'} ${high} adalah ...`,
    options,
    answer,
    explanation: `Bilangan bulat yang memenuhi adalah ${first} sampai ${last}, yaitu ${last} − ${first} + 1 = ${count} bilangan.`,
  };
};

const gcdOrLcm: Generator = (rng) => {
  const g = rng.int(2, 9);
  const m = rng.int(2, 6);
  const n = rng.int(2, 6);
  if (m === n || gcd(m, n) !== 1) throw new Retryable('retry');
  const a = g * m;
  const b = g * n;
  const askLcm = rng.chance(0.5);
  const value = askLcm ? lcm(a, b) : gcd(a, b);
  const { options, answer } = numericChoices(rng, value, [a * b, a + b, askLcm ? gcd(a, b) : lcm(a, b), Math.abs(a - b)]);
  return {
    subtest: SUBTEST,
    ...ALGEBRA,
    stem: `${askLcm ? 'Kelipatan persekutuan terkecil (KPK)' : 'Faktor persekutuan terbesar (FPB)'} dari ${a} dan ${b} adalah ...`,
    options,
    answer,
    explanation: `FPB(${a}, ${b}) = ${gcd(a, b)} dan KPK(${a}, ${b}) = ${a} × ${b} ÷ ${gcd(a, b)} = ${lcm(a, b)}.`,
  };
};

const rectangleFromPerimeter: Generator = (rng) => {
  const width = rng.int(2, 15);
  const ratio = rng.int(2, 3);
  const length = width * ratio;
  const perimeter = 2 * (width + length);
  const area = width * length;
  const { options, answer } = numericChoices(rng, area, [perimeter * width, (perimeter / 4) ** 2, length * length, perimeter + area / 2]);
  return {
    subtest: SUBTEST,
    ...GEOMETRY,
    stem: `Keliling sebuah persegi panjang adalah ${perimeter} cm. Jika panjangnya ${ratio} kali lebarnya, luas persegi panjang tersebut adalah ... cm².`,
    options,
    answer,
    explanation: `Keliling = 2(p + l) = 2(${ratio}l + l) = ${2 * (ratio + 1)}l = ${perimeter}, sehingga l = ${width} cm dan p = ${length} cm. Luas = ${length} × ${width} = ${area} cm².`,
  };
};

const TRIPLES: ReadonlyArray<readonly [number, number, number]> = [
  [3, 4, 5],
  [5, 12, 13],
  [8, 15, 17],
  [7, 24, 25],
];

const pythagoras: Generator = (rng) => {
  const [a, b, c] = rng.pick(TRIPLES);
  const scale = rng.int(1, 4);
  const askHypotenuse = rng.chance(0.5);
  const [x, y, z] = [a * scale, b * scale, c * scale];
  const target = askHypotenuse ? z : y;
  const { options, answer } = numericChoices(rng, target, [x + y, askHypotenuse ? x * y : z - x, z + x, Math.abs(z - y)]);
  const stem = askHypotenuse
    ? `Sebuah segitiga siku-siku memiliki panjang sisi tegak ${x} cm dan ${y} cm. Panjang sisi miringnya adalah ... cm.`
    : `Sebuah segitiga siku-siku memiliki sisi miring ${z} cm dan salah satu sisi tegaknya ${x} cm. Panjang sisi tegak yang lain adalah ... cm.`;
  return {
    subtest: SUBTEST,
    ...GEOMETRY,
    stem,
    options,
    answer,
    explanation: askHypotenuse
      ? `Sisi miring = √(${x}² + ${y}²) = √${x * x + y * y} = ${z} cm.`
      : `Sisi tegak lain = √(${z}² − ${x}²) = √${z * z - x * x} = ${y} cm.`,
  };
};

const circleArea: Generator = (rng) => {
  const radius = 7 * rng.int(1, 5);
  const askArea = rng.chance(0.5);
  const value = askArea ? (22 * radius * radius) / 7 : (44 * radius) / 7;
  const { options, answer } = numericChoices(rng, value, [askArea ? (44 * radius) / 7 : (22 * radius * radius) / 7, (22 * radius) / 7, 2 * value, (22 * radius * radius) / 14]);
  return {
    subtest: SUBTEST,
    ...GEOMETRY,
    stem: `Sebuah lingkaran berjari-jari ${radius} cm. Dengan π = 22/7, ${askArea ? 'luas' : 'keliling'} lingkaran tersebut adalah ... ${askArea ? 'cm²' : 'cm'}.`,
    options,
    answer,
    explanation: askArea ? `Luas = π r² = 22/7 × ${radius} × ${radius} = ${formatNumber(value)} cm².` : `Keliling = 2π r = 2 × 22/7 × ${radius} = ${formatNumber(value)} cm.`,
  };
};

const cuboid: Generator = (rng) => {
  const p = rng.int(3, 12);
  const l = rng.int(2, 9);
  const t = rng.int(2, 8);
  const askVolume = rng.chance(0.5);
  const value = askVolume ? p * l * t : 2 * (p * l + p * t + l * t);
  const { options, answer } = numericChoices(rng, value, [askVolume ? 2 * (p * l + p * t + l * t) : p * l * t, p * l + p * t + l * t, 4 * (p + l + t), p + l + t]);
  return {
    subtest: SUBTEST,
    ...GEOMETRY,
    stem: `Sebuah balok berukuran panjang ${p} cm, lebar ${l} cm, dan tinggi ${t} cm. ${askVolume ? 'Volume' : 'Luas permukaan'} balok tersebut adalah ... ${askVolume ? 'cm³' : 'cm²'}.`,
    options,
    answer,
    explanation: askVolume
      ? `Volume = p × l × t = ${p} × ${l} × ${t} = ${value} cm³.`
      : `Luas permukaan = 2(pl + pt + lt) = 2(${p * l} + ${p * t} + ${l * t}) = ${value} cm².`,
  };
};

const triangleAngles: Generator = (rng) => {
  if (rng.chance(0.5)) {
    const first = rng.int(30, 80);
    const second = rng.int(30, 140 - first);
    const third = 180 - first - second;
    const { options, answer } = numericChoices(rng, third, [360 - first - second, 90 - first, 180 - first, first + second]);
    return {
      subtest: SUBTEST,
      ...GEOMETRY,
      stem: `Dua sudut sebuah segitiga masing-masing ${first}° dan ${second}°. Besar sudut ketiga adalah ... derajat.`,
      options,
      answer,
      explanation: `Jumlah sudut segitiga 180°, sehingga sudut ketiga = 180° − ${first}° − ${second}° = ${third}°.`,
    };
  }
  const apex = rng.pick([20, 30, 40, 50, 60, 80, 100]);
  const base = (180 - apex) / 2;
  const { options, answer } = numericChoices(rng, base, [180 - apex, apex, (360 - apex) / 2, base + 10]);
  return {
    subtest: SUBTEST,
    ...GEOMETRY,
    stem: `Sebuah segitiga sama kaki memiliki sudut puncak ${apex}°. Besar salah satu sudut alasnya adalah ... derajat.`,
    options,
    answer,
    explanation: `Sudut alas sama besar. Jumlahnya 180° − ${apex}° = ${180 - apex}°, sehingga masing-masing ${base}°.`,
  };
};

const meanOfData: Generator = (rng) => {
  const size = rng.int(5, 7);
  const mean = rng.int(6, 20);
  const values = Array.from({ length: size - 1 }, () => rng.int(mean - 4, mean + 4));
  const last = mean * size - values.reduce((sum, value) => sum + value, 0);
  if (last < 1) throw new Retryable('retry');
  const data = rng.shuffle([...values, last]);
  const { options, answer } = numericChoices(rng, mean, [[...data].sort((a, b) => a - b)[Math.floor(size / 2)], Math.max(...data), Math.min(...data), mean + 2]);
  return {
    subtest: SUBTEST,
    ...DATA,
    stem: `Data nilai: ${data.join(', ')}. Rata-rata data tersebut adalah ...`,
    options,
    answer,
    explanation: `Jumlah data = ${mean * size}, banyak data = ${size}, sehingga rata-rata = ${mean * size} ÷ ${size} = ${mean}.`,
  };
};

const medianOfData: Generator = (rng) => {
  const size = rng.pick([5, 7, 9]);
  const values = Array.from({ length: size }, () => rng.int(2, 30));
  const sorted = [...values].sort((a, b) => a - b);
  const median = sorted[(size - 1) / 2];
  const mean = Math.round(values.reduce((sum, value) => sum + value, 0) / size);
  const { options, answer } = numericChoices(rng, median, [mean, values[(size - 1) / 2], Math.max(...values), sorted[(size - 1) / 2 + 1], sorted[(size - 1) / 2 - 1]]);
  return {
    subtest: SUBTEST,
    ...DATA,
    stem: `Median dari data ${values.join(', ')} adalah ...`,
    options,
    answer,
    explanation: `Data terurut: ${sorted.join(', ')}. Nilai tengahnya (urutan ke-${(size + 1) / 2}) adalah ${median}.`,
  };
};

const diceProbability: Generator = (rng) => {
  const variants = [
    { text: 'mata dadu prima', favourable: 3, total: 6, how: 'Mata prima: 2, 3, 5 (3 dari 6).' },
    { text: 'mata dadu kelipatan 3', favourable: 2, total: 6, how: 'Kelipatan 3: 3 dan 6 (2 dari 6).' },
    { text: 'jumlah mata dua dadu sama dengan 7', favourable: 6, total: 36, how: 'Pasangan berjumlah 7: (1,6), (2,5), (3,4), (4,3), (5,2), (6,1) (6 dari 36).' },
    { text: 'jumlah mata dua dadu sama dengan 10', favourable: 3, total: 36, how: 'Pasangan berjumlah 10: (4,6), (5,5), (6,4) (3 dari 36).' },
    { text: 'mata kedua dadu sama', favourable: 6, total: 36, how: 'Pasangan kembar: (1,1) sampai (6,6) (6 dari 36).' },
  ];
  const variant = rng.pick(variants);
  const correct = fraction(variant.favourable, variant.total);
  const { options, answer } = buildChoices(rng, correct, [
    fraction(variant.favourable + 1, variant.total),
    fraction(variant.favourable, variant.total * 2),
    fraction(variant.total - variant.favourable, variant.total),
    fraction(1, variant.total),
    fraction(variant.favourable * 2, variant.total),
    '1/3',
  ]);
  const twoDice = variant.total === 36;
  return {
    subtest: SUBTEST,
    ...DATA,
    stem: `Peluang munculnya ${variant.text} pada pelemparan ${twoDice ? 'dua dadu sisi enam sekaligus' : 'sebuah dadu sisi enam'} adalah ...`,
    options,
    answer,
    explanation: `${variant.how} Peluang = ${variant.favourable}/${variant.total}${correct === `${variant.favourable}/${variant.total}` ? '' : ` = ${correct}`}.`,
  };
};

const ballProbability: Generator = (rng) => {
  const red = rng.int(2, 6);
  const blue = rng.int(2, 6);
  const white = rng.int(1, 5);
  const total = red + blue + white;
  const askNotRed = rng.chance(0.5);
  const favourable = askNotRed ? blue + white : red;
  const correct = fraction(favourable, total);
  const { options, answer } = buildChoices(rng, correct, [
    fraction(askNotRed ? red : blue + white, total),
    fraction(favourable, total + 1),
    fraction(favourable, red + blue),
    fraction(white, total),
    fraction(favourable + 1, total),
    fraction(blue, total),
  ]);
  return {
    subtest: SUBTEST,
    ...DATA,
    stem: `Sebuah kotak berisi ${red} bola merah, ${blue} bola biru, dan ${white} bola putih. Satu bola diambil secara acak. Peluang terambilnya bola ${askNotRed ? 'yang bukan merah' : 'merah'} adalah ...`,
    options,
    answer,
    explanation: `Banyak bola ${total}; yang diminta ${favourable}. Peluang = ${favourable}/${total}${correct === `${favourable}/${total}` ? '' : ` = ${correct}`}.`,
  };
};

const combination: Generator = (rng) => {
  const people = rng.int(5, 10);
  const choose = rng.int(2, 3);
  const value = choose === 2 ? (people * (people - 1)) / 2 : (people * (people - 1) * (people - 2)) / 6;
  const arrangements = choose === 2 ? people * (people - 1) : people * (people - 1) * (people - 2);
  const { options, answer } = numericChoices(rng, value, [arrangements, people * choose, people ** choose, value + people]);
  return {
    subtest: SUBTEST,
    ...DATA,
    stem: `Dari ${people} orang akan dipilih ${choose} orang untuk menjadi perwakilan tanpa memperhatikan urutan. Banyak cara memilihnya adalah ...`,
    options,
    answer,
    explanation: `Karena urutan tidak diperhatikan, gunakan kombinasi C(${people}, ${choose}) = ${value}. Jika urutan diperhatikan, hasilnya ${arrangements}.`,
  };
};

const SECTION_MAKERS = {
  algebra: [linearEquation, exponents, percentOf, fractionSum, pairOfEquations, functionValue, countIntegers, gcdOrLcm],
  geometry: [rectangleFromPerimeter, pythagoras, circleArea, cuboid, triangleAngles],
  data: [meanOfData, medianOfData, diceProbability, ballProbability, combination],
} as const;

const split = (count: number): [number, number, number] => {
  const algebra = Math.ceil(count * 0.4);
  const geometry = Math.floor((count - algebra) / 2);
  return [algebra, geometry, count - algebra - geometry];
};

export const generatePengetahuanKuantitatif = (rng: Rng, count: number): ItemDraft[] => {
  const [algebra, geometry, data] = split(count);
  return [
    ...(algebra > 0 ? generateMany(rng, algebra, SECTION_MAKERS.algebra) : []),
    ...(geometry > 0 ? generateMany(rng, geometry, SECTION_MAKERS.geometry) : []),
    ...(data > 0 ? generateMany(rng, data, SECTION_MAKERS.data) : []),
  ];
};
