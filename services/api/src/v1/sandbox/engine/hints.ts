import { Chart } from './chart';
import { JournalLine, Side } from './types';

export const HINT_LEVELS = 3;

const SIDE_LABEL: Record<Side, string> = { DEBIT: 'Debit', CREDIT: 'Kredit' };

const unique = <T>(values: T[]): T[] => Array.from(new Set(values));

const movementOf = (line: JournalLine, chart: Chart): string => {
  const normal = chart.normalSide(line.account);
  const klass = chart.classOf(line.account);
  if (normal === null) return `${klass} (akun penutup)`;
  return `${klass} ${line.side === normal ? 'bertambah' : 'berkurang'}`;
};

export function buildHints(key: readonly JournalLine[], chart: Chart): [string, string, string] {
  const movements = new Map<string, number>();
  for (const line of key) {
    const label = movementOf(line, chart);
    movements.set(label, (movements.get(label) ?? 0) + 1);
  }
  const analysis = Array.from(movements.entries())
    .map(([label, count]) => (count > 1 ? `${count} akun ${label}` : `satu akun ${label}`))
    .join(', ');

  const debits = key.filter((line) => line.side === 'DEBIT');
  const credits = key.filter((line) => line.side === 'CREDIT');
  const classesOf = (lines: JournalLine[]) => unique(lines.map((line) => chart.classOf(line.account))).join(' dan ');
  const structure = `Jurnal ini punya ${key.length} baris: ${debits.length} di sisi Debit (akun ${classesOf(debits)}) dan ${credits.length} di sisi Kredit (akun ${classesOf(credits)}).`;

  const names = unique([...debits, ...credits].map((line) => chart.nameOf(line.account))).join(', ');

  return [
    `Mulai dari dampak pada persamaan akuntansi. Yang berubah: ${analysis}.`,
    structure,
    `Akun yang dipakai: ${names}. Tentukan sendiri sisi dan jumlahnya.`,
  ];
}

export const describeKey = (key: readonly JournalLine[], chart: Chart) =>
  key.map((line) => ({ account: line.account, name: chart.nameOf(line.account), side: line.side, sideLabel: SIDE_LABEL[line.side], amount: line.amount }));
