export type Tone = 'neutral' | 'success' | 'warning' | 'error' | 'info';
export type StatusDomain = 'payout' | 'refund' | 'content' | 'tenant' | 'application' | 'payment' | 'prompt' | 'gate' | 'optimizationRun' | 'benchmark';

export const REASON_MIN = 3;
export const REASON_MAX = 500;

export function reasonProblem(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 'Alasan wajib diisi (minimal 3 karakter).';
  if (trimmed.length < REASON_MIN) return 'Alasan terlalu pendek (minimal 3 karakter).';
  if (trimmed.length > REASON_MAX) return 'Alasan terlalu panjang (maksimal 500 karakter).';
  return null;
}

const META: Record<StatusDomain, Record<string, { label: string; tone: Tone }>> = {
  payout: {
    REQUESTED: { label: 'Diajukan', tone: 'warning' },
    UNDER_REVIEW: { label: 'Ditinjau', tone: 'info' },
    APPROVED: { label: 'Disetujui', tone: 'info' },
    PAID: { label: 'Dibayar', tone: 'success' },
    REJECTED: { label: 'Ditolak', tone: 'error' },
    CANCELLED: { label: 'Dibatalkan', tone: 'neutral' },
  },
  refund: {
    REQUESTED: { label: 'Diajukan', tone: 'warning' },
    APPROVED: { label: 'Disetujui', tone: 'info' },
    PROCESSED: { label: 'Selesai', tone: 'success' },
    REJECTED: { label: 'Ditolak', tone: 'error' },
  },
  content: {
    DRAFT: { label: 'Draf', tone: 'neutral' },
    PENDING_REVIEW: { label: 'Menunggu tinjauan', tone: 'info' },
    PUBLISHED: { label: 'Terbit', tone: 'success' },
    REJECTED: { label: 'Ditolak', tone: 'error' },
    SUSPENDED: { label: 'Ditangguhkan', tone: 'warning' },
    ARCHIVED: { label: 'Diarsipkan', tone: 'neutral' },
  },
  tenant: {
    ACTIVE: { label: 'Aktif', tone: 'success' },
    SUSPENDED: { label: 'Ditangguhkan', tone: 'error' },
    ARCHIVED: { label: 'Diarsipkan', tone: 'neutral' },
  },
  application: {
    PENDING: { label: 'Menunggu', tone: 'warning' },
    APPROVED: { label: 'Disetujui', tone: 'success' },
    REJECTED: { label: 'Ditolak', tone: 'error' },
  },
  payment: {
    SUBMITTED: { label: 'Menunggu', tone: 'warning' },
    UNDER_REVIEW: { label: 'Ditinjau', tone: 'info' },
    APPROVED: { label: 'Disetujui', tone: 'success' },
    REJECTED: { label: 'Ditolak', tone: 'error' },
    CANCELLED: { label: 'Dibatalkan', tone: 'neutral' },
    EXPIRED: { label: 'Kedaluwarsa', tone: 'neutral' },
  },
  prompt: {
    DRAFT: { label: 'Draf', tone: 'neutral' },
    EXPERIMENTAL: { label: 'Uji coba', tone: 'info' },
    VALIDATED: { label: 'Lolos gerbang', tone: 'warning' },
    ACTIVE: { label: 'Aktif', tone: 'success' },
    REJECTED: { label: 'Ditolak', tone: 'error' },
    ROLLED_BACK: { label: 'Ditarik', tone: 'error' },
    ARCHIVED: { label: 'Diarsipkan', tone: 'neutral' },
  },
  gate: {
    PASS: { label: 'Lolos', tone: 'success' },
    FAIL: { label: 'Gagal', tone: 'error' },
    INSUFFICIENT_DATA: { label: 'Data kurang', tone: 'warning' },
    NOT_MEASURED: { label: 'Belum terukur', tone: 'neutral' },
  },
  benchmark: {
    QUEUED: { label: 'Antre', tone: 'neutral' },
    RUNNING: { label: 'Berjalan', tone: 'info' },
    COMPLETED: { label: 'Selesai', tone: 'success' },
    FAILED: { label: 'Gagal', tone: 'error' },
  },
  optimizationRun: {
    PENDING: { label: 'Menunggu keputusan', tone: 'warning' },
    ACCEPTED: { label: 'Disetujui', tone: 'success' },
    REJECTED: { label: 'Ditolak', tone: 'error' },
    DEFERRED: { label: 'Ditunda', tone: 'neutral' },
  },
};

