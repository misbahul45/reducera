import { Rng } from '../rng';
import { ItemDraft } from '../tryout-types';
import { Generator, Retryable, buildChoices, capitalize, formatNumber, fraction, generateMany, numericChoices } from './support';

const SUBTEST = 'penalaran-umum' as const;
const INDUCTIVE = { section: 'Penalaran induktif', conceptId: 'utbk-penalaran-induktif' } as const;
const DEDUCTIVE = { section: 'Penalaran deduktif', conceptId: 'utbk-penalaran-deduktif' } as const;
const QUANTITATIVE = { section: 'Penalaran kuantitatif', conceptId: 'utbk-penalaran-kuantitatif' } as const;

const series = (terms: number[]) => terms.map(formatNumber).join(', ');

const numberPattern = (rng: Rng, shown: number[], next: number, rule: string, near: number[]): ItemDraft => {
  const { options, answer } = numericChoices(rng, next, near);
  return {
    subtest: SUBTEST,
    ...INDUCTIVE,
    stem: `Perhatikan deret bilangan berikut.\n${series(shown)}, ...\nBilangan yang tepat untuk melanjutkan deret tersebut adalah ...`,
    options,
    answer,
    explanation: `${rule} Jadi bilangan berikutnya adalah ${formatNumber(next)}.`,
  };
};

const arithmetic: Generator = (rng) => {
  const first = rng.int(2, 30);
  const step = rng.int(2, 9);
  const shown = Array.from({ length: 5 }, (_, i) => first + step * i);
  const next = first + step * 5;
  return numberPattern(rng, shown, next, `Setiap suku bertambah ${step} dari suku sebelumnya.`, [next + step, next - step, next + 1, shown[4] + step + 1]);
};

const geometric: Generator = (rng) => {
  const first = rng.int(1, 5);
  const ratio = rng.int(2, 3);
  const shown = Array.from({ length: 5 }, (_, i) => first * ratio ** i);
  const next = first * ratio ** 5;
  return numberPattern(rng, shown, next, `Setiap suku dikali ${ratio} dari suku sebelumnya.`, [shown[4] + ratio, shown[4] * (ratio + 1), shown[4] + shown[3], next - ratio]);
};

const growingDifference: Generator = (rng) => {
  const first = rng.int(1, 20);
  const base = rng.int(1, 5);
  const growth = rng.int(1, 3);
  const terms = [first];
  const differences: number[] = [];
  for (let i = 0; i < 5; i += 1) {
    const difference = base + growth * i;
    differences.push(difference);
    terms.push(terms[terms.length - 1] + difference);
  }
  const shown = terms.slice(0, 5);
  const next = terms[5];
  return numberPattern(rng, shown, next, `Selisih antarsuku adalah ${differences.slice(0, 4).join(', ')}, yaitu bertambah ${growth} setiap kali, sehingga selisih berikutnya ${differences[4]}.`, [
    shown[4] + differences[3],
    next + growth,
    next - growth,
    shown[4] + differences[4] + 1,
  ]);
};

const alternating: Generator = (rng) => {
  const a = rng.int(1, 12);
  const p = rng.int(2, 6);
  const b = rng.int(20, 60);
  const q = rng.int(2, 5);
  const terms: number[] = [];
  for (let i = 0; i < 7; i += 1) terms.push(i % 2 === 0 ? a + p * (i / 2) : b - q * ((i - 1) / 2));
  const next = terms[6];
  return numberPattern(rng, terms.slice(0, 6), next, `Deret terdiri atas dua pola berselang-seling. Suku ke-1, ke-3, dan seterusnya naik ${p}; suku ke-2, ke-4, dan seterusnya turun ${q}.`, [
    terms[5] - q,
    terms[4] + q,
    next + p,
    next - p,
  ]);
};

