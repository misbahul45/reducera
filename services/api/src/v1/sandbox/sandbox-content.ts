import { z } from 'zod';
import { ACCOUNT_TYPES, Chart, ChartAccount, JournalLine, isRupiah } from './engine';

const SideSchema = z.enum(['DEBIT', 'CREDIT']);

const LineSchema = z.object({
  account: z.string().min(1),
  side: SideSchema,
  amount: z.number().refine(isRupiah, 'amount must be a whole number of rupiah'),
});

const ChartFileSchema = z.object({
  currency: z.literal('IDR'),
  accounts: z
    .array(
      z.object({
        code: z.string().regex(/^\d{3}$/),
        name: z.string().min(2).max(60),
        type: z.enum(ACCOUNT_TYPES),
        group: z.string().min(1),
        normalSide: SideSchema.nullable(),
      }),
    )
    .min(10),
});

const ExampleSchema = z.object({
  story: z.string().min(10),
  key: z.array(LineSchema).min(2),
  why: z.string().min(5),
});

export const DIFFICULTIES = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'] as const;

const ScenarioSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{3,80}$/),
  level: z.number().int().min(1).max(4),
  difficulty: z.enum(DIFFICULTIES),
  conceptId: z.string().min(1),
  title: z.string().min(3).max(100),
  story: z.string().min(20),
  key: z.array(LineSchema).min(2),
  why: z.string().min(10),
  targets: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  example: ExampleSchema.optional(),
});

const ScenarioFileSchema = z.object({ version: z.literal(1), currency: z.literal('IDR'), scenarios: z.array(ScenarioSchema).min(1) });

export type SandboxScenarioDef = z.infer<typeof ScenarioSchema>;

export class SandboxContentError extends Error {}

export const VARIANT_FACTORS: ReadonlyArray<readonly [number, number]> = [
  [1, 2],
  [4, 5],
  [6, 5],
  [3, 2],
  [2, 1],
  [5, 2],
  [3, 1],
  [4, 1],
];

const AMOUNT_TOKEN = /(?<![\d.])\d{1,3}(?:\.\d{3})+(?!\d)/g;
const UNDOTTED_AMOUNT = /(?<![\d.])\d{4,}(?![\d.])/;

const dotted = (value: number): string => value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');

const scaled = (amount: number, [numerator, denominator]: readonly [number, number]): number | null => {
  const product = amount * numerator;
  if (product % denominator !== 0) return null;
  const value = product / denominator;
  return isRupiah(value) ? value : null;
};

const scaleText = (text: string, factor: readonly [number, number]): string | null => {
  let ok = true;
  const result = text.replace(AMOUNT_TOKEN, (token) => {
    const value = scaled(Number(token.replace(/\./g, '')), factor);
    if (value === null) {
      ok = false;
      return token;
    }
    return dotted(value);
  });
  return ok ? result : null;
};

export interface ScaledScenario {
  scenario: SandboxScenarioDef;
  factor: readonly [number, number];
}

export function scaleScenario(scenario: SandboxScenarioDef, factor: readonly [number, number]): ScaledScenario | null {
  const story = scaleText(scenario.story, factor);
  const why = scaleText(scenario.why, factor);
  if (story === null || why === null) return null;
  const key: JournalLine[] = [];
  for (const line of scenario.key) {
    const amount = scaled(line.amount, factor);
    if (amount === null) return null;
    key.push({ ...line, amount });
  }
  return { scenario: { ...scenario, story, why, key }, factor };
}

export function variantsOf(scenario: SandboxScenarioDef): ScaledScenario[] {
  return VARIANT_FACTORS.map((factor) => scaleScenario(scenario, factor)).filter((value): value is ScaledScenario => value !== null);
}

export function variantFor(scenario: SandboxScenarioDef, seed: number): ScaledScenario | null {
  const variants = variantsOf(scenario);
  if (variants.length === 0 || !Number.isInteger(seed) || seed < 1) return null;
  return variants[(seed - 1) % variants.length] ?? null;
}

const totals = (lines: readonly JournalLine[]) => ({
  debit: lines.filter((line) => line.side === 'DEBIT').reduce((sum, line) => sum + line.amount, 0),
  credit: lines.filter((line) => line.side === 'CREDIT').reduce((sum, line) => sum + line.amount, 0),
});

const assertSolvable = (label: string, lines: readonly JournalLine[], chart: Chart) => {
  for (const line of lines) {
    if (!chart.has(line.account)) throw new SandboxContentError(`${label}: unknown account ${line.account}`);
  }
  const { debit, credit } = totals(lines);
  if (debit !== credit) throw new SandboxContentError(`${label}: key is not balanced (${debit} against ${credit})`);
  if (!lines.some((line) => line.side === 'DEBIT') || !lines.some((line) => line.side === 'CREDIT')) {
    throw new SandboxContentError(`${label}: key needs a debit and a credit line`);
  }
};

export interface SandboxContent {
  chart: Chart;
  scenarios: SandboxScenarioDef[];
}

export function buildSandboxContent(chartFile: unknown, scenarioFile: unknown, knownConceptIds?: ReadonlySet<string>): SandboxContent {
  const parsedChart = ChartFileSchema.safeParse(chartFile);
  if (!parsedChart.success) throw new SandboxContentError(`chart: ${parsedChart.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
  const parsedScenarios = ScenarioFileSchema.safeParse(scenarioFile);
  if (!parsedScenarios.success) throw new SandboxContentError(`scenarios: ${parsedScenarios.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);

  const chart = new Chart(parsedChart.data.accounts as ChartAccount[]);
  const seen = new Set<string>();
  for (const scenario of parsedScenarios.data.scenarios) {
    if (seen.has(scenario.id)) throw new SandboxContentError(`duplicate scenario id ${scenario.id}`);
    seen.add(scenario.id);
    if (knownConceptIds && !knownConceptIds.has(scenario.conceptId)) throw new SandboxContentError(`${scenario.id}: unknown concept ${scenario.conceptId}`);
    assertSolvable(scenario.id, scenario.key, chart);
    if (UNDOTTED_AMOUNT.test(scenario.story) || UNDOTTED_AMOUNT.test(scenario.why)) {
      throw new SandboxContentError(`${scenario.id}: write every amount with dots as thousand separators so variants can scale it`);
    }
    if (scenario.example) assertSolvable(`${scenario.id} example`, scenario.example.key, chart);
  }
  return { chart, scenarios: parsedScenarios.data.scenarios };
}