export function statusMeta(domain: StatusDomain, status: string): { label: string; tone: Tone } {
  return META[domain][status] ?? { label: status, tone: 'neutral' };
}

export type PayoutAction = 'start-review' | 'approve' | 'reject' | 'mark-paid';
export type RefundAction = 'approve' | 'reject' | 'process';
export type ContentAction = 'approve' | 'reject' | 'suspend' | 'reinstate' | 'archive';

const PAYOUT_ACTIONS: Record<string, PayoutAction[]> = {
  REQUESTED: ['start-review', 'reject'],
  UNDER_REVIEW: ['approve', 'reject'],
  APPROVED: ['mark-paid', 'reject'],
};

const REFUND_ACTIONS: Record<string, RefundAction[]> = {
  REQUESTED: ['approve', 'reject'],
  APPROVED: ['process', 'reject'],
};

const CONTENT_ACTIONS: Record<string, ContentAction[]> = {
  PENDING_REVIEW: ['approve', 'reject'],
  PUBLISHED: ['suspend', 'archive'],
  SUSPENDED: ['reinstate', 'archive'],
};

export type PromptAction = 'canary' | 'evaluate' | 'approve' | 'reject' | 'rollback';

const PROMPT_ACTIONS: Record<string, PromptAction[]> = {
  DRAFT: ['canary', 'reject'],
  EXPERIMENTAL: ['evaluate', 'reject'],
  VALIDATED: ['approve', 'reject'],
  ACTIVE: ['rollback'],
};

export const promptActions = (status: string): PromptAction[] => [...(PROMPT_ACTIONS[status] ?? [])];

export const CANARY_MIN_PERCENT = 1;
export const CANARY_MAX_PERCENT = 50;

export function canaryProblem(percent: number): string | null {
  if (!Number.isInteger(percent)) return 'Porsi uji coba harus bilangan bulat.';
  if (percent < CANARY_MIN_PERCENT || percent > CANARY_MAX_PERCENT) return `Porsi uji coba ${CANARY_MIN_PERCENT} sampai ${CANARY_MAX_PERCENT} persen.`;
  return null;
}

export const TEMPLATE_MIN = 200;
export const TEMPLATE_MAX = 20000;
export const TEMPLATE_REQUIRED = ['user_step_title', 'domain_block', 'user_input', 'rag', 'web', 'memory', 'conversation', 'current_material'] as const;
export const TEMPLATE_OPTIONAL = ['learner_section', 'learner_name'] as const;
export const TEMPLATE_PLACEHOLDERS = [...TEMPLATE_REQUIRED, ...TEMPLATE_OPTIONAL] as const;
const PLACEHOLDER = /\{\{\s*([a-z_]+)\s*\}\}/g;

const AI_PROBLEM_COPY: ReadonlyArray<[RegExp, (match: RegExpMatchArray) => string]> = [
  [/Only (\d+) turns of (\S+) are measured; an improvement needs at least (\d+)/, (m) => `Baru ${m[1]} jawaban dari ${m[2]} yang terukur. Usulan AI butuh minimal ${m[3]}.`],
  [/There are already (\d+) AI proposals waiting/, (m) => `Sudah ada ${m[1]} usulan AI yang menunggu. Tolak atau mulai uji coba salah satunya dulu.`],
  [/failed the safety checks/, () => 'AI mengusulkan templat yang tidak lolos pemeriksaan keamanan, jadi tidak disimpan. Coba lagi.'],
  [/could not produce a proposal/, () => 'Layanan AI belum bisa membuat usulan sekarang. Coba lagi nanti.'],
];

export function aiProposalProblem(message: string | null | undefined, fallback: string): string {
  for (const [pattern, copy] of AI_PROBLEM_COPY) {
    const match = (message ?? '').match(pattern);
    if (match) return copy(match);
  }
  return message?.trim() ? message : fallback;
}

