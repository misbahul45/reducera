export interface SqlErrorView {
  code: string;
  friendly: string;
  message: string;
  detail: string | null;
  hint: string | null;
  position: number | null;
}

const FRIENDLY: Record<string, string> = {
  '42601': 'Penulisan SQL belum benar. Periksa tanda baca, kata kunci, dan urutan klausanya.',
  '42P01': 'Tabel tidak ditemukan. Periksa nama tabel dan ejaannya.',
  '42703': 'Kolom tidak ditemukan. Periksa nama kolom dan ejaannya.',
  '42702': 'Nama kolom ambigu karena ada di lebih dari satu tabel. Sebutkan tabel atau aliasnya, misalnya p.id.',
  '42883': 'Fungsi atau operator tidak cocok dengan tipe datanya. Periksa tipe nilai yang dibandingkan.',
  '42803': 'Kolom yang tidak dibungkus fungsi agregat harus ada di GROUP BY.',
  '42804': 'Tipe data tidak cocok. Periksa nilai yang dimasukkan atau dibandingkan.',
  '42P07': 'Tabel atau objek dengan nama itu sudah ada.',
  '42P16': 'Definisi tabel belum benar. Periksa kolom dan batasannya.',
  '42701': 'Nama kolom muncul lebih dari sekali.',
  '23503': 'Pelanggaran kunci asing: data masih dipakai tabel lain, atau data yang diacu belum ada. Perhatikan urutan penghapusan dan penambahan.',
  '23505': 'Nilai kunci sudah ada. Kunci utama dan kolom unik tidak boleh duplikat.',
  '23502': 'Kolom wajib diisi tidak boleh bernilai NULL.',
  '23514': 'Nilai melanggar batasan CHECK pada tabel.',
  '22P02': 'Format nilai tidak sesuai dengan tipe kolomnya.',
  '22007': 'Format tanggal tidak valid. Gunakan format tahun-bulan-tanggal, misalnya 2025-06-20.',
  '22012': 'Pembagian dengan nol.',
  '22003': 'Nilai di luar jangkauan tipe datanya.',
  '42501': 'Operasi ini tidak diizinkan di sandbox.',
  '57014': 'Eksekusi melebihi batas waktu. Sederhanakan kueri atau tambahkan syarat penyaringan.',
  '53400': 'Pekerjaan kueri terlalu besar untuk sandbox. Batasi datanya dengan WHERE atau LIMIT.',
  '55P03':'Eksekusi menunggu terlalu lama. Coba jalankan lagi.',
  '0A000': 'Fitur ini tidak didukung dalam konteks tersebut.',
};

const FALLBACK = 'Terjadi kesalahan saat menjalankan SQL. Baca pesan dari PostgreSQL di bawah untuk petunjuknya.';

const MAX_TEXT = 400;

const tidy = (text: string | undefined, schema: string): string | null => {
  if (!text) return null;
  return text.replaceAll(`${schema}.`, '').replaceAll(schema, 'sandbox').slice(0, MAX_TEXT);
};

export const VERIFY_FAILED: SqlErrorView = {
  code: 'VERIFY_FAILED',
  friendly: 'Pernyataan Anda berjalan, tetapi hasilnya tidak dapat diperiksa karena struktur datanya tidak sesuai dengan tugas.',
  message: '',
  detail: null,
  hint: null,
  position: null,
};

export const describeSqlError = (
  error: { code: string; message: string; detail?: string; hint?: string; position?: string },
  schema: string,
  positionOffset = 0,
): SqlErrorView => {
  const raw = error.position ? Number.parseInt(error.position, 10) - positionOffset : Number.NaN;
  return {
    code: error.code,
    friendly: FRIENDLY[error.code] ?? FALLBACK,
    message: tidy(error.message, schema) ?? '',
    detail: tidy(error.detail, schema),
    hint: tidy(error.hint, schema),
    position: Number.isFinite(raw) && raw > 0 ? raw : null,
  };
};
