import { Chart } from './chart';
import { equationEffect } from './equation';
import { formatRupiah } from './money';
import { Diagnosis, Finding, FindingCode, JournalLine, LineStatus, ScenarioKey, Side } from './types';

interface Position {
  account: string;
  side: Side;
  amount: number;
  indexes: number[];
}

interface Judged {
  position: Position;
  status: LineStatus;
  credit: number;
  finding?: { code: FindingCode; expectedAmount?: number };
}

const SIDE_LABEL: Record<Side, string> = { DEBIT: 'Debit', CREDIT: 'Kredit' };
const OTHER: Record<Side, Side> = { DEBIT: 'CREDIT', CREDIT: 'DEBIT' };
const ZERO_SLIP_FACTORS = new Set([10, 100, 1000, 10000]);

const CREDIT_BY_CODE: Partial<Record<FindingCode, number>> = {
  WRONG_AMOUNT: 0.5,
  TRANSPOSED_DIGITS: 0.5,
  ZERO_SLIP: 0.5,
  WRONG_ACCOUNT_SAME_CLASS: 0.4,
  CONTRA_CONFUSION: 0.4,
  WRONG_ACCOUNT_CLASS: 0.2,
};

const mergePositions = (lines: readonly JournalLine[]): Position[] => {
  const merged = new Map<string, Position>();
  lines.forEach((line, index) => {
    const key = `${line.account}|${line.side}`;
    const existing = merged.get(key);
    if (existing) {
      existing.amount += line.amount;
      existing.indexes.push(index);
    } else {
      merged.set(key, { account: line.account, side: line.side, amount: line.amount, indexes: [index] });
    }
  });
  return Array.from(merged.values());
};

const digitsOf = (value: number): string => String(value).split('').sort().join('');

const amountSlip = (actual: number, expected: number): FindingCode => {
  if (digitsOf(actual) === digitsOf(expected)) return 'TRANSPOSED_DIGITS';
  const high = Math.max(actual, expected);
  const low = Math.min(actual, expected);
  if (high % low === 0 && ZERO_SLIP_FACTORS.has(high / low)) return 'ZERO_SLIP';
  return 'WRONG_AMOUNT';
};

const accountMismatch = (chart: Chart, learner: string, expected: string): FindingCode => {
  const sameClass = chart.classOf(learner) === chart.classOf(expected);
  const contraPair = (chart.isContra(learner) && chart.isBaseOfContra(expected)) || (chart.isContra(expected) && chart.isBaseOfContra(learner));
  if (sameClass && contraPair) return 'CONTRA_CONFUSION';
  return sameClass ? 'WRONG_ACCOUNT_SAME_CLASS' : 'WRONG_ACCOUNT_CLASS';
};

const take = (pool: Position[], predicate: (candidate: Position) => boolean): Position | undefined => {
  const at = pool.findIndex(predicate);
  return at === -1 ? undefined : pool.splice(at, 1)[0];
};

const judge = (learner: Position[], expected: Position[], chart: Chart): { judged: Judged[]; unmatched: Position[] } => {
  const pool = expected.map((position) => ({ ...position }));
  const judged: Judged[] = [];
  const waiting: Position[] = [];

  for (const position of learner) {
    const hit = take(pool, (e) => e.account === position.account && e.side === position.side && e.amount === position.amount);
    if (hit) judged.push({ position, status: 'CORRECT', credit: 1 });
    else waiting.push(position);
  }

  const stillWaiting: Position[] = [];
  for (const position of waiting) {
    const hit = take(pool, (e) => e.account === position.account && e.side === position.side);
    if (!hit) {
      stillWaiting.push(position);
      continue;
    }
    const code = amountSlip(position.amount, hit.amount);
    judged.push({
      position,
      status: 'WRONG_AMOUNT',
      credit: CREDIT_BY_CODE[code] ?? 0.5,
      finding: { code, expectedAmount: hit.amount },
    });
  }

  const afterReversal: Position[] = [];
  for (const position of stillWaiting) {
    const hit = take(pool, (e) => e.account === position.account && e.side === OTHER[position.side]);
    if (!hit) {
      afterReversal.push(position);
      continue;
    }
    judged.push({
      position,
      status: 'REVERSED_SIDE',
      credit: hit.amount === position.amount ? 0.3 : 0.15,
      finding: { code: 'REVERSED_SIDE', expectedAmount: hit.amount },
    });
  }

  const afterAccount: Position[] = [];
  for (const position of afterReversal) {
    const hit = take(pool, (e) => e.side === position.side && e.amount === position.amount);
    if (!hit) {
      afterAccount.push(position);
      continue;
    }
    const code = accountMismatch(chart, position.account, hit.account);
    judged.push({ position, status: 'WRONG_ACCOUNT', credit: CREDIT_BY_CODE[code] ?? 0.2, finding: { code } });
  }

  for (const position of afterAccount) {
    const hit = take(pool, (e) => e.side === position.side);
    if (!hit) {
      judged.push({ position, status: 'EXTRA', credit: 0 });
      continue;
    }
    const code = accountMismatch(chart, position.account, hit.account);
    judged.push({ position, status: 'WRONG_ACCOUNT', credit: (CREDIT_BY_CODE[code] ?? 0.2) / 2, finding: { code } });
  }

  return { judged, unmatched: pool };
};

