export type Cell = string | null;

export interface ResultSet {
  columns: string[];
  rows: Cell[][];
}

export type VerdictCode = 'MATCH' | 'NO_RESULT' | 'COLUMN_COUNT' | 'ROW_COUNT' | 'VALUES' | 'ORDER';

export interface Verdict {
  correct: boolean;
  code: VerdictCode;
  message: string;
}

const NUMERIC = /^-?\d+(?:\.\d+)?$/;

export const normalizeCell = (cell: Cell): string => {
  if (cell === null) return 'null:';
  if (NUMERIC.test(cell)) {
    const negative = cell.startsWith('-');
    const [whole, fraction = ''] = cell.replace('-', '').split('.');
    const trimmedWhole = whole.replace(/^0+(?=\d)/, '');
    const trimmedFraction = fraction.replace(/0+$/, '');
    const body = trimmedFraction ? `${trimmedWhole}.${trimmedFraction}` : trimmedWhole;
    return `num:${negative && body !== '0' ? '-' : ''}${body}`;
  }
  return `text:${cell}`;
};

const rowKey = (row: Cell[]) => JSON.stringify(row.map(normalizeCell));

const sortedKeys = (rows: Cell[][]) => rows.map(rowKey).sort();

const countMatching = (actual: Cell[][], expected: Cell[][]): number => {
  const remaining = new Map<string, number>();
  for (const key of expected.map(rowKey)) remaining.set(key, (remaining.get(key) ?? 0) + 1);
  let matched = 0;
  for (const key of actual.map(rowKey)) {
    const left = remaining.get(key) ?? 0;
    if (left > 0) {
      remaining.set(key, left - 1);
      matched += 1;
    }
  }
  return matched;
};

const plural = (count: number, singular: string) => `${count} ${singular}`;

export const compareResults = (actual: ResultSet | null, expected: ResultSet, ordered: boolean): Verdict => {
  if (!actual || actual.columns.length === 0) {
    return {
      correct: false,
      code: 'NO_RESULT',
      message: 'Pernyataan Anda belum menghasilkan tabel hasil. Periksa apakah tugasnya meminta menampilkan data atau mengubah data.',
    };
  }
  if (actual.columns.length !== expected.columns.length) {
    return {
      correct: false,
      code: 'COLUMN_COUNT',
      message: `Hasil Anda memiliki ${plural(actual.columns.length, 'kolom')}, sedangkan yang diminta ${plural(expected.columns.length, 'kolom')}. Periksa kolom yang Anda pilih.`,
    };
  }
  if (actual.rows.length !== expected.rows.length) {
    return {
      correct: false,
      code: 'ROW_COUNT',
      message: `Hasil Anda memiliki ${plural(actual.rows.length, 'baris')}, sedangkan yang diminta ${plural(expected.rows.length, 'baris')}. Periksa syarat penyaringan atau penggabungan tabel.`,
    };
  }

  const sameContent = JSON.stringify(sortedKeys(actual.rows)) === JSON.stringify(sortedKeys(expected.rows));
  if (!sameContent) {
    const matched = countMatching(actual.rows, expected.rows);
    return {
      correct: false,
      code: 'VALUES',
      message: `Jumlah kolom dan baris sudah sesuai, tetapi isinya belum: ${matched} dari ${plural(expected.rows.length, 'baris')} sudah cocok. Periksa nilai dan syaratnya.`,
    };
  }
  if (ordered && JSON.stringify(actual.rows.map(rowKey)) !== JSON.stringify(expected.rows.map(rowKey))) {
    return {
      correct: false,
      code: 'ORDER',
      message: 'Isi hasil sudah benar, tetapi urutannya belum sesuai permintaan. Periksa ORDER BY.',
    };
  }
  return { correct: true, code: 'MATCH', message: 'Hasil sudah sesuai dengan yang diminta.' };
};