export function templateProblem(body: string): string | null {
  if (body.trim().length < TEMPLATE_MIN) return `Templat minimal ${TEMPLATE_MIN} karakter.`;
  if (body.length > TEMPLATE_MAX) return `Templat maksimal ${TEMPLATE_MAX} karakter.`;
  const used = new Set([...body.matchAll(PLACEHOLDER)].map((match) => match[1] as string));
  const unknown = [...used].find((name) => !(TEMPLATE_PLACEHOLDERS as readonly string[]).includes(name));
  if (unknown) return `Penanda {{${unknown}}} tidak dikenal.`;
  const missing = TEMPLATE_REQUIRED.find((name) => !used.has(name));
  if (missing) return `Penanda {{${missing}}} wajib ada.`;
  const rest = body.replace(PLACEHOLDER, '');
  if (rest.includes('{{') || rest.includes('}}')) return 'Ada penanda yang rusak.';
  return null;
}

export function formatRate(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : `${Math.round(value * 100)}%`;
}

export function formatMillis(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return value >= 1000 ? `${(value / 1000).toFixed(1)} dtk` : `${Math.round(value)} ms`;
}

export const GATE_LABELS: Record<string, string> = {
  sample_size: 'Jumlah sampel',
  learning_outcome: 'Hasil belajar setelah jawaban',
  grounding: 'Jawaban beracuan sumber',
  latency_p95: 'Latensi p95',
  token_cost: 'Token per jawaban',
  correctness: 'Ketepatan isi',
  pedagogy: 'Mutu pengajaran',
  hallucination_rate: 'Tingkat halusinasi',
  offline_correctness: 'Ketepatan isi pada benchmark',
  offline_citation_faithfulness: 'Sitasi benar dan relevan pada benchmark',
  offline_safety: 'Keamanan pada benchmark',
  offline_pedagogy_judge: 'Mutu pengajaran menurut juri AI',
  judge_calibration: 'Kalibrasi juri AI',
};

export const gateLabel = (id: string): string => GATE_LABELS[id] ?? id;

export const payoutActions = (status: string): PayoutAction[] => [...(PAYOUT_ACTIONS[status] ?? [])];
export const refundActions = (status: string): RefundAction[] => [...(REFUND_ACTIONS[status] ?? [])];
export const contentActions = (status: string): ContentAction[] => [...(CONTENT_ACTIONS[status] ?? [])];

export type TagDecision = 'approve-tags' | 'reject-tags';

export const canDecideTags = (status: string, pending: number | undefined): boolean => status === 'PUBLISHED' && (pending ?? 0) > 0;

export const pendingTagsLabel = (pending: number | undefined): string => ((pending ?? 0) > 0 ? `${pending} tag menunggu` : '');

export function tenantAction(status: string): 'suspend' | 'activate' | null {
  if (status === 'ACTIVE') return 'suspend';
  if (status === 'SUSPENDED') return 'activate';
  return null;
}

export function canChangeAccount(selfId: string | undefined, targetId: string): boolean {
  return Boolean(selfId) && selfId !== targetId;
}

const ROLE_LABELS: Record<string, string> = {
  STUDENT: 'Pelajar',
  TEACHER: 'Guru',
  REVIEWER: 'Peninjau',
  ADMIN: 'Admin',
};

export const ROLE_VALUES = ['STUDENT', 'TEACHER', 'REVIEWER', 'ADMIN'] as const;

export const roleLabel = (role: string): string => ROLE_LABELS[role] ?? role;

export function pageWindow(page: number, totalPages: number, span = 2): Array<number | '…'> {
  if (totalPages < 1) return [];
  const wanted = new Set<number>([1, totalPages]);
  for (let value = page - span; value <= page + span; value += 1) {
    if (value >= 1 && value <= totalPages) wanted.add(value);
  }
  const sorted = [...wanted].sort((a, b) => a - b);
  const result: Array<number | '…'> = [];
  sorted.forEach((value, index) => {
    const previous = sorted[index - 1];
    if (previous !== undefined) {
      if (value - previous === 2) result.push(previous + 1);
      else if (value - previous > 2) result.push('…');
    }
    result.push(value);
  });
  return result;
}