const sumOfPrevious: Generator = (rng) => {
  const x = rng.int(1, 6);
  const y = rng.int(1, 6);
  const terms = [x, y];
  for (let i = 2; i < 7; i += 1) terms.push(terms[i - 1] + terms[i - 2]);
  const next = terms[6];
  return numberPattern(rng, terms.slice(0, 6), next, 'Setiap suku merupakan jumlah dua suku sebelumnya.', [terms[5] + terms[3], terms[5] * 2, next + terms[0], next - 1]);
};

const squarePlus: Generator = (rng) => {
  const shift = rng.int(-2, 5);
  const terms = Array.from({ length: 6 }, (_, i) => (i + 1) ** 2 + shift);
  const next = 49 + shift;
  return numberPattern(rng, terms, next, `Suku ke-n sama dengan n kuadrat ${shift >= 0 ? `ditambah ${shift}` : `dikurangi ${-shift}`}; suku ke-7 adalah 49 ${shift >= 0 ? `+ ${shift}` : `- ${-shift}`}.`, [
    next + 2,
    next - 2,
    terms[5] + 11,
    terms[5] + 15,
  ]);
};

const doubleAndAdd: Generator = (rng) => {
  const first = rng.int(1, 5);
  const add = rng.int(1, 4);
  const terms = [first];
  for (let i = 0; i < 5; i += 1) terms.push(terms[i] * 2 + add);
  const shown = terms.slice(0, 5);
  const next = terms[5];
  return numberPattern(rng, shown, next, `Setiap suku diperoleh dengan mengalikan suku sebelumnya dengan 2 lalu menambahkan ${add}.`, [shown[4] * 2, shown[4] * 2 + add + 1, shown[4] * 2 - add, next + add]);
};

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

const letterPattern: Generator = (rng) => {
  const step = rng.int(1, 4);
  const start = rng.int(0, 25 - step * 5);
  const letters = Array.from({ length: 6 }, (_, i) => LETTERS[start + step * i]);
  const next = letters[5];
  const shown = letters.slice(0, 5);
  const nextIndex = start + step * 5;
  const wrong = [1, -1, 2, -2, 3, -3].map((offset) => LETTERS[nextIndex + offset]).filter((letter): letter is string => letter !== undefined);
  const { options, answer } = buildChoices(rng, next, wrong);
  return {
    subtest: SUBTEST,
    ...INDUCTIVE,
    stem: `Perhatikan pola huruf berikut.\n${shown.join(', ')}, ...\nHuruf yang tepat untuk melanjutkan pola tersebut adalah ...`,
    options,
    answer,
    explanation: `Urutan huruf bergeser ${step} huruf setiap kali. Setelah ${shown[4]} datanglah ${next}.`,
  };
};

const TAXONOMY: ReadonlyArray<readonly [string, string, string, string]> = [
  ['kucing', 'mamalia', 'hewan bertulang belakang', 'burung'],
  ['mawar', 'tumbuhan berbunga', 'tumbuhan', 'batu'],
  ['sedan', 'mobil', 'kendaraan bermotor', 'sepeda'],
  ['harimau', 'hewan buas', 'makhluk hidup', 'tanaman hias'],
  ['guru', 'pegawai', 'warga negara', 'robot'],
  ['laptop', 'perangkat elektronik', 'benda buatan manusia', 'tumbuhan'],
  ['apel', 'buah', 'tumbuhan', 'logam'],
  ['gitar', 'alat musik', 'benda bersuara', 'alat tulis'],
];

const universalSyllogism: Generator = (rng) => {
  const [a, b, c] = rng.pick(TAXONOMY);
  const correct = `Semua ${a} adalah ${c}.`;
  const { options, answer } = buildChoices(rng, correct, [
    `Semua ${c} adalah ${a}.`,
    `Tidak ada ${a} yang ${c}.`,
    `Sebagian ${a} bukan ${c}.`,
    `Semua ${b} adalah ${a}.`,
    `Tidak ada ${c} yang ${b}.`,
  ]);
  return {
    subtest: SUBTEST,
    ...DEDUCTIVE,
    stem: `Semua ${a} adalah ${b}.\nSemua ${b} adalah ${c}.\nKesimpulan yang pasti benar tentang ${a} dan ${c} adalah ...`,
    options,
    answer,
    explanation: `Karena ${a} termasuk ${b} dan ${b} termasuk ${c}, maka ${a} pasti termasuk ${c}. Kebalikannya (semua ${c} adalah ${a}) tidak dijamin oleh kedua premis.`,
  };
};

