import { statusMeta } from '~/lib/admin';
import type {
  CircularityMetric,
  CircularityMetricId,
  CircularityMetricState,
  CircularityValues,
} from '~/interfaces/admin';

type Tone = 'neutral' | 'success' | 'warning' | 'error' | 'info';

export interface MetricDefinition {
  title: string;
  question: string;
  formula: string;
  sources: string;
  limits: string;
}

export interface EvidenceRequirement {
  label: string;
  have: number;
  need: number;
}

export interface ValueRow {
  label: string;
  text: string;
}

export const WINDOW_OPTIONS: ReadonlyArray<{ days: number; label: string }> = [
  { days: 30, label: '30 hari terakhir' },
  { days: 90, label: '90 hari terakhir' },
  { days: 365, label: '365 hari terakhir' },
];

export const DEFAULT_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export const METRIC_ORDER: ReadonlyArray<CircularityMetricId> = [
  'MASTERY_CHANGE',
  'REVIEW_OUTCOME',
  'KNOWLEDGE_REUSE',
  'CREATOR_CONVERSION',
  'PROMPT_EVIDENCE',
];

export const METRIC_DEFINITIONS: Record<CircularityMetricId, MetricDefinition> = {
  MASTERY_CHANGE: {
    title: 'Perubahan penguasaan setelah kegiatan bernilai',
    question: 'Setelah satu kegiatan dinilai server, seberapa berubah estimasi penguasaan konsep itu?',
    formula:
      'Untuk setiap kejadian penilaian di jendela waktu: selisih = skor sesudah − skor sebelum, dihitung ulang dengan aturan mastery-v1 dari seluruh kejadian sebelumnya. Dilaporkan: rata-rata, median, dan porsi kejadian dengan selisih di atas 0.',
    sources: 'Kejadian penilaian (LearningEvent) dan lipatan mastery-v1.',
    limits:
      'Aturan menggeser estimasi ke arah hasil, jadi selisih positif hanya berarti hasil melampaui harapan model. Ini audit jalur bukti, bukan peningkatan belajar; peningkatan belajar butuh penilaian ulang tertunda dengan soal baru dan kelompok pembanding.',
  },
  REVIEW_OUTCOME: {
    title: 'Hasil ulasan terjadwal',
    question: 'Saat sebuah konsep dinilai ketika jadwal menyatakannya sudah jatuh tempo, seberapa sering hasilnya lulus?',
    formula:
      'Kejadian jatuh tempo = retrievability exp(−hari/stabilitas) ≤ 0,7 menurut review-v1 pada keadaan sebelumnya. Tingkat lulus = kejadian jatuh tempo dengan skor ≥ 0,7 ÷ semua kejadian jatuh tempo. Pembanding: tingkat lulus kejadian yang belum jatuh tempo.',
    sources: 'Kejadian penilaian dan jadwal ulasan review-v1.',
    limits:
      'Kejadian tidak mencatat apakah pelajar datang dari kartu ulasan, jadi "jatuh tempo" diturunkan dari jadwal. Parameter jadwal bersifat heuristik, bukan hasil kecocokan data. Lulus setelah ulasan bukan bukti retensi jangka panjang.',
  },
  KNOWLEDGE_REUSE: {
    title: 'Pemakaian ulang pengetahuan',
    question: 'Dari produk kreator yang terbit dan bertag konsep, berapa yang benar-benar dipakai oleh paling sedikit dua pelajar lain?',
    formula:
      'Penyebut = produk terbit dengan tag konsep disetujui. Pembilang = produk di penyebut dengan ≥ 2 pelajar berbeda (bukan penulis) yang punya akses aktif yang dibuat di jendela waktu dan menjawab penilaian pada konsep terkait setelah akses dimulai. Tingkat = pembilang ÷ penyebut.',
    sources: 'Produk kelas dan artikel, tag konsep, hak akses (Entitlement), kejadian penilaian.',
    limits:
      'Menjawab penilaian pada konsep terkait setelah akses adalah pendekatan untuk "dipakai"; itu tidak membuktikan produk menjadi penyebabnya. Akses gratis dan berbayar dihitung sama.',
  },
  CREATOR_CONVERSION: {
    title: 'Konversi pelajar ke kreator',
    question: 'Dari pelajar yang memenuhi syarat menurut server, berapa yang sudah menjadi kreator yang disetujui?',
    formula:
      'Memenuhi syarat (per topik): semua konsep topik lulus (skor ≥ 0,7 dengan ≥ 3 bukti) dan rata-rata skor ≥ 0,85. Konversi = pelajar memenuhi syarat dengan pendaftaran kreator berstatus disetujui ÷ semua pelajar memenuhi syarat. Pelajar yang memenuhi syarat di dua topik dihitung sekali.',
    sources: 'Penguasaan konsep (ConceptMastery), tautan konsep ke kurikulum yang disetujui, pendaftaran kreator.',
    limits:
      'Kelayakan dibaca dari keadaan sekarang, bukan keadaan pada tanggal awal jendela. Persetujuan butuh manusia, jadi angka bergantung pada peninjau. Pelajar yang layak belum tentu ingin mengajar, jadi angka rendah bukan kegagalan.',
  },
  PROMPT_EVIDENCE: {
    title: 'Bukti perbaikan prompt',
    question: 'Bukti apa yang berdiri di belakang setiap perubahan prompt tutor?',
    formula:
      'Hitungan, bukan rasio: draf per asal (AI atau insinyur) dan status, run benchmark selesai, vonis tiap kriteria gerbang, run yang sudah diputuskan manusia, uji coba dimulai, rollback, dan hasil strategi per label prompt.',
    sources: 'Versi prompt, riwayat audit, run benchmark offline, hasil strategi.',
    limits:
      'Hitungan menunjukkan aktivitas proses tata kelola, bukan mutu. Mutu dibaca dari laporan evaluasi per dimensi. Kesiapan menuntut paling sedikit satu run selesai dengan keputusan manusia.',
  },
};

