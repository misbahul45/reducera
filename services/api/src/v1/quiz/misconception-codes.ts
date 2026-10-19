export const MISCONCEPTION_CODES = [
  'debit_credit_swap',
  'normal_balance_confusion',
  'contra_account_confusion',
  'accounting_equation_imbalance',
  'trial_balance_imbalance',
  'adjusting_entry_error',
  'accrual_cash_confusion',
  'financial_statement_mapping_error',
  'missing_credit_side',
] as const;

export type MisconceptionCode = (typeof MISCONCEPTION_CODES)[number];

const KNOWN: ReadonlySet<string> = new Set(MISCONCEPTION_CODES);

export const isMisconceptionCode = (value: unknown): value is MisconceptionCode => typeof value === 'string' && KNOWN.has(value);

export const tagDistractors = (options: readonly string[], correctAnswer: string, tags: Record<string, string> | undefined): Record<string, MisconceptionCode> => {
  const kept: Record<string, MisconceptionCode> = {};
  for (const [option, code] of Object.entries(tags ?? {})) {
    if (option === correctAnswer || !options.includes(option) || !isMisconceptionCode(code)) continue;
    kept[option] = code;
  }
  return kept;
};

export const distractorCodeOf = (distractors: unknown, userAnswer: unknown): MisconceptionCode | null => {
  if (typeof userAnswer !== 'string' || distractors === null || typeof distractors !== 'object' || Array.isArray(distractors)) return null;
  const code = (distractors as Record<string, unknown>)[userAnswer.trim()];
  return isMisconceptionCode(code) ? code : null;
};
