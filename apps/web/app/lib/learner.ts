export type NextConceptReason =
  | 'NO_CONCEPTS'
  | 'NO_EVIDENCE_START'
  | 'PREREQUISITES_MET'
  | 'CONTINUE_PRACTICE'
  | 'UNREACHABLE_PREREQUISITES'
  | 'ALL_CONCEPTS_PASSED';

export interface NextConceptView {
  conceptId: string | null;
  level: number | null;
  reasonCodes: NextConceptReason[];
  concept: { id: string; title: string; level: number } | null;
}

export interface NextConceptCopy {
  title: string;
  reason: string;
  done: boolean;
}

const REASONS: Readonly<Record<NextConceptReason, string>> = {
  NO_CONCEPTS: 'Konsep belajar belum tersedia untuk saat ini.',
  NO_EVIDENCE_START: 'Mulai dari dasar, satu konsep dulu.',
  PREREQUISITES_MET: 'Prasyaratmu sudah terpenuhi, saatnya konsep ini.',
  CONTINUE_PRACTICE: 'Kamu sedang di tengah konsep ini, lanjutkan latihannya.',
  UNREACHABLE_PREREQUISITES: 'Perkuat dulu prasyaratnya sebelum melangkah lebih jauh.',
  ALL_CONCEPTS_PASSED: 'Hebat, tidak ada lagi konsep yang tertinggal.',
};

export const nextConceptCopy = (view: NextConceptView): NextConceptCopy => {
  const code = view.reasonCodes[0] ?? 'NO_CONCEPTS';
  const reason = REASONS[code];
  if (code === 'ALL_CONCEPTS_PASSED') return { title: 'Semua konsep sudah lulus', reason, done: true };
  if (!view.concept) return { title: 'Belum ada konsep', reason, done: false };
  return { title: view.concept.title, reason, done: false };
};

export interface StrategyView {
  conceptId: string;
  intent: string;
  strategy: string;
  hintLevel: number;
  scaffoldLevel: string;
  difficultyTarget: number;
  maxAttempts: number;
  reasonCodes: string[];
  policyVersion: string;
  personalEvidenceAttempts: number;
  evidenceSufficient: boolean;
}

export interface StrategySummaryRow {
  strategy: string;
  attempts: number;
  successes: number;
  averageDelta: number;
  successRate: number | null;
}

export interface StrategySummaryView {
  strategies: StrategySummaryRow[];
  preferredStrategy: string | null;
  totalAttempts: number;
}

const STRATEGY_LABELS: Readonly<Record<string, string>> = {
  EXPLAIN: 'Penjelasan langsung',
  ASK: 'Pertanyaan pemantik',
  HINT: 'Petunjuk bertahap',
  WORKED_EXAMPLE: 'Contoh lengkap',
  GUIDED_EXAMPLE: 'Contoh terpandu',
  SOCRATIC: 'Tanya jawab terarah',
  COUNTEREXAMPLE: 'Contoh tandingan',
  PRACTICE: 'Latihan soal',
  REMEDIATE: 'Perbaikan konsep',
  REVIEW: 'Ulasan ulang',
  CHALLENGE: 'Tantangan',
  TRANSFER: 'Terapan di konteks baru',
};

const STRATEGY_REASONS: Readonly<Record<string, string>> = {
  OPEN_MISCONCEPTIONS: 'Masih ada kesalahan konsep yang perlu dibereskan.',
  PREREQUISITE_NOT_MET: 'Konsep prasyarat belum lulus.',
  LOW_MASTERY: 'Penguasaanmu masih rendah, jadi langkahnya dibuat kecil.',
  MID_MASTERY: 'Penguasaanmu sedang, jadi kamu ikut mengerjakan sebagian.',
  HIGH_MASTERY: 'Penguasaanmu sudah tinggi, jadi kamu didorong berpikir sendiri.',
  INTENT_CHALLENGE: 'Kamu meminta tantangan.',
  INTENT_TRANSFER: 'Kamu siap menerapkan konsep di konteks baru.',
  INTENT_PRACTICE: 'Kamu sedang berlatih.',
  REVIEW_DUE: 'Konsep ini sudah lama tidak diulang.',
  PERSONAL_STRATEGY_PREFERRED: 'Cara ini paling sering menaikkan penguasaanmu.',
  INSUFFICIENT_EVIDENCE: 'Bukti belajarmu masih sedikit, jadi keputusan ini masih awal.',
};

export const strategyLabel = (code: string): string => STRATEGY_LABELS[code] ?? code;

export const strategyReasons = (codes: readonly string[]): string[] =>
  codes.flatMap((code) => (STRATEGY_REASONS[code] ? [STRATEGY_REASONS[code]] : []));

export interface StrategyEvidenceCopy {
  title: string;
  hint: string;
  rows: Array<{ strategy: string; label: string; attempts: number; successes: number; percent: number | null; preferred: boolean }>;
}

export const strategyEvidenceCopy = (summary: StrategySummaryView): StrategyEvidenceCopy => {
  const rows = summary.strategies
    .filter((row) => row.attempts > 0)
    .map((row) => ({
      strategy: row.strategy,
      label: strategyLabel(row.strategy),
      attempts: row.attempts,
      successes: row.successes,
      percent: row.successRate === null ? null : Math.round(row.successRate * 100),
      preferred: row.strategy === summary.preferredStrategy,
    }))
    .sort((a, b) => Number(b.preferred) - Number(a.preferred) || (b.percent ?? -1) - (a.percent ?? -1) || b.attempts - a.attempts);

  if (rows.length === 0) {
    return {
      title: 'Cara belajar yang cocok untukmu',
      hint: 'Tanyakan sesuatu ke CORE, lalu kerjakan kuis. Dari hasilnya kami belajar cara mengajar yang paling cocok untukmu.',
      rows,
    };
  }
  const preferred = summary.preferredStrategy ? strategyLabel(summary.preferredStrategy) : null;
  return {
    title: 'Cara belajar yang cocok untukmu',
    hint: preferred
      ? `${preferred} paling sering menaikkan penguasaanmu, jadi CORE memakainya lebih dulu.`
      : 'Kami masih mengumpulkan bukti. Cara paling cocok muncul setelah tiga percobaan dengan hasil baik.',
    rows,
  };
};