export function stateMeta(state: CircularityMetricState): { label: string; tone: Tone } {
  return state === 'OK' ? { label: 'Cukup bukti', tone: 'success' } : { label: 'Belum cukup bukti', tone: 'warning' };
}

export function windowQuery(days: number, now: Date): { from: string; to: string } {
  return { from: new Date(now.getTime() - days * DAY_MS).toISOString(), to: now.toISOString() };
}

const decimal = (value: number, digits: number): string => value.toFixed(digits).replace('.', ',');

export function formatShare(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : `${decimal(value * 100, 1)}%`;
}

export function formatSigned(value: number): string {
  const text = decimal(Math.abs(value), 3);
  if (value > 0) return `+${text}`;
  if (value < 0) return `−${text}`;
  return text;
}

export function sampleLine(sample: { n: number; learners: number }, unit: string): string {
  return `${sample.n} ${unit} dari ${sample.learners} pelajar`;
}

export function requirements<Id extends CircularityMetricId>(metric: CircularityMetric<Id>): EvidenceRequirement[] {
  const { organic, minimum } = metric;
  switch (metric.id) {
    case 'MASTERY_CHANGE':
      return [
        { label: 'Kejadian penilaian organik', have: organic.n, need: minimum.events ?? 0 },
        { label: 'Pelajar organik', have: organic.learners, need: minimum.learners ?? 0 },
      ];
    case 'REVIEW_OUTCOME':
      return [
        { label: 'Kejadian jatuh tempo organik', have: organic.n, need: minimum.events ?? 0 },
        { label: 'Pelajar organik', have: organic.learners, need: minimum.learners ?? 0 },
      ];
    case 'KNOWLEDGE_REUSE':
      return [{ label: 'Produk organik ber-tag disetujui', have: organic.n, need: minimum.products ?? 0 }];
    case 'CREATOR_CONVERSION':
      return [{ label: 'Pelajar organik memenuhi syarat', have: organic.n, need: minimum.eligible ?? 0 }];
    default: {
      const value = metric.value as CircularityValues['PROMPT_EVIDENCE'] | null;
      return [{ label: 'Run dengan keputusan manusia', have: value?.benchmarkRuns.decided ?? 0, need: minimum.decidedRuns ?? 0 }];
    }
  }
}

