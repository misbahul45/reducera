import { Rng } from '../rng';
import { ItemDraft } from '../tryout-types';
import { Generator, Retryable, buildChoices, formatNumber, generateMany, numericChoices, rupiah } from './support';

const SUBTEST = 'penalaran-matematika' as const;
const FORMULATE = { section: 'Merumuskan strategi', conceptId: 'utbk-pm-merumuskan' } as const;
const USE = { section: 'Menggunakan dan menafsirkan', conceptId: 'utbk-pm-menggunakan-menafsirkan' } as const;

const money = (value: number) => rupiah(value);

const taxiFormula: Generator = (rng) => {
  const base = rng.pick([6000, 8000, 10000, 12000]);
  const perKm = rng.pick([2500, 3000, 3500, 4000, 4500]);
  const correct = `${formatNumber(base)} + ${formatNumber(perKm)}x`;
  const { options, answer } = buildChoices(rng, correct, [
    `${formatNumber(base)}x + ${formatNumber(perKm)}`,
    `(${formatNumber(base)} + ${formatNumber(perKm)})x`,
    `${formatNumber(base)} − ${formatNumber(perKm)}x`,
    `${formatNumber(perKm)} + ${formatNumber(base)}x`,
    `${formatNumber(base + perKm)} + x`,
  ]);
  return {
    subtest: SUBTEST,
    ...FORMULATE,
    stem: `Sebuah layanan taksi daring menetapkan tarif buka ${money(base)} ditambah ${money(perKm)} untuk setiap kilometer. Jika x adalah jarak tempuh dalam kilometer, biaya perjalanan (dalam rupiah) dapat dirumuskan sebagai ...`,
    options,
    answer,
    explanation: `Tarif buka dibayar sekali (${formatNumber(base)}), sedangkan tarif per kilometer dikali jarak (${formatNumber(perKm)}x). Biaya = ${correct}.`,
  };
};

const recipeScaling: Generator = (rng) => {
  const portions = rng.pick([4, 5, 6, 8]);
  const perPortion = rng.pick([25, 30, 40, 50]);
  const flour = portions * perPortion;
  const target = rng.int(2, 6) * portions + rng.pick([0, portions / 2]);
  if (!Number.isInteger(target)) throw new Retryable('retry');
  const needed = perPortion * target;
  const { options, answer } = numericChoices(rng, needed, [flour + target, flour * target, (flour / target) * portions, needed + perPortion, needed - perPortion], (v) => `${formatNumber(Math.round(v))} gram`);
  return {
    subtest: SUBTEST,
    ...FORMULATE,
    stem: `Resep kue untuk ${portions} porsi memerlukan ${flour} gram tepung. Untuk membuat ${target} porsi dengan resep yang sama, tepung yang diperlukan adalah ...`,
    options,
    answer,
    explanation: `Tepung per porsi = ${flour} ÷ ${portions} = ${perPortion} gram. Untuk ${target} porsi: ${perPortion} × ${target} = ${needed} gram.`,
  };
};

const savingsGoal: Generator = (rng) => {
  const have = rng.int(2, 10) * 50_000;
  const weekly = rng.pick([40_000, 60_000, 75_000, 80_000]);
  const target = have + weekly * rng.int(5, 12) + rng.pick([10_000, 20_000, 30_000]);
  const weeks = Math.ceil((target - have) / weekly);
  const { options, answer } = numericChoices(rng, weeks, [Math.floor((target - have) / weekly), Math.round(target / weekly), weeks + 2, Math.ceil(target / weekly)], (v) => `${formatNumber(v)} minggu`);
  return {
    subtest: SUBTEST,
    ...FORMULATE,
    stem: `Rina memiliki tabungan ${money(have)} dan menabung ${money(weekly)} setiap akhir pekan. Ia ingin membeli sepeda seharga ${money(target)}. Paling sedikit berapa minggu ia harus menabung agar uangnya cukup?`,
    options,
    answer,
    explanation: `Kekurangan uang = ${money(target)} − ${money(have)} = ${money(target - have)}. ${formatNumber(target - have)} ÷ ${formatNumber(weekly)} = ${((target - have) / weekly).toFixed(2).replace('.', ',')}, dibulatkan ke atas menjadi ${weeks} minggu karena uang harus cukup.`,
  };
};