const negativeSyllogism: Generator = (rng) => {
  const [a, b, , other] = rng.pick(TAXONOMY);
  const correct = `Tidak ada ${a} yang ${other}.`;
  const { options, answer } = buildChoices(rng, correct, [
    `Semua ${a} adalah ${other}.`,
    `Sebagian ${a} adalah ${other}.`,
    `Semua ${other} adalah ${a}.`,
    `Sebagian ${other} adalah ${a}.`,
    `Semua ${a} bukan ${b}.`,
  ]);
  return {
    subtest: SUBTEST,
    ...DEDUCTIVE,
    stem: `Semua ${a} adalah ${b}.\nTidak ada ${b} yang ${other}.\nKesimpulan yang pasti benar tentang ${a} dan ${other} adalah ...`,
    options,
    answer,
    explanation: `${capitalize(a)} termasuk ${b}, dan tidak satu pun ${b} termasuk ${other}. Maka tidak ada ${a} yang ${other}.`,
  };
};

export interface Clause {
  yes: string;
  no: string;
}

export const CLAUSES: readonly Clause[] = [
  { yes: 'hujan turun', no: 'hujan tidak turun' },
  { yes: 'jalan menjadi basah', no: 'jalan tidak menjadi basah' },
  { yes: 'Dina rajin belajar', no: 'Dina tidak rajin belajar' },
  { yes: 'Dina lulus ujian', no: 'Dina tidak lulus ujian' },
  { yes: 'baterai ponsel habis', no: 'baterai ponsel tidak habis' },
  { yes: 'ponsel mati', no: 'ponsel tidak mati' },
  { yes: 'lampu lalu lintas menyala merah', no: 'lampu lalu lintas tidak menyala merah' },
  { yes: 'kendaraan berhenti', no: 'kendaraan tidak berhenti' },
  { yes: 'sinyal internet kuat', no: 'sinyal internet tidak kuat' },
  { yes: 'video berjalan lancar', no: 'video tidak berjalan lancar' },
  { yes: 'harga tiket naik', no: 'harga tiket tidak naik' },
  { yes: 'jumlah penumpang berkurang', no: 'jumlah penumpang tidak berkurang' },
];

const clausePair = (rng: Rng): [Clause, Clause] => {
  const index = rng.int(0, CLAUSES.length / 2 - 1) * 2;
  return [CLAUSES[index], CLAUSES[index + 1]];
};

const noConclusion = (subject: string) => `Tidak dapat ditarik kesimpulan tentang ${subject}.`;

const conditionalItem = (rng: Rng, premises: string[], correct: string, wrong: string[], explanation: string): ItemDraft => {
  const { options, answer } = buildChoices(rng, correct, wrong);
  return {
    subtest: SUBTEST,
    ...DEDUCTIVE,
    stem: `${premises.join('\n')}\nKesimpulan yang pasti benar adalah ...`,
    options,
    answer,
    explanation,
  };
};

const modusPonens: Generator = (rng) => {
  const [p, q] = clausePair(rng);
  return conditionalItem(
    rng,
    [`Jika ${p.yes}, maka ${q.yes}.`, `${capitalize(p.yes)}.`],
    `${capitalize(q.yes)}.`,
    [`${capitalize(q.no)}.`, `${capitalize(p.no)}.`, noConclusion(q.yes), `${capitalize(p.no)} dan ${q.yes}.`, `${capitalize(p.yes)} dan ${q.no}.`],
    `Syarat terpenuhi (${p.yes}), sehingga akibatnya pasti terjadi: ${q.yes}.`,
  );
};