const findingFor = (judgedLine: Judged, chart: Chart): Finding => {
  const { position, finding } = judgedLine;
  const name = chart.nameOf(position.account);
  const side = SIDE_LABEL[position.side];
  const lineIndexes = position.indexes;
  switch (finding?.code) {
    case 'REVERSED_SIDE':
      return {
        code: 'REVERSED_SIDE',
        severity: 'FOCUS',
        lineIndexes,
        message: `${name} dicatat di sisi ${side}, tetapi sisinya belum tepat. Tanyakan: akun ini bertambah atau berkurang, dan di sisi mana saldo normalnya?`,
      };
    case 'TRANSPOSED_DIGITS':
      return { code: 'TRANSPOSED_DIGITS', severity: 'POLISH', lineIndexes, message: `Urutan digit pada jumlah ${name} (${side}) tampaknya tertukar.` };
    case 'ZERO_SLIP':
      return { code: 'ZERO_SLIP', severity: 'POLISH', lineIndexes, message: `Jumlah ${name} (${side}) tampaknya kelebihan atau kekurangan angka nol.` };
    case 'WRONG_AMOUNT':
      return { code: 'WRONG_AMOUNT', severity: 'FOCUS', lineIndexes, message: `Jumlah ${name} di sisi ${side} belum tepat. Hitung ulang dari angka di cerita transaksi.` };
    case 'CONTRA_CONFUSION':
      return {
        code: 'CONTRA_CONFUSION',
        severity: 'FOCUS',
        lineIndexes,
        message: `${name} di sisi ${side} tertukar dengan akun lawannya (akun kontra) atau akun induknya. Periksa apakah transaksi ini memakai akun pokok atau akun lawan.`,
      };
    case 'WRONG_ACCOUNT_SAME_CLASS':
      return {
        code: 'WRONG_ACCOUNT_SAME_CLASS',
        severity: 'FOCUS',
        lineIndexes,
        message: `${name} di sisi ${side} satu kelompok dengan akun yang dimaksud, tetapi judul akunnya belum paling tepat. Bandingkan dengan akun serupa di daftar.`,
      };
    case 'WRONG_ACCOUNT_CLASS':
      return {
        code: 'WRONG_ACCOUNT_CLASS',
        severity: 'FOCUS',
        lineIndexes,
        message: `${name} termasuk kelompok ${chart.classOf(position.account)}, tetapi baris ${side} ini seharusnya dari kelompok lain. Tinjau dampak transaksi pada persamaan akuntansi.`,
      };
    default:
      return {
        code: 'EXTRA_LINE',
        severity: 'FOCUS',
        lineIndexes,
        message: `${name} di sisi ${side} tidak diperlukan untuk transaksi ini.`,
      };
  }
};

const SEVERITY_ORDER = { GLOBAL: 0, FOCUS: 1, POLISH: 2 } as const;