const workerDays: Generator = (rng) => {
  const workers = rng.pick([6, 8, 10, 12, 15]);
  const days = rng.pick([6, 8, 9, 10, 12, 15, 18]);
  const more = rng.pick([2, 3, 4, 5, 6]);
  const total = workers * days;
  const newWorkers = workers + more;
  if (total % newWorkers !== 0) throw new Retryable('retry');
  const result = total / newWorkers;
  const { options, answer } = numericChoices(rng, result, [days + more, days - more, days * more, Math.round((days * newWorkers) / workers)], (v) => `${formatNumber(v)} hari`);
  return {
    subtest: SUBTEST,
    ...FORMULATE,
    stem: `${workers} pekerja dapat menyelesaikan pembangunan sebuah pos jaga dalam ${days} hari. Jika pekerja ditambah ${more} orang dan semua bekerja dengan kemampuan yang sama, pembangunan akan selesai dalam ...`,
    options,
    answer,
    explanation: `Pekerjaan setara ${workers} × ${days} = ${total} hari-orang. Dengan ${newWorkers} pekerja: ${total} ÷ ${newWorkers} = ${result} hari.`,
  };
};

const priceComparison: Generator = (rng) => {
  const planFee = rng.pick([30_000, 40_000, 50_000]);
  const planPerGb = rng.pick([4_000, 5_000, 6_000]);
  const flat = rng.pick([80_000, 90_000, 100_000]);
  const usage = rng.int(5, 20);
  const planCost = planFee + planPerGb * usage;
  const aCheaper = planCost < flat;
  if (planCost === flat) throw new Retryable('retry');
  const difference = Math.abs(planCost - flat);
  const correct = `Paket ${aCheaper ? 'A' : 'B'} lebih murah ${money(difference)}.`;
  const { options, answer } = buildChoices(rng, correct, [
    `Paket ${aCheaper ? 'B' : 'A'} lebih murah ${money(difference)}.`,
    `Paket ${aCheaper ? 'A' : 'B'} lebih murah ${money(difference + planPerGb)}.`,
    `Paket ${aCheaper ? 'B' : 'A'} lebih murah ${money(Math.abs(planCost - flat - planFee))}.`,
    `Kedua paket sama murah.`,
    `Paket ${aCheaper ? 'A' : 'B'} lebih murah ${money(Math.max(1000, difference - planPerGb))}.`,
  ]);
  return {
    subtest: SUBTEST,
    ...USE,
    stem: `Dua paket internet ditawarkan.\nPaket A: biaya tetap ${money(planFee)} per bulan ditambah ${money(planPerGb)} per GB yang dipakai.\nPaket B: ${money(flat)} per bulan berapa pun pemakaiannya.\nJika dalam sebulan Dino memakai ${usage} GB, pernyataan yang benar adalah ...`,
    options,
    answer,
    explanation: `Paket A: ${money(planFee)} + ${usage} × ${money(planPerGb)} = ${money(planCost)}. Paket B: ${money(flat)}. ${correct}`,
  };
};

const DAYS = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

const salesTable: Generator = (rng) => {
  const count = rng.int(5, 6);
  const sales = Array.from({ length: count }, () => rng.int(8, 40) * 5);
  const days = DAYS.slice(0, count);
  const table = days.map((day, i) => `${day} | ${sales[i]}`).join('\n');
  const total = sales.reduce((sum, value) => sum + value, 0);
  const kind = rng.int(0, 3);
  const header = `Penjualan roti sebuah toko selama ${count} hari (dalam buah):\nHari | Terjual\n${table}\n`;
  if (kind === 0) {
    const { options, answer } = numericChoices(rng, total, [total - sales[0], Math.round(total / count), Math.max(...sales), total + 5, total + 10]);
    return { subtest: SUBTEST, ...USE, stem: `${header}Jumlah roti yang terjual selama ${count} hari adalah ...`, options, answer, explanation: `Jumlahkan seluruh data: ${sales.join(' + ')} = ${total}.` };
  }
  if (kind === 1) {
    if (total % count !== 0) throw new Retryable('retry');
    const mean = total / count;
    const { options, answer } = numericChoices(rng, mean, [total, Math.max(...sales), Math.min(...sales), mean + 5, mean - 5]);
    return { subtest: SUBTEST, ...USE, stem: `${header}Rata-rata roti yang terjual per hari adalah ...`, options, answer, explanation: `${total} ÷ ${count} = ${mean}.` };
  }
  if (kind === 2) {
    const max = Math.max(...sales);
    if (sales.filter((value) => value === max).length > 1) throw new Retryable('retry');
    const correct = days[sales.indexOf(max)];
    const { options, answer } = buildChoices(rng, correct, days.filter((day) => day !== correct));
    return { subtest: SUBTEST, ...USE, stem: `${header}Penjualan tertinggi terjadi pada hari ...`, options, answer, explanation: `Nilai terbesar adalah ${max}, yaitu pada hari ${correct}.` };
  }
  const max = Math.max(...sales);
  const min = Math.min(...sales);
  const { options, answer } = numericChoices(rng, max - min, [max, min, max + min, Math.round(total / count), max - min + 5]);
  return { subtest: SUBTEST, ...USE, stem: `${header}Selisih penjualan tertinggi dan terendah adalah ...`, options, answer, explanation: `${max} − ${min} = ${max - min}.` };
};