const modusTollens: Generator = (rng) => {
  const [p, q] = clausePair(rng);
  return conditionalItem(
    rng,
    [`Jika ${p.yes}, maka ${q.yes}.`, `${capitalize(q.no)}.`],
    `${capitalize(p.no)}.`,
    [`${capitalize(p.yes)}.`, `${capitalize(q.yes)}.`, noConclusion(p.yes), `Jika ${q.no}, maka ${p.yes}.`, `${capitalize(p.yes)} atau ${q.yes}.`],
    `Akibatnya tidak terjadi (${q.no}). Karena syarat selalu diikuti akibat, syaratnya pasti tidak terpenuhi: ${p.no}.`,
  );
};

const affirmingConsequent: Generator = (rng) => {
  const [p, q] = clausePair(rng);
  return conditionalItem(
    rng,
    [`Jika ${p.yes}, maka ${q.yes}.`, `${capitalize(q.yes)}.`],
    noConclusion(p.yes),
    [`${capitalize(p.yes)}.`, `${capitalize(p.no)}.`, `${capitalize(q.no)}.`, `Jika ${q.yes}, maka ${p.yes}.`, `Jika ${p.no}, maka ${q.no}.`],
    `Akibat boleh saja muncul karena sebab lain. Dari "${q.yes}" kita tidak dapat memastikan bahwa ${p.yes}.`,
  );
};

const denyingAntecedent: Generator = (rng) => {
  const [p, q] = clausePair(rng);
  return conditionalItem(
    rng,
    [`Jika ${p.yes}, maka ${q.yes}.`, `${capitalize(p.no)}.`],
    noConclusion(q.yes),
    [`${capitalize(q.no)}.`, `${capitalize(q.yes)}.`, `${capitalize(p.yes)}.`, `Jika ${p.no}, maka ${q.no}.`, `${capitalize(p.no)} dan ${q.no}.`],
    `Premis hanya menjamin akibat bila syaratnya terpenuhi. Ketika syarat tidak terpenuhi, ${q.yes} masih mungkin terjadi atau tidak.`,
  );
};

export const CHAINS: ReadonlyArray<readonly [Clause, Clause, Clause]> = [
  [
    { yes: 'hujan deras turun', no: 'hujan deras tidak turun' },
    { yes: 'sungai meluap', no: 'sungai tidak meluap' },
    { yes: 'permukiman tergenang', no: 'permukiman tidak tergenang' },
  ],
  [
    { yes: 'Rudi berlatih setiap hari', no: 'Rudi tidak berlatih setiap hari' },
    { yes: 'kemampuan Rudi meningkat', no: 'kemampuan Rudi tidak meningkat' },
    { yes: 'Rudi lolos seleksi tim', no: 'Rudi tidak lolos seleksi tim' },
  ],
  [
    { yes: 'harga bahan bakar naik', no: 'harga bahan bakar tidak naik' },
    { yes: 'biaya angkutan naik', no: 'biaya angkutan tidak naik' },
    { yes: 'harga sayuran naik', no: 'harga sayuran tidak naik' },
  ],
  [
    { yes: 'produksi pabrik meningkat', no: 'produksi pabrik tidak meningkat' },
    { yes: 'persediaan barang bertambah', no: 'persediaan barang tidak bertambah' },
    { yes: 'harga barang turun', no: 'harga barang tidak turun' },
  ],
];

const conditionalChain: Generator = (rng) => {
  const [p, q, r] = rng.pick(CHAINS);
  return conditionalItem(
    rng,
    [`Jika ${p.yes}, maka ${q.yes}.`, `Jika ${q.yes}, maka ${r.yes}.`, `${capitalize(p.yes)}.`],
    `${capitalize(r.yes)}.`,
    [`${capitalize(r.no)}.`, `${capitalize(q.no)}.`, noConclusion(r.yes), `${capitalize(p.no)}.`, `${capitalize(q.no)} dan ${r.yes}.`],
    `${capitalize(p.yes)} sehingga ${q.yes}; karena ${q.yes} maka ${r.yes}.`,
  );
};