const AUDIT_LABELS: Record<string, string> = {
  USER_ROLE_CHANGED: 'Peran pengguna diubah',
  USER_DEACTIVATED: 'Akun pengguna dinonaktifkan',
  MANUAL_PAYMENT_SUBMITTED: 'Bukti pembayaran dikirim',
  MANUAL_PAYMENT_REVIEW_STARTED: 'Peninjauan pembayaran dimulai',
  MANUAL_PAYMENT_APPROVED: 'Pembayaran manual disetujui',
  MANUAL_PAYMENT_REJECTED: 'Pembayaran manual ditolak',
  PAYMENT_RECONCILED: 'Pembayaran direkonsiliasi',
  PAYMENT_EXPIRE_SWEEP: 'Pembayaran kedaluwarsa disapu',
  ORDER_CREATED: 'Pesanan dibuat',
  ORDER_PAID: 'Pesanan dibayar',
  ORDER_FULFILLED: 'Pesanan dipenuhi',
  ORDER_CANCELLED: 'Pesanan dibatalkan',
  ORDER_REFUND_PENDING: 'Pengembalian dana diproses',
  ORDER_REFUNDED: 'Pesanan dikembalikan dananya',
  ARTICLE_CREATED: 'Artikel dibuat',
  ARTICLE_UPDATED: 'Artikel diperbarui',
  CLASS_CREATED: 'Kelas dibuat',
  CLASS_UPDATED: 'Kelas diperbarui',
  CLASS_ENROLLED: 'Pendaftaran kelas',
  CLASS_COMPLETED: 'Kelas diselesaikan',
  TENANT_CREATED: 'Tenant dibuat',
  TENANT_UPDATED: 'Tenant diperbarui',
  REWARD_REVERSED: 'Hadiah dibatalkan',
  PURCHASE_COMPLETED: 'Pembelian selesai',
  QUIZ_SUBMITTED: 'Kuis dikirim',
  PROMPT_PROPOSED: 'Versi prompt diusulkan',
  PROMPT_CANARY_STARTED: 'Uji coba prompt dimulai',
  PROMPT_EVALUATED: 'Versi prompt dievaluasi',
  PROMPT_AUTO_ROLLED_BACK: 'Versi prompt ditarik otomatis',
  PROMPT_APPROVED: 'Versi prompt disetujui',
  PROMPT_REJECTED: 'Versi prompt ditolak',
  PROMPT_ROLLED_BACK: 'Versi prompt ditarik',
  LESSON_COMPLETED: 'Pelajaran selesai',
  GAMIFY_RULE_PUBLISHED: 'Versi aturan hadiah diterbitkan',
  GAMIFY_RULE_ACTIVATED: 'Versi aturan hadiah diaktifkan',
  GAMIFY_RULE_DEACTIVATED: 'Aturan hadiah dimatikan',
  GAMIFY_LEVELS_REPLACED: 'Tangga level diganti',
  GAMIFY_ACHIEVEMENT_CREATED: 'Pencapaian dibuat',
  GAMIFY_ACHIEVEMENT_UPDATED: 'Pencapaian diubah',
  GAMIFY_ACHIEVEMENT_ACTIVATED: 'Pencapaian diaktifkan',
  GAMIFY_ACHIEVEMENT_DEACTIVATED: 'Pencapaian dinonaktifkan',
};

export function auditActionLabel(action: string): string {
  const known = AUDIT_LABELS[action];
  if (known) return known;
  const words = action.replace(/_/g, ' ').trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export const EVIDENCE_MAX_BYTES = 4 * 1024 * 1024;
const EVIDENCE_EXTENSIONS = /\.(jpe?g|png|gif|webp|bmp|tiff)$/i;

export function evidenceProblem(file: { name: string; size: number } | null | undefined): string | null {
  if (!file) return 'Unggah bukti terlebih dahulu.';
  if (!EVIDENCE_EXTENSIONS.test(file.name)) return 'Bukti harus berupa gambar (JPG, PNG, WebP, GIF).';
  if (file.size > EVIDENCE_MAX_BYTES) return 'Ukuran gambar maksimal 4 MB.';
  if (file.size === 0) return 'File kosong.';
  return null;
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

function validDay(value: string): boolean {
  const match = DAY.exec(value);
  if (!match) return false;
  const [, year, month, day] = match.map(Number) as [number, number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function dayStartIso(value: string): string | undefined {
  return validDay(value) ? new Date(`${value}T00:00:00+07:00`).toISOString() : undefined;
}

export function dayEndIso(value: string): string | undefined {
  return validDay(value) ? new Date(`${value}T23:59:59.999+07:00`).toISOString() : undefined;
}

export function prettyJson(value: unknown): string {
  if (value === null || value === undefined) return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
