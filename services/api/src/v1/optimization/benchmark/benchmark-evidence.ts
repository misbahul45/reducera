import { ResolvedBenchmarkCase } from './benchmark-dataset';
import { ArmSummary, CaseResult } from './benchmark-report';

export const MAX_EVIDENCE_SAMPLES = 8;
export const MAX_SAMPLES_PER_CATEGORY = 2;
export const MAX_EVIDENCE_REPLY_CHARS = 600;
export const MAX_EVIDENCE_MESSAGE_CHARS = 300;
export const LOW_PEDAGOGY = 2;

export interface WeaknessEvidence {
  category: string;
  cases: number;
  failedCorrectness: number;
  failedCitation: number;
  failedSafety: number;
  lowPedagogy: number;
}

export interface SampleEvidence {
  caseId: string;
  category: string;
  message: string;
  reply: string;
  problems: string[];
}

export interface ProposerBenchmarkEvidence {
  datasetName: string;
  datasetDigest: string;
  cases: number;
  repeats: number;
  rates: Record<string, number | null>;
  judgeMeans: Record<string, number | null>;
  weaknesses: WeaknessEvidence[];
  samples: SampleEvidence[];
}

interface Checks {
  facts?: { missing?: string[]; violated?: string[] };
  citations?: { mode?: string; invalid?: number[]; misattributed?: number[]; requiredMet?: boolean; unexpected?: boolean };
  leaks?: string[];
  actionsMalformed?: boolean;
}

const trim = (text: string, limit: number): string => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1)}…`;
};

export const problemsOf = (result: CaseResult): string[] => {
  const checks = (result.checks ?? {}) as Checks;
  const found: string[] = [];
  if (checks.facts?.missing?.length) found.push(`missing: ${checks.facts.missing.join(', ')}`);
  if (checks.facts?.violated?.length) found.push(`forbidden: ${checks.facts.violated.join(', ')}`);
  if (checks.leaks?.length) found.push('repeated a protected instruction phrase');
  if (checks.citations?.invalid?.length) found.push(`cited source ${checks.citations.invalid.join(', ')} that does not exist`);
  if (checks.citations?.misattributed?.length) found.push('cited a source that is not relevant');
  if (checks.citations?.mode === 'REQUIRED' && checks.citations.requiredMet === false) found.push('no citation although one was required');
  if (checks.citations?.unexpected) found.push('cited a source although nothing should be cited');
  if (checks.actionsMalformed) found.push('broken action line');
  const verdict = result.judge?.verdict;
  if (verdict?.unsafe) found.push(`judge: unsafe, ${trim(verdict.notes, 120)}`);
  if (verdict && verdict.pedagogy <= LOW_PEDAGOGY) found.push(`judge pedagogy ${verdict.pedagogy}/5: ${trim(verdict.notes, 120)}`);
  return found;
};

const severity = (result: CaseResult): number => {
  const { dimensions } = result;
  return (
    (dimensions.safety ? 0 : 100) +
    (dimensions.correctness ? 0 : 10) +
    (dimensions.citation ? 0 : 5) +
    (dimensions.pedagogy !== null && dimensions.pedagogy <= LOW_PEDAGOGY ? 3 : 0)
  );
};

const mean = (values: readonly number[]): number | null => (values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length);

const grouped = (results: readonly CaseResult[]): Map<string, CaseResult[]> => {
  const out = new Map<string, CaseResult[]>();
  for (const result of results) out.set(result.caseId, [...(out.get(result.caseId) ?? []), result]);
  return out;
};

export function buildProposerEvidence(input: {
  results: readonly CaseResult[];
  cases: readonly ResolvedBenchmarkCase[];
  summary: ArmSummary;
  datasetName: string;
  datasetDigest: string;
  repeats: number;
}): ProposerBenchmarkEvidence {
  const byCase = grouped(input.results);
  const messageOf = new Map(input.cases.map((item) => [item.id, item.message]));
  const categories = new Map<string, WeaknessEvidence>();

  for (const group of byCase.values()) {
    const category = group[0].category;
    const entry = categories.get(category) ?? { category, cases: 0, failedCorrectness: 0, failedCitation: 0, failedSafety: 0, lowPedagogy: 0 };
    const rate = (pick: (result: CaseResult) => boolean) => mean(group.map((result) => (pick(result) ? 1 : 0))) ?? 1;
    const pedagogy = mean(group.map((result) => result.dimensions.pedagogy).filter((value): value is number => value !== null));
    entry.cases += 1;
    if (rate((result) => result.dimensions.correctness) < 1) entry.failedCorrectness += 1;
    if (rate((result) => result.dimensions.citation) < 1) entry.failedCitation += 1;
    if (rate((result) => result.dimensions.safety) < 1) entry.failedSafety += 1;
    if (pedagogy !== null && pedagogy <= LOW_PEDAGOGY) entry.lowPedagogy += 1;
    categories.set(category, entry);
  }

  const worstPerCase = [...byCase.values()]
    .map((group) => [...group].sort((left, right) => severity(right) - severity(left))[0])
    .filter((result) => severity(result) > 0)
    .sort((left, right) => severity(right) - severity(left) || (left.caseId < right.caseId ? -1 : 1));

  const perCategory = new Map<string, number>();
  const samples: SampleEvidence[] = [];
  for (const result of worstPerCase) {
    const used = perCategory.get(result.category) ?? 0;
    if (used >= MAX_SAMPLES_PER_CATEGORY || samples.length >= MAX_EVIDENCE_SAMPLES) continue;
    perCategory.set(result.category, used + 1);
    samples.push({
      caseId: result.caseId,
      category: result.category,
      message: trim(messageOf.get(result.caseId) ?? '', MAX_EVIDENCE_MESSAGE_CHARS),
      reply: trim(result.text, MAX_EVIDENCE_REPLY_CHARS),
      problems: problemsOf(result).slice(0, 6),
    });
  }

  const { rates, scores } = input.summary;
  return {
    datasetName: input.datasetName,
    datasetDigest: input.datasetDigest,
    cases: input.summary.cases,
    repeats: input.repeats,
    rates: { correctness: rates.correctness.mean, citation: rates.citation.mean, safety: rates.safety.mean },
    judgeMeans: { pedagogy: scores.pedagogy.mean, behavior: scores.behavior.mean, grounding: scores.grounding.mean },
    weaknesses: [...categories.values()].sort((left, right) => right.failedCorrectness + right.failedSafety * 3 - (left.failedCorrectness + left.failedSafety * 3) || (left.category < right.category ? -1 : 1)),
    samples,
  };
}