const PEOPLE = ['Ani', 'Budi', 'Citra', 'Dedi', 'Eka', 'Fajar', 'Gita', 'Hadi'];

const rankingPuzzle: Generator = (rng) => {
  const size = rng.int(4, 5);
  const people = rng.sample(PEOPLE, size);
  const order = rng.shuffle(people);
  const clues = rng.shuffle(order.slice(0, -1).map((person, i) => `${person} lebih tinggi daripada ${order[i + 1]}.`));
  const asksTallest = rng.chance(0.5);
  const position = asksTallest ? 0 : size - 1;
  const correct = order[position];
  const { options, answer } = buildChoices(rng, correct, [...people.filter((person) => person !== correct), 'Tidak dapat ditentukan']);
  return {
    subtest: SUBTEST,
    ...DEDUCTIVE,
    stem: `${size} orang, yaitu ${people.join(', ')}, berdiri berjajar. Diketahui:\n${clues.join('\n')}\nSiapakah yang ${asksTallest ? 'paling tinggi' : 'paling pendek'}?`,
    options,
    answer,
    explanation: `Susun dari yang tertinggi: ${order.join(' > ')}. ${correct} berada di ${asksTallest ? 'urutan pertama' : 'urutan terakhir'}.`,
  };
};

const discount: Generator = (rng) => {
  const price = rng.int(4, 40) * 25_000;
  const percent = rng.pick([10, 15, 20, 25, 30, 40]);
  const final = (price * (100 - percent)) / 100;
  const { options, answer } = numericChoices(rng, final, [price - percent * 1000, price * (percent / 100), price + (price * percent) / 100, final + 10_000], (v) => `Rp${formatNumber(Math.round(v))}`);
  return {
    subtest: SUBTEST,
    ...QUANTITATIVE,
    stem: `Sebuah tas berharga Rp${formatNumber(price)} dijual dengan diskon ${percent}%. Harga yang harus dibayar adalah ...`,
    options,
    answer,
    explanation: `Diskon ${percent}% berarti membayar ${100 - percent}%. Rp${formatNumber(price)} × ${100 - percent}/100 = Rp${formatNumber(final)}.`,
  };
};

const ratioShare: Generator = (rng) => {
  const m = rng.int(1, 5);
  const n = rng.int(2, 7);
  if (m === n) throw new Retryable('retry');
  const unit = rng.int(2, 12);
  const total = (m + n) * unit;
  const a = m * unit;
  const { options, answer } = numericChoices(rng, a, [n * unit, total / 2, total - m, m * (unit + 1)]);
  return {
    subtest: SUBTEST,
    ...QUANTITATIVE,
    stem: `Uang Rani dan Sinta berbanding ${m} : ${n}. Jika jumlah uang mereka Rp${formatNumber(total * 1000)}, uang Rani adalah ...`,
    options: options.map((option) => `Rp${option}.000`),
    answer,
    explanation: `Jumlah perbandingan ${m + n}. Uang Rani = ${m}/${m + n} × Rp${formatNumber(total * 1000)} = Rp${formatNumber(a * 1000)}.`,
  };
};

const averageNeeded: Generator = (rng) => {
  const count = rng.int(4, 6);
  const mean = rng.int(70, 85);
  const target = mean + rng.int(1, 4);
  const needed = target * (count + 1) - mean * count;
  const { options, answer } = numericChoices(rng, needed, [target, mean + 5, needed - 5, needed + 5, 100]);
  return {
    subtest: SUBTEST,
    ...QUANTITATIVE,
    stem: `Rata-rata nilai ${count} ujian Wati adalah ${mean}. Agar rata-rata setelah ujian berikutnya menjadi ${target}, nilai ujian berikutnya harus ...`,
    options,
    answer,
    explanation: `Jumlah ${count + 1} nilai agar rata-ratanya ${target} adalah ${target * (count + 1)}. Jumlah ${count} nilai sebelumnya ${mean * count}. Selisihnya ${needed}.`,
  };
};

