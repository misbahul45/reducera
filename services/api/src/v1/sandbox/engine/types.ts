export type Side = 'DEBIT' | 'CREDIT';

export const ACCOUNT_TYPES = [
  'ASSET',
  'CONTRA_ASSET',
  'LIABILITY',
  'EQUITY',
  'DRAWING',
  'SUMMARY',
  'REVENUE',
  'CONTRA_REVENUE',
  'EXPENSE',
  'CONTRA_EXPENSE',
] as const;

export type AccountType = (typeof ACCOUNT_TYPES)[number];

export interface ChartAccount {
  code: string;
  name: string;
  type: AccountType;
  group: string;
  normalSide: Side | null;
}

export interface JournalLine {
  account: string;
  side: Side;
  amount: number;
}

export type LineStatus = 'CORRECT' | 'REVERSED_SIDE' | 'WRONG_AMOUNT' | 'WRONG_ACCOUNT' | 'EXTRA';

export type FindingCode =
  | 'TOO_FEW_LINES'
  | 'MISSING_SIDE'
  | 'UNBALANCED'
  | 'SAME_ACCOUNT_BOTH_SIDES'
  | 'REVERSED_ALL_SIDES'
  | 'REVERSED_SIDE'
  | 'WRONG_AMOUNT'
  | 'TRANSPOSED_DIGITS'
  | 'ZERO_SLIP'
  | 'WRONG_ACCOUNT_SAME_CLASS'
  | 'WRONG_ACCOUNT_CLASS'
  | 'CONTRA_CONFUSION'
  | 'MISSING_LINE'
  | 'EXTRA_LINE';

export type FindingSeverity = 'GLOBAL' | 'FOCUS' | 'POLISH';

export interface Finding {
  code: FindingCode;
  severity: FindingSeverity;
  message: string;
  lineIndexes: number[];
}

export interface LineVerdict {
  index: number;
  status: LineStatus;
}

export interface EquationEffect {
  asset: number;
  liability: number;
  equity: number;
  holds: boolean;
}

export interface Diagnosis {
  correct: boolean;
  balanced: boolean;
  difference: number;
  score: number;
  totalDebit: number;
  totalCredit: number;
  verdicts: LineVerdict[];
  missingBySide: { DEBIT: number; CREDIT: number };
  findings: Finding[];
  equation: EquationEffect;
}

export interface ScenarioKey {
  id: string;
  key: JournalLine[];
}
