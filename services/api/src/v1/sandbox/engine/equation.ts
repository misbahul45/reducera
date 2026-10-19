import { Chart } from './chart';
import { EquationEffect, JournalLine } from './types';

const SIGN = { DEBIT: 1, CREDIT: -1 } as const;

export function equationEffect(lines: readonly JournalLine[], chart: Chart): EquationEffect {
  let asset = 0;
  let liability = 0;
  let equity = 0;
  for (const line of lines) {
    const type = chart.get(line.account).type;
    const signed = SIGN[line.side] * line.amount;
    if (type === 'ASSET' || type === 'CONTRA_ASSET') asset += signed;
    else if (type === 'LIABILITY') liability -= signed;
    else equity -= signed;
  }
  return { asset, liability, equity, holds: asset === liability + equity };
}