const travelTime: Generator = (rng) => {
  const speed = rng.pick([40, 45, 48, 54, 60, 72, 80]);
  const hours = rng.pick([1.5, 2, 2.5, 3, 4]);
  const distance = speed * hours;
  const minutes = Math.round(hours * 60);
  const { options, answer } = numericChoices(rng, distance, [speed * Math.ceil(hours), speed + hours, (speed * minutes) / 100, distance + speed]);
  return {
    subtest: SUBTEST,
    ...QUANTITATIVE,
    stem: `Sebuah bus melaju dengan kecepatan tetap ${speed} km/jam selama ${minutes} menit. Jarak yang ditempuh bus adalah ... km.`,
    options,
    answer,
    explanation: `${minutes} menit = ${formatNumber(hours)} jam. Jarak = kecepatan × waktu = ${speed} × ${formatNumber(hours)} = ${formatNumber(distance)} km.`,
  };
};

const WORK_PAIRS: ReadonlyArray<readonly [number, number, number]> = [
  [6, 3, 2],
  [12, 6, 4],
  [10, 15, 6],
  [20, 5, 4],
  [30, 15, 10],
  [12, 4, 3],
  [24, 8, 6],
  [60, 20, 15],
];

const workTogether: Generator = (rng) => {
  const [a, b, together] = rng.pick(WORK_PAIRS);
  const { options, answer } = numericChoices(rng, together, [(a + b) / 2, a + b, Math.abs(a - b), a]);
  return {
    subtest: SUBTEST,
    ...QUANTITATIVE,
    stem: `Pak Anto dapat menyelesaikan sebuah pekerjaan dalam ${a} jam, sedangkan Pak Beni dalam ${b} jam. Jika keduanya bekerja bersama dengan laju tetap, pekerjaan selesai dalam ... jam.`,
    options,
    answer,
    explanation: `Laju gabungan = 1/${a} + 1/${b} = ${fraction(a + b, a * b)} pekerjaan per jam, sehingga waktu bersama = ${together} jam.`,
  };
};

const ageProblem: Generator = (rng) => {
  const child = rng.int(5, 15);
  const multiple = rng.int(2, 4);
  const sum = child * (multiple + 1);
  const { options, answer } = numericChoices(rng, child, [sum / 2, sum - child, child * multiple, child + multiple]);
  return {
    subtest: SUBTEST,
    ...QUANTITATIVE,
    stem: `Umur seorang ayah ${multiple} kali umur anaknya. Jumlah umur keduanya ${sum} tahun. Umur anak tersebut adalah ... tahun.`,
    options,
    answer,
    explanation: `Misalkan umur anak x. Maka x + ${multiple}x = ${sum}, sehingga ${multiple + 1}x = ${sum} dan x = ${child}.`,
  };
};

const SECTION_MAKERS: Record<'induktif' | 'deduktif' | 'kuantitatif', readonly Generator[]> = {
  induktif: [arithmetic, geometric, growingDifference, alternating, sumOfPrevious, squarePlus, doubleAndAdd, letterPattern],
  deduktif: [universalSyllogism, negativeSyllogism, modusPonens, modusTollens, affirmingConsequent, denyingAntecedent, conditionalChain, rankingPuzzle],
  kuantitatif: [discount, ratioShare, averageNeeded, travelTime, workTogether, ageProblem],
};

export const generatePenalaranUmum = (rng: Rng, count: number): ItemDraft[] => {
  const third = Math.floor(count / 3);
  const counts = { induktif: third, deduktif: third, kuantitatif: third };
  const order = ['induktif', 'deduktif', 'kuantitatif'] as const;
  for (let i = 0; i < count - third * 3; i += 1) counts[order[i]] += 1;
  return order.flatMap((section) => (counts[section] > 0 ? generateMany(rng, counts[section], SECTION_MAKERS[section]) : []));
};
