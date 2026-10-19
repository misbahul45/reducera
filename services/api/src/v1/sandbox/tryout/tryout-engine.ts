import { generatePenalaranMatematika } from './generators/penalaran-matematika';
import { generatePenalaranUmum } from './generators/penalaran-umum';
import { generatePengetahuanKuantitatif } from './generators/pengetahuan-kuantitatif';
import { generateLiteracy, generatePbm, generatePpu, literacyCapacity, pbmCapacity, ppuCapacity } from './generators/verbal';
import { createRng, deriveSeed } from './rng';
import { TryoutBank } from './tryout-bank';
import { ItemDraft, PlanEntry, SUBTEST_KEYS, SubtestInfo, SubtestKey, TryoutItem, TryoutPlan } from './tryout-types';

export const UTBK_EXAM_KEY = 'utbk-snbt';
export const MAX_ITEMS_PER_SESSION = 160;
export const SEED_LIMIT = 2_000_000_000;

interface SubtestDefinition {
  title: string;
  component: 'TPS' | 'LITERASI';
  officialCount: number;
  officialSeconds: number;
  description: string;
  conceptIds: string[];
}

const DEFINITIONS: Record<SubtestKey, SubtestDefinition> = {
  'penalaran-umum': {
    title: 'Penalaran Umum',
    component: 'TPS',
    officialCount: 30,
    officialSeconds: 30 * 60,
    description: 'Penalaran induktif, deduktif, dan kuantitatif: pola, silogisme, urutan, serta soal cerita berhitung.',
    conceptIds: ['utbk-penalaran-induktif', 'utbk-penalaran-deduktif', 'utbk-penalaran-kuantitatif'],
  },
  ppu: {
    title: 'Pengetahuan dan Pemahaman Umum',
    component: 'TPS',
    officialCount: 20,
    officialSeconds: 15 * 60,
    description: 'Makna kata, hubungan antarmakna, ungkapan, dan imbuhan.',
    conceptIds: ['utbk-leksikal'],
  },
  pbm: {
    title: 'Pemahaman Bacaan dan Menulis',
    component: 'TPS',
    officialCount: 20,
    officialSeconds: 25 * 60,
    description: 'Ejaan dan kata baku, kalimat efektif, penataan gagasan, dan pemilihan gagasan.',
    conceptIds: ['utbk-pbm-pemilihan-gagasan', 'utbk-pbm-penataan-gagasan', 'utbk-pbm-perbaikan-gagasan'],
  },
  'pengetahuan-kuantitatif': {
    title: 'Pengetahuan Kuantitatif',
    component: 'TPS',
    officialCount: 20,
    officialSeconds: 20 * 60,
    description: 'Bilangan dan aljabar, geometri dan pengukuran, serta data dan peluang.',
    conceptIds: ['utbk-pk-bilangan-aljabar', 'utbk-pk-geometri-pengukuran', 'utbk-pk-data-peluang'],
  },
  'literasi-indonesia': {
    title: 'Literasi dalam Bahasa Indonesia',
    component: 'LITERASI',
    officialCount: 30,
    officialSeconds: 2550,
    description: 'Memahami, menilai, dan merefleksikan bacaan berbahasa Indonesia.',
    conceptIds: ['utbk-literasi-menemukan-memahami', 'utbk-literasi-menilai-merefleksi'],
  },
  'literasi-inggris': {
    title: 'Literasi dalam Bahasa Inggris',
    component: 'LITERASI',
    officialCount: 20,
    officialSeconds: 20 * 60,
    description: 'Memahami gagasan utama dan menyimpulkan isi bacaan berbahasa Inggris.',
    conceptIds: ['utbk-english-main-idea', 'utbk-english-inference'],
  },
  'penalaran-matematika': {
    title: 'Penalaran Matematika',
    component: 'LITERASI',
    officialCount: 20,
    officialSeconds: 2550,
    description: 'Merumuskan strategi serta menggunakan dan menafsirkan matematika dalam konteks sehari-hari.',
    conceptIds: ['utbk-pm-merumuskan', 'utbk-pm-menggunakan-menafsirkan'],
  },
};

export interface Preset {
  id: string;
  title: string;
  description: string;
  subtests: PlanEntry[];
  itemCount: number;
  durationSeconds: number;
}

export class TryoutEngine {
  constructor(private readonly bank: TryoutBank) {}

  private capacity(key: SubtestKey): number {
    switch (key) {
      case 'ppu':
        return ppuCapacity(this.bank);
      case 'pbm':
        return pbmCapacity(this.bank);
      case 'literasi-indonesia':
      case 'literasi-inggris':
        return literacyCapacity(this.bank, key);
      default:
        return DEFINITIONS[key].officialCount;
    }
  }