export function progressOf(requirement: EvidenceRequirement): number {
  if (requirement.need <= 0) return 1;
  return Math.max(0, Math.min(1, requirement.have / requirement.need));
}

export function valueRows<Id extends CircularityMetricId>(id: Id, value: CircularityValues[Id]): ValueRow[] {
  switch (id) {
    case 'MASTERY_CHANGE': {
      const v = value as CircularityValues['MASTERY_CHANGE'];
      return [
        { label: 'Rata-rata perubahan skor', text: formatSigned(v.meanDelta) },
        { label: 'Median perubahan skor', text: formatSigned(v.medianDelta) },
        { label: 'Kejadian dengan skor naik', text: formatShare(v.shareImproved) },
      ];
    }
    case 'REVIEW_OUTCOME': {
      const v = value as CircularityValues['REVIEW_OUTCOME'];
      return [
        { label: 'Kejadian jatuh tempo', text: String(v.dueEvents) },
        { label: 'Lulus', text: `${v.passed} dari ${v.dueEvents} (${formatShare(v.passRate)})` },
        { label: 'Pembanding: belum jatuh tempo', text: v.notDuePassRate === null ? 'tidak ada kejadian' : `${formatShare(v.notDuePassRate)} dari ${v.notDueEvents}` },
      ];
    }
    case 'KNOWLEDGE_REUSE': {
      const v = value as CircularityValues['KNOWLEDGE_REUSE'];
      return [
        { label: 'Produk terbit ber-tag disetujui', text: String(v.denominator) },
        { label: 'Dipakai oleh ≥ 2 pelajar', text: String(v.numerator) },
        { label: 'Tingkat pemakaian ulang', text: formatShare(v.reuseRate) },
        ...v.products.map((product) => ({
          label: product.title,
          text: `${product.holders} pemilik akses, ${product.qualifyingLearners} memenuhi syarat`,
        })),
      ];
    }
    case 'CREATOR_CONVERSION': {
      const v = value as CircularityValues['CREATOR_CONVERSION'];
      return [
        { label: 'Pelajar memenuhi syarat', text: String(v.eligible) },
        { label: 'Sudah jadi kreator', text: String(v.converted) },
        { label: 'Konversi', text: formatShare(v.conversion) },
        ...v.topics.map((topic) => ({ label: topic.title, text: `${topic.converted} dari ${topic.eligible} (${topic.concepts} konsep)` })),
      ];
    }
    default: {
      const v = value as CircularityValues['PROMPT_EVIDENCE'];
      const statuses = Object.entries(v.drafts.byStatus)
        .map(([status, count]) => `${count} ${statusMeta('prompt', status).label.toLowerCase()}`)
        .join(', ');
      return [
        { label: 'Draf usulan', text: `${v.drafts.aiProposed} dari AI, ${v.drafts.engineer} dari insinyur` },
        { label: 'Status versi', text: statuses || 'belum ada versi' },
        { label: 'Run benchmark selesai', text: `${v.benchmarkRuns.completed} (${v.benchmarkRuns.candidateRuns} kandidat, ${v.benchmarkRuns.identicalArmsRuns} dasar melawan dirinya)` },
        { label: 'Run dengan keputusan manusia', text: String(v.benchmarkRuns.decided) },
        { label: 'Uji coba dimulai, rollback', text: `${v.canariesStarted}, ${v.rollbacks}` },
        ...v.strategyOutcomes.map((item) => ({ label: `Hasil strategi: ${item.promptVersion}`, text: `${item.successes} naik dari ${item.n}` })),
      ];
    }
  }
}
