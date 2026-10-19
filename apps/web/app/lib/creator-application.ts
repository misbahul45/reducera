export interface ApplicationForm {
  fullName: string;
  bio: string;
  expertise: string;
  portfolioUrl: string;
  cvUrl: string;
  expertiseTopicId: string;
}

export interface TopicEligibility {
  topicId: string;
  title: string;
  eligible: boolean;
  score: number | null;
  passedConcepts: number;
  totalConcepts: number;
}

export const ELIGIBILITY_PERCENT = 85;

const WEB_URL = /^https?:\/\/[^\s]+$/i;

export function applicationProblem(form: ApplicationForm): string | null {
  if (!form.expertiseTopicId) return 'Pilih course keahlian yang sudah kamu kuasai.';
  if (form.fullName.trim().length < 2) return 'Nama lengkap wajib diisi.';
  if (form.fullName.trim().length > 200) return 'Nama lengkap terlalu panjang.';
  if (form.bio.length > 5000) return 'Bio maksimal 5000 karakter.';
  if (form.expertise.length > 1000) return 'Bidang keahlian maksimal 1000 karakter.';
  if (form.portfolioUrl.trim() && !WEB_URL.test(form.portfolioUrl.trim())) return 'Tautan portofolio harus diawali http:// atau https://.';
  if (form.cvUrl.trim() && !WEB_URL.test(form.cvUrl.trim())) return 'Tautan CV harus diawali http:// atau https://.';
  return null;
}

export function applicationPayload(form: ApplicationForm) {
  const optional = (value: string) => (value.trim() ? value.trim() : undefined);
  return {
    expertiseTopicId: form.expertiseTopicId,
    fullName: form.fullName.trim(),
    ...(optional(form.bio) ? { bio: optional(form.bio) } : {}),
    ...(optional(form.expertise) ? { expertise: optional(form.expertise) } : {}),
    ...(optional(form.portfolioUrl) ? { portfolioUrl: optional(form.portfolioUrl) } : {}),
    ...(optional(form.cvUrl) ? { cvUrl: optional(form.cvUrl) } : {}),
  };
}

export type ApplicationStage = 'none' | 'pending' | 'approved' | 'rejected';

export function applicationStage(application: { status: string } | null | undefined): ApplicationStage {
  if (!application) return 'none';
  if (application.status === 'APPROVED') return 'approved';
  if (application.status === 'REJECTED') return 'rejected';
  return 'pending';
}

export function eligibilityCopy(row: TopicEligibility): string {
  if (row.totalConcepts === 0) return 'Course ini belum punya konsep yang bisa dinilai.';
  const mean = row.score === null ? 0 : Math.round(row.score * 100);
  const lead = `${row.passedConcepts} dari ${row.totalConcepts} konsep lulus, rata-rata ${mean}%`;
  return row.eligible ? `${lead}. Syarat terpenuhi.` : `${lead}. Syaratnya semua konsep lulus dengan rata-rata ${ELIGIBILITY_PERCENT}%.`;
}

export const eligibleTopics = (rows: readonly TopicEligibility[]): TopicEligibility[] => rows.filter((row) => row.eligible);