  subtests(): SubtestInfo[] {
    return SUBTEST_KEYS.map((key) => {
      const definition = DEFINITIONS[key];
      return {
        key,
        title: definition.title,
        component: definition.component,
        officialCount: definition.officialCount,
        officialSeconds: definition.officialSeconds,
        secondsPerItem: definition.officialSeconds / definition.officialCount,
        maxCount: Math.min(definition.officialCount, this.capacity(key)),
        description: definition.description,
        conceptIds: definition.conceptIds,
      };
    });
  }

  info(key: SubtestKey): SubtestInfo {
    return this.subtests().find((subtest) => subtest.key === key) as SubtestInfo;
  }

  durationSeconds(entries: readonly PlanEntry[]): number {
    return entries.reduce((sum, entry) => sum + Math.ceil(entry.count * this.info(entry.key).secondsPerItem), 0);
  }

  presets(): Preset[] {
    const maxOf = (key: SubtestKey) => this.info(key).maxCount;
    const build = (id: string, title: string, description: string, subtests: PlanEntry[]): Preset => ({
      id,
      title,
      description,
      subtests,
      itemCount: subtests.reduce((sum, entry) => sum + entry.count, 0),
      durationSeconds: this.durationSeconds(subtests),
    });
    return [
      build(
        'singkat',
        'Sesi singkat',
        'Lima soal dari setiap subtes untuk memanaskan diri dan melihat gambaran kemampuan.',
        SUBTEST_KEYS.map((key) => ({ key, count: Math.min(5, maxOf(key)) })),
      ),
      build(
        'tps',
        'Tes Potensi Skolastik',
        'Empat subtes TPS dengan jumlah soal dan waktu mengikuti kerangka resmi: 90 soal dalam 90 menit.',
        (['penalaran-umum', 'ppu', 'pbm', 'pengetahuan-kuantitatif'] as const).map((key) => ({ key, count: maxOf(key) })),
      ),
      build(
        'literasi',
        'Tes Literasi',
        'Tiga subtes literasi. Jumlah soal bacaan mengikuti bank soal yang tersedia dan dapat lebih sedikit daripada tes resmi.',
        (['literasi-indonesia', 'literasi-inggris', 'penalaran-matematika'] as const).map((key) => ({ key, count: maxOf(key) })),
      ),
    ];
  }

  validate(plan: TryoutPlan): string | null {
    if (plan.examKey !== UTBK_EXAM_KEY) return 'Ujian tidak dikenal.';
    if (plan.subtests.length === 0) return 'Pilih setidaknya satu subtes.';
    const keys = plan.subtests.map((entry) => entry.key);
    if (new Set(keys).size !== keys.length) return 'Setiap subtes hanya boleh dipilih satu kali.';
    let total = 0;
    for (const entry of plan.subtests) {
      const info = this.info(entry.key);
      if (!Number.isInteger(entry.count) || entry.count < 1) return `Jumlah soal ${info.title} harus berupa bilangan bulat positif.`;
      if (entry.count > info.maxCount) return `${info.title} tersedia paling banyak ${info.maxCount} soal.`;
      total += entry.count;
    }
    if (total > MAX_ITEMS_PER_SESSION) return `Satu sesi paling banyak ${MAX_ITEMS_PER_SESSION} soal.`;
    return null;
  }

  private draftsFor(entry: PlanEntry, seed: number): ItemDraft[] {
    const rng = createRng(deriveSeed(seed, entry.key));
    switch (entry.key) {
      case 'penalaran-umum':
        return generatePenalaranUmum(rng, entry.count);
      case 'ppu':
        return generatePpu(rng, this.bank, entry.count);
      case 'pbm':
        return generatePbm(rng, this.bank, entry.count);
      case 'pengetahuan-kuantitatif':
        return generatePengetahuanKuantitatif(rng, entry.count);
      case 'literasi-indonesia':
      case 'literasi-inggris':
        return generateLiteracy(rng, this.bank, entry.key, entry.count);
      case 'penalaran-matematika':
        return generatePenalaranMatematika(rng, entry.count);
    }
  }

  compose(plan: TryoutPlan, seed: number): TryoutItem[] {
    const problem = this.validate(plan);
    if (problem) throw new Error(problem);
    const ordered = [...plan.subtests].sort((a, b) => SUBTEST_KEYS.indexOf(a.key) - SUBTEST_KEYS.indexOf(b.key));
    return ordered
      .flatMap((entry) => this.draftsFor(entry, seed))
      .map((draft, index) => ({ ...draft, id: `q${index + 1}` }));
  }
}
