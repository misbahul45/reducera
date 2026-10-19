import { Finding } from './types';

export const SANDBOX_MISCONCEPTION_CODES = [
  'debit_credit_swap',
  'normal_balance_confusion',
  'contra_account_confusion',
  'accounting_equation_imbalance',
  'adjusting_entry_error',
  'accrual_cash_confusion',
  'missing_credit_side',
] as const;

export type SandboxMisconception = (typeof SANDBOX_MISCONCEPTION_CODES)[number];

const ACCOUNT_ERRORS = new Set(['WRONG_ACCOUNT_SAME_CLASS', 'WRONG_ACCOUNT_CLASS', 'MISSING_LINE', 'EXTRA_LINE']);

export function misconceptionsOf(findings: readonly Finding[], targets: readonly string[]): SandboxMisconception[] {
  const found = new Set<SandboxMisconception>();
  for (const finding of findings) {
    switch (finding.code) {
      case 'REVERSED_SIDE':
      case 'REVERSED_ALL_SIDES':
        found.add('debit_credit_swap');
        break;
      case 'CONTRA_CONFUSION':
        found.add('contra_account_confusion');
        break;
      case 'UNBALANCED':
        found.add('accounting_equation_imbalance');
        break;
      case 'MISSING_SIDE':
        found.add('missing_credit_side');
        break;
      default:
        if (ACCOUNT_ERRORS.has(finding.code)) {
          if (targets.includes('adjusting_entry_error')) found.add('adjusting_entry_error');
          else if (targets.includes('accrual_cash_confusion')) found.add('accrual_cash_confusion');
        }
    }
  }
  return Array.from(found).slice(0, 3);
}

export const MISCONCEPTION_LABELS: Record<string, string> = {
  debit_credit_swap: 'sering menukar sisi debit dan kredit',
  normal_balance_confusion: 'masih ragu dengan saldo normal akun',
  contra_account_confusion: 'sering tertukar antara akun induk dan akun lawan',
  accounting_equation_imbalance: 'jurnalnya sering belum seimbang',
  adjusting_entry_error: 'jurnal penyesuaian masih sering keliru',
  accrual_cash_confusion: 'masih tertukar antara dasar kas dan dasar akrual',
  missing_credit_side: 'sering lupa mencatat sisi lawan',
};
