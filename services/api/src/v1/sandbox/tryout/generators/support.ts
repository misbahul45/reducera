import { Rng } from '../rng';
import { ItemDraft } from '../tryout-types';

export const OPTION_LABELS = ['A', 'B', 'C', 'D', 'E'] as const;

export const gcd = (a: number, b: number): number => (b === 0 ? Math.abs(a) : gcd(b, a % b));

export const lcm = (a: number, b: number): number => (a / gcd(a, b)) * b;

export const formatNumber = (value: number): string => {
  const negative = value < 0;
  const [whole, fraction] = Math.abs(value).toString().split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negative ? '-' : ''}${grouped}${fraction ? `,${fraction}` : ''}`;
};

export const rupiah = (value: number): string => `Rp${formatNumber(value)}`;

export const fraction = (numerator: number, denominator: number): string => {
  const divisor = gcd(numerator, denominator) || 1;
  const n = numerator / divisor;
  const d = denominator / divisor;
  return d === 1 ? `${n}` : `${n}/${d}`;
};

export const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

export const OPTIONS_PER_ITEM = 5;

export class Retryable extends Error {}

export class DistractorShortage extends Retryable {}

export const buildChoices = (rng: Rng, correct: string, distractors: readonly string[], count = OPTIONS_PER_ITEM) => {
  const seen = new Set<string>([correct]);
  const wrong: string[] = [];
  for (const candidate of distractors) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    wrong.push(candidate);
    if (wrong.length === count - 1) break;
  }
  if (wrong.length < count - 1) throw new DistractorShortage(`Only ${wrong.length} distinct distractors for ${correct}`);
  const options = rng.shuffle([correct, ...wrong]);
  return { options, answer: options.indexOf(correct) };
};

export const numericChoices = (rng: Rng, correct: number, candidates: readonly number[], format: (value: number) => string = formatNumber) => {
  const near = [correct + 1, correct - 1, correct + 2, correct - 2, correct + 10, correct * 2, Math.round(correct / 2) + 3];
  const pool = [...candidates, ...rng.shuffle(near)].filter((value) => Number.isFinite(value) && value !== correct && (value >= 0 || correct < 0));
  return buildChoices(
    rng,
    format(correct),
    pool.map((value) => format(value)),
  );
};

export type Generator = (rng: Rng) => ItemDraft;

export const generateMany = (rng: Rng, count: number, makers: readonly Generator[]): ItemDraft[] => {
  const items: ItemDraft[] = [];
  let order: Generator[] = [];
  const seen = new Set<string>();
  let guard = 0;
  while (items.length < count && guard < count * 40) {
    guard += 1;
    if (order.length === 0) order = rng.shuffle(makers);
    const maker = order.shift() as Generator;
    let draft: ItemDraft;
    try {
      draft = maker(rng);
    } catch (error) {
      if (error instanceof Retryable) continue;
      throw error;
    }
    if (seen.has(draft.stem)) continue;
    seen.add(draft.stem);
    items.push(draft);
  }
  if (items.length < count) throw new Error(`Could only generate ${items.length} of ${count} distinct items`);
  return items;
};