export function evaluateJournal(lines: readonly JournalLine[], scenario: ScenarioKey, chart: Chart): Diagnosis {
  const totalDebit = lines.filter((line) => line.side === 'DEBIT').reduce((sum, line) => sum + line.amount, 0);
  const totalCredit = lines.filter((line) => line.side === 'CREDIT').reduce((sum, line) => sum + line.amount, 0);
  const difference = Math.abs(totalDebit - totalCredit);
  const balanced = difference === 0;

  const learner = mergePositions(lines);
  const expected = mergePositions(scenario.key);
  const { judged, unmatched } = judge(learner, expected, chart);

  const missingBySide = { DEBIT: 0, CREDIT: 0 };
  for (const position of unmatched) missingBySide[position.side] += 1;

  const findings: Finding[] = [];

  if (lines.length < 2) {
    findings.push({ code: 'TOO_FEW_LINES', severity: 'GLOBAL', lineIndexes: [], message: 'Jurnal memerlukan paling sedikit dua baris: satu di sisi debit dan satu di sisi kredit.' });
  }
  const noDebit = totalDebit === 0 && lines.length > 0;
  const noCredit = totalCredit === 0 && lines.length > 0;
  if (noDebit || noCredit) {
    findings.push({
      code: 'MISSING_SIDE',
      severity: 'GLOBAL',
      lineIndexes: [],
      message: `Semua barismu ada di sisi ${noCredit ? 'debit' : 'kredit'}. Setiap transaksi punya dua sisi yang sama besar.`,
    });
  }
  if (!balanced && lines.length > 0) {
    findings.push({
      code: 'UNBALANCED',
      severity: 'GLOBAL',
      lineIndexes: [],
      message: `Total debit ${formatRupiah(totalDebit)} dan total kredit ${formatRupiah(totalCredit)} berbeda ${formatRupiah(difference)}. Dalam pembukuan berpasangan keduanya harus sama.`,
    });
  }
  const sideByAccount = new Map<string, Set<Side>>();
  for (const line of lines) sideByAccount.set(line.account, (sideByAccount.get(line.account) ?? new Set()).add(line.side));
  const expectedBothSides = new Set(expected.filter((p) => expected.some((q) => q.account === p.account && q.side !== p.side)).map((p) => p.account));
  for (const [account, sides] of sideByAccount) {
    if (sides.size === 2 && !expectedBothSides.has(account)) {
      findings.push({
        code: 'SAME_ACCOUNT_BOTH_SIDES',
        severity: 'FOCUS',
        lineIndexes: lines.flatMap((line, index) => (line.account === account ? [index] : [])),
        message: `${chart.nameOf(account)} muncul di sisi debit dan kredit sekaligus. Biasanya satu akun hanya berada di satu sisi dalam satu jurnal.`,
      });
    }
  }

  const everyLineReversed = judged.length > 0 && judged.every((item) => item.status === 'REVERSED_SIDE') && unmatched.length === 0;
  if (everyLineReversed) {
    findings.push({
      code: 'REVERSED_ALL_SIDES',
      severity: 'GLOBAL',
      lineIndexes: judged.flatMap((item) => item.position.indexes),
      message: 'Semua sisi tampak tertukar: yang kamu debit seharusnya dikredit dan sebaliknya. Periksa lagi apakah tiap akun bertambah atau berkurang.',
    });
  } else {
    for (const item of judged) {
      if (item.status !== 'CORRECT') findings.push(findingFor(item, chart));
    }
  }

  for (const side of ['DEBIT', 'CREDIT'] as const) {
    const reportedAsMissingSide = (side === 'DEBIT' && noDebit) || (side === 'CREDIT' && noCredit);
    if (missingBySide[side] > 0 && !reportedAsMissingSide) {
      findings.push({
        code: 'MISSING_LINE',
        severity: 'FOCUS',
        lineIndexes: [],
        message: `Masih kurang ${missingBySide[side]} baris di sisi ${SIDE_LABEL[side]}.`,
      });
    }
  }

  findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  const verdictByIndex = new Map<number, LineStatus>();
  for (const item of judged) for (const index of item.position.indexes) verdictByIndex.set(index, item.status);
  const verdicts = lines.map((_, index) => ({ index, status: verdictByIndex.get(index) ?? ('EXTRA' as LineStatus) }));

  const denominator = Math.max(expected.length, learner.length);
  const earned = judged.reduce((sum, item) => sum + item.credit, 0);
  const everyExact = judged.every((item) => item.status === 'CORRECT') && unmatched.length === 0;
  const correct = everyExact && balanced && lines.length >= 2;
  const rawScore = denominator === 0 ? 0 : earned / denominator;
  const score = correct ? 1 : Math.min(0.95, Math.round(rawScore * 100) / 100);

  return {
    correct,
    balanced,
    difference,
    score,
    totalDebit,
    totalCredit,
    verdicts,
    missingBySide,
    findings,
    equation: equationEffect(lines, chart),
  };
}
