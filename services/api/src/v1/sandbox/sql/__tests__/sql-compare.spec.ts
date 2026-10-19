import { ResultSet, compareResults, normalizeCell } from '../sql-compare';

const set = (columns: string[], rows: Array<Array<string | null>>): ResultSet => ({ columns, rows });

describe('normalizeCell', () => {
  it('treats numerically equal values as equal whatever their scale', () => {
    expect(normalizeCell('214300')).toBe(normalizeCell('214300.00000000000000'));
    expect(normalizeCell('0.50')).toBe(normalizeCell('0.5'));
    expect(normalizeCell('-0')).toBe(normalizeCell('0'));
    expect(normalizeCell('007')).toBe(normalizeCell('7'));
  });

  it('keeps text, dates, booleans and NULL apart', () => {
    expect(normalizeCell('2025-04-01')).not.toBe(normalizeCell('2025-4-1'));
    expect(normalizeCell('Bandung')).not.toBe(normalizeCell('bandung'));
    expect(normalizeCell(null)).not.toBe(normalizeCell('null'));
    expect(normalizeCell('true')).not.toBe(normalizeCell('1'));
  });
});

describe('compareResults', () => {
  const expected = set(['nama', 'harga'], [['Jam Tangan Digital', '450000'], ['Sepatu Kets Putih', '349000'], ['Tas Ransel', '275000']]);

  it('accepts the same rows whatever the column names', () => {
    const actual = set(['produk', 'rp'], expected.rows);
    expect(compareResults(actual, expected, true)).toMatchObject({ correct: true, code: 'MATCH' });
  });

  it('accepts a different row order when the order does not matter', () => {
    const actual = set(['nama', 'harga'], [...expected.rows].reverse());
    expect(compareResults(actual, expected, false)).toMatchObject({ correct: true });
  });

  it('refuses a different row order when the task asks for one', () => {
    const actual = set(['nama', 'harga'], [...expected.rows].reverse());
    expect(compareResults(actual, expected, true)).toMatchObject({ correct: false, code: 'ORDER' });
  });

  it('accepts a rounded average that equals the numeric answer', () => {
    expect(compareResults(set(['a'], [['214300']]), set(['a'], [['214300.00000000000000']]), false).correct).toBe(true);
  });

  it('says how many columns and rows differ without showing the answer', () => {
    const fewColumns = compareResults(set(['nama'], [['x'], ['y'], ['z']]), expected, false);
    expect(fewColumns).toMatchObject({ code: 'COLUMN_COUNT' });
    expect(fewColumns.message).toContain('1 kolom');
    expect(fewColumns.message).toContain('2 kolom');

    const fewRows = compareResults(set(['nama', 'harga'], [['a', '1']]), expected, false);
    expect(fewRows).toMatchObject({ code: 'ROW_COUNT' });
    expect(fewRows.message).toContain('1 baris');
    expect(fewRows.message).toContain('3 baris');
  });

  it('counts how many rows already match when the values differ', () => {
    const actual = set(['nama', 'harga'], [['Jam Tangan Digital', '450000'], ['Sepatu Kets Putih', '1'], ['Tas Ransel', '2']]);
    const verdict = compareResults(actual, expected, false);
    expect(verdict).toMatchObject({ correct: false, code: 'VALUES' });
    expect(verdict.message).toContain('1 dari 3 baris');
    expect(verdict.message).not.toContain('Sepatu Kets Putih');
  });

  it('compares duplicate rows as a multiset', () => {
    const doubled = set(['a'], [['1'], ['1'], ['2']]);
    expect(compareResults(set(['a'], [['1'], ['2'], ['2']]), doubled, false).code).toBe('VALUES');
    expect(compareResults(set(['a'], [['2'], ['1'], ['1']]), doubled, false).correct).toBe(true);
  });

  it('has a message for a statement that returned no table', () => {
    expect(compareResults(null, expected, false)).toMatchObject({ correct: false, code: 'NO_RESULT' });
    expect(compareResults(set([], []), expected, false)).toMatchObject({ code: 'NO_RESULT' });
  });

  it('treats an empty expected result as matched only by an empty result', () => {
    const none = set(['a'], []);
    expect(compareResults(set(['a'], []), none, false).correct).toBe(true);
    expect(compareResults(set(['a'], [['1']]), none, false).code).toBe('ROW_COUNT');
  });
});