const mapScale: Generator = (rng) => {
  const scale = rng.pick([100_000, 200_000, 250_000, 500_000, 1_000_000]);
  const centimetres = rng.pick([2, 3, 4, 5, 6, 8]);
  const kilometres = (centimetres * scale) / 100_000;
  const { options, answer } = numericChoices(rng, kilometres, [centimetres * scale / 1000, centimetres * scale / 10_000, centimetres * scale, kilometres + centimetres], (v) => `${formatNumber(v)} km`);
  return {
    subtest: SUBTEST,
    ...USE,
    stem: `Pada peta berskala 1 : ${formatNumber(scale)}, jarak antara kota P dan kota Q adalah ${centimetres} cm. Jarak sebenarnya kedua kota adalah ...`,
    options,
    answer,
    explanation: `Jarak sebenarnya = ${centimetres} × ${formatNumber(scale)} cm = ${formatNumber(centimetres * scale)} cm = ${formatNumber(kilometres)} km (1 km = 100.000 cm).`,
  };
};

const simpleInterest: Generator = (rng) => {
  const principal = rng.int(2, 20) * 500_000;
  const rate = rng.pick([4, 5, 6, 8, 10]);
  const years = rng.pick([1, 2, 3]);
  const interest = (principal * rate * years) / 100;
  const total = principal + interest;
  const { options, answer } = numericChoices(rng, total, [interest, principal + interest / years, principal * (1 + rate / 100) ** years, principal + interest * 2], (v) => money(Math.round(v)));
  return {
    subtest: SUBTEST,
    ...USE,
    stem: `Bu Sari menabung ${money(principal)} di sebuah bank dengan bunga tunggal ${rate}% per tahun. Setelah ${years} tahun, jumlah tabungannya adalah ...`,
    options,
    answer,
    explanation: `Bunga = ${money(principal)} × ${rate}% × ${years} = ${money(interest)}. Tabungan = ${money(principal)} + ${money(interest)} = ${money(total)}.`,
  };
};

const speedConversion: Generator = (rng) => {
  const kmh = rng.pick([18, 36, 54, 72, 90, 108]);
  const ms = (kmh * 5) / 18;
  const { options, answer } = numericChoices(rng, ms, [kmh / 3.6 + 2, kmh * 3.6 > 400 ? kmh * 2 : Math.round(kmh * 3.6), kmh / 10, ms + 5, ms - 3], (v) => `${formatNumber(Math.round(v * 10) / 10)} m/s`);
  return {
    subtest: SUBTEST,
    ...USE,
    stem: `Sebuah sepeda motor melaju dengan kecepatan ${kmh} km/jam. Kecepatan tersebut sama dengan ...`,
    options,
    answer,
    explanation: `1 km/jam = 1000 m ÷ 3600 s = 5/18 m/s. Maka ${kmh} × 5/18 = ${ms} m/s.`,
  };
};

const profitPercent: Generator = (rng) => {
  const cost = rng.pick([40_000, 50_000, 80_000, 100_000, 120_000, 200_000]);
  const percent = rng.pick([10, 15, 20, 25, 30]);
  const sell = cost + (cost * percent) / 100;
  const { options, answer } = numericChoices(rng, percent, [(sell - cost) / 1000, percent * 2, percent / 2, 100 - percent, percent + 5], (v) => `${formatNumber(v)}%`);
  return {
    subtest: SUBTEST,
    ...USE,
    stem: `Seorang pedagang membeli sepatu seharga ${money(cost)} dan menjualnya seharga ${money(sell)}. Persentase keuntungan terhadap harga beli adalah ...`,
    options,
    answer,
    explanation: `Untung = ${money(sell)} − ${money(cost)} = ${money(sell - cost)}. Persentase = ${formatNumber(sell - cost)} ÷ ${formatNumber(cost)} × 100% = ${percent}%.`,
  };
};

const MAKERS = {
  formulate: [taxiFormula, recipeScaling, savingsGoal, workerDays],
  use: [priceComparison, salesTable, mapScale, simpleInterest, speedConversion, profitPercent],
} as const;

export const generatePenalaranMatematika = (rng: Rng, count: number): ItemDraft[] => {
  const formulate = Math.floor(count / 2);
  const use = count - formulate;
  return [
    ...(formulate > 0 ? generateMany(rng, formulate, MAKERS.formulate) : []),
    ...(use > 0 ? generateMany(rng, use, MAKERS.use) : []),
  ];
};
