import type {
  BenchmarkDatasetName,
  BenchmarkDatasetRole,
  BenchmarkPairedDifference,
  BenchmarkReportView,
  BenchmarkRunSummary,
} from '~/interfaces/admin';

export const DECISION_MIN = 10;
export const DECISION_MAX = 1000;
export const POLL_INTERVAL_MS = 5000;

export const DATASET_OPTIONS: ReadonlyArray<{ value: BenchmarkDatasetName; label: string; hint: string }> = [
  { value: 'tutor-chat-benchmark-v1', label: 'Benchmark penilai', hint: 'Menilai kandidat. Isinya tidak pernah dilihat AI pengusul.' },
  { value: 'tutor-chat-dev-v1', label: 'Set pengembangan', hint: 'Satu-satunya data yang boleh dibaca AI saat menulis usulan.' },
];

export type DimensionKind = 'rate' | 'score';

export interface DimensionRow {
  id: string;
  label: string;
  kind: DimensionKind;
  judge: boolean;
  difference: BenchmarkPairedDifference;
}

const DIMENSIONS: ReadonlyArray<{ id: string; label: string; kind: DimensionKind; judge: boolean }> = [
  { id: 'correctness', label: 'Ketepatan isi', kind: 'rate', judge: false },
  { id: 'citation', label: 'Sitasi benar dan relevan', kind: 'rate', judge: false },
  { id: 'safety', label: 'Keamanan', kind: 'rate', judge: false },
  { id: 'pedagogy', label: 'Mutu pengajaran (juri AI)', kind: 'score', judge: true },
  { id: 'behavior', label: 'Perilaku sesuai harapan (juri AI)', kind: 'score', judge: true },
  { id: 'grounding', label: 'Berpijak pada sumber (juri AI)', kind: 'score', judge: true },
];

const decimal = (value: number, digits: number): string => value.toFixed(digits).replace('.', ',');

const signed = (value: number, digits: number): string => {
  const rounded = Number(value.toFixed(digits));
  if (rounded === 0) return decimal(0, digits);
  return `${rounded > 0 ? '+' : '−'}${decimal(Math.abs(rounded), digits)}`;
};

export function datasetRoleLabel(role: BenchmarkDatasetRole): string {
  return role === 'DEVELOPMENT' ? 'Set pengembangan' : 'Benchmark penilai';
}

export function levelLabel(value: number | null, kind: DimensionKind): string {
  if (value === null) return '—';
  return kind === 'rate' ? `${decimal(value * 100, 1)}%` : decimal(value, 2);
}

export function differenceLabel(value: number | null, kind: DimensionKind): string {
  if (value === null) return '—';
  return kind === 'rate' ? `${signed(value * 100, 1)} poin` : signed(value, 2);
}

export function intervalLabel(difference: Pick<BenchmarkPairedDifference, 'lower' | 'upper'>, kind: DimensionKind): string {
  if (difference.lower === null || difference.upper === null) return '—';
  const scale = kind === 'rate' ? 100 : 1;
  const digits = kind === 'rate' ? 1 : 2;
  return `${signed(difference.lower * scale, digits)} sampai ${signed(difference.upper * scale, digits)}`;
}

export type Verdict = 'BETTER' | 'WORSE' | 'UNPROVEN' | 'NO_DATA';

export function verdictOf(difference: Pick<BenchmarkPairedDifference, 'lower' | 'upper' | 'pairedCases'>): Verdict {
  if (difference.pairedCases === 0 || difference.lower === null || difference.upper === null) return 'NO_DATA';
  if (difference.lower > 0) return 'BETTER';
  if (difference.upper < 0) return 'WORSE';
  return 'UNPROVEN';
}

export const VERDICT_META: Record<Verdict, { label: string; tone: 'success' | 'error' | 'warning' | 'neutral' }> = {
  BETTER: { label: 'Lebih baik', tone: 'success' },
  WORSE: { label: 'Lebih buruk', tone: 'error' },
  UNPROVEN: { label: 'Beda belum terbukti', tone: 'warning' },
  NO_DATA: { label: 'Tanpa data', tone: 'neutral' },
};

export function dimensionRows(report: BenchmarkReportView): DimensionRow[] {
  return DIMENSIONS.filter((dimension) => report.evidence.judged || !dimension.judge).map((dimension) => ({
    id: dimension.id,
    label: dimension.label,
    kind: dimension.kind,
    judge: dimension.judge,
    difference: (dimension.kind === 'rate'
      ? report.comparison.rates[dimension.id as keyof BenchmarkReportView['comparison']['rates']]
      : report.comparison.scores[dimension.id as keyof BenchmarkReportView['comparison']['scores']]),
  }));
}

export function worseCases(report: BenchmarkReportView): Array<{ caseId: string; dimensions: string[] }> {
  const found = new Map<string, string[]>();
  for (const row of dimensionRows(report)) {
    for (const caseId of row.difference.regressions) found.set(caseId, [...(found.get(caseId) ?? []), row.label]);
  }
  for (const caseId of report.comparison.safetyRegressions) {
    const labels = found.get(caseId) ?? [];
    if (!labels.includes('Keamanan')) found.set(caseId, [...labels, 'Keamanan']);
  }
  return [...found.entries()].map(([caseId, dimensions]) => ({ caseId, dimensions })).sort((left, right) => (left.caseId < right.caseId ? -1 : 1));
}

export function progressPercent(progress: { done: number; total: number }): number {
  if (progress.total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((progress.done / progress.total) * 100)));
}

export const isActiveRun = (run: Pick<BenchmarkRunSummary, 'status'>): boolean => run.status === 'QUEUED' || run.status === 'RUNNING';

export const hasActiveRun = (runs: ReadonlyArray<Pick<BenchmarkRunSummary, 'status'>>): boolean => runs.some(isActiveRun);

export const canDecide = (run: Pick<BenchmarkRunSummary, 'status' | 'decision'>): boolean => run.status === 'COMPLETED' && run.decision === 'PENDING';

export const canProposeFrom = (run: Pick<BenchmarkRunSummary, 'status' | 'datasetRole'>): boolean => run.status === 'COMPLETED' && run.datasetRole === 'DEVELOPMENT';

export function decisionProblem(rationale: string): string | null {
  const length = rationale.trim().length;
  if (length === 0) return `Alasan keputusan wajib diisi (minimal ${DECISION_MIN} karakter).`;
  if (length < DECISION_MIN) return `Alasan terlalu pendek (minimal ${DECISION_MIN} karakter).`;
  if (length > DECISION_MAX) return `Alasan terlalu panjang (maksimal ${DECISION_MAX} karakter).`;
  return null;
}

export function runTitle(run: Pick<BenchmarkRunSummary, 'baseline' | 'candidate' | 'identicalArms'>): string {
  return run.identicalArms ? `${run.baseline} melawan dirinya sendiri` : `${run.candidate} melawan ${run.baseline}`;
}

export const CAVEATS = {
  identical: 'Kedua lengan memakai prompt yang sama. Selisih di sini adalah noise bawaan model; pakai sebagai pembanding, bukan sebagai hasil.',
  development: 'Ini run pada set pengembangan. Angkanya boleh dipakai untuk mencari kelemahan, tidak untuk menyetujui versi.',
  judge: 'Juri AI belum dikalibrasi dengan label manusia: skornya sinyal tambahan, bukan bukti tunggal.',
  authorDraft: 'Kasus dan pola jawaban ditulis satu orang dan belum ditinjau orang kedua.',
} as const;
