import { ResolvedBenchmarkCase } from '../benchmark-dataset';
import { ArmSummary, CaseDimensions, CaseResult } from '../benchmark-report';
import { MAX_EVIDENCE_MESSAGE_CHARS, MAX_EVIDENCE_REPLY_CHARS, MAX_EVIDENCE_SAMPLES, MAX_SAMPLES_PER_CATEGORY, buildProposerEvidence, problemsOf } from '../benchmark-evidence';

const dims = (over: Partial<CaseDimensions> = {}): CaseDimensions => ({ correctness: true, coverage: 1, citation: true, safety: true, pedagogy: null, behavior: null, grounding: null, ...over });

const result = (caseId: string, over: Partial<CaseResult> & { dims?: Partial<CaseDimensions> } = {}): CaseResult => {
  const { dims: dimOver, ...rest } = over;
  return {
    caseId,
    category: 'concept',
    risk: 'standard',
    repeat: 0,
    templateLabel: 't',
    templateHash: 'h',
    model: 'm',
    mode: 'flash',
    escalated: false,
    tokensIn: 1,
    tokensOut: 1,
    latencyMs: 1,
    text: 'Coba hitung dulu ya.',
    citationsShown: [],
    actions: [],
    checks: { facts: { missing: [], violated: [] }, citations: { mode: 'OPTIONAL', invalid: [], misattributed: [], requiredMet: true, unexpected: false }, leaks: [] },
    judge: null,
    judgeError: null,
    dimensions: dims(dimOver),
    ...rest,
  };
};

const item = (id: string, message = `Pertanyaan ${id}`): ResolvedBenchmarkCase => ({ id, message }) as ResolvedBenchmarkCase;

const summary = {
  cases: 4,
  rates: { correctness: { mean: 0.5, lower: 0.3, upper: 0.7 }, citation: { mean: 0.75, lower: 0.5, upper: 1 }, safety: { mean: 1, lower: 1, upper: 1 } },
  scores: { pedagogy: { mean: 3.2, judged: 4 }, behavior: { mean: 3.9, judged: 4 }, grounding: { mean: null, judged: 0 } },
} as unknown as ArmSummary;

const build = (results: CaseResult[], cases: ResolvedBenchmarkCase[] = results.map((entry) => item(entry.caseId))) =>
  buildProposerEvidence({ results, cases, summary, datasetName: 'tutor-chat-dev-v1', datasetDigest: 'd'.repeat(64), repeats: 2 });

describe('problemsOf', () => {
  it('names every deterministic problem in plain words', () => {
    const problems = problemsOf(
      result('TD-01', {
        checks: {
          facts: { missing: ['hasil', 'hitungan'], violated: ['jawaban'] },
          citations: { mode: 'REQUIRED', invalid: [9], misattributed: [2], requiredMet: false, unexpected: false },
          leaks: ['domain_taxonomy'],
          actionsMalformed: true,
        },
      }),
    );

    expect(problems).toEqual([
      'missing: hasil, hitungan',
      'forbidden: jawaban',
      'repeated a protected instruction phrase',
      'cited source 9 that does not exist',
      'cited a source that is not relevant',
      'no citation although one was required',
      'broken action line',
    ]);
  });

  it('adds what the judge said when it scored pedagogy low or called the reply unsafe, shortened', () => {
    const judge = { version: 'judge-v1', model: 'm', verdict: { behavior: 3, pedagogy: 2, grounding: 3, unsafe: true, notes: 'x'.repeat(300) } };

    const problems = problemsOf(result('TD-01', { judge }));

    expect(problems[0]).toMatch(/^judge: unsafe, x+…$/);
    expect(problems[1]).toMatch(/^judge pedagogy 2\/5: x+…$/);
    expect(problems[0].length).toBeLessThan(160);
  });

  it('is empty for a reply with nothing wrong', () => {
    expect(problemsOf(result('TD-01'))).toEqual([]);
  });
});

describe('buildProposerEvidence', () => {
  it('copies the measured rates and judge means and counts the weak cases per category', () => {
    const evidence = build([
      result('TD-01', { category: 'worked_example', dims: { correctness: false } }),
      result('TD-02', { category: 'worked_example' }),
      result('TD-03', { category: 'concept', dims: { citation: false } }),
      result('TD-04', { category: 'safety', dims: { safety: false } }),
    ]);

    expect(evidence).toMatchObject({ datasetName: 'tutor-chat-dev-v1', datasetDigest: 'd'.repeat(64), cases: 4, repeats: 2 });
    expect(evidence.rates).toEqual({ correctness: 0.5, citation: 0.75, safety: 1 });
    expect(evidence.judgeMeans).toEqual({ pedagogy: 3.2, behavior: 3.9, grounding: null });
    expect(evidence.weaknesses).toEqual([
      { category: 'safety', cases: 1, failedCorrectness: 0, failedCitation: 0, failedSafety: 1, lowPedagogy: 0 },
      { category: 'worked_example', cases: 2, failedCorrectness: 1, failedCitation: 0, failedSafety: 0, lowPedagogy: 0 },
      { category: 'concept', cases: 1, failedCorrectness: 0, failedCitation: 1, failedSafety: 0, lowPedagogy: 0 },
    ]);
  });

  it('counts a case as weak when any repeat failed and ignores the order of the repeats', () => {
    const evidence = build([result('TD-01', { repeat: 0 }), result('TD-01', { repeat: 1, dims: { correctness: false } })]);

    expect(evidence.weaknesses[0].failedCorrectness).toBe(1);
    expect(evidence.samples).toHaveLength(1);
  });

  it('counts low pedagogy from the mean of the judged repeats', () => {
    const evidence = build([result('TD-01', { dims: { pedagogy: 2 } }), result('TD-01', { repeat: 1, dims: { pedagogy: 1 } }), result('TD-02', { dims: { pedagogy: 4 } })]);

    expect(evidence.weaknesses[0].lowPedagogy).toBe(1);
  });

  it('shows only cases that failed, the worst first, with the learner message, and the worst repeat of a case', () => {
    const evidence = build(
      [
        result('TD-01', { text: 'fine' }),
        result('TD-02', { text: 'minor', category: 'misconception', dims: { citation: false } }),
        result('TD-03', { text: 'unsafe one', dims: { safety: false, correctness: false } }),
        result('TD-04', { text: 'first repeat is fine', repeat: 0 }),
        result('TD-04', { text: 'second repeat is wrong', repeat: 1, dims: { correctness: false } }),
      ],
      [item('TD-01'), item('TD-02'), item('TD-03', 'Pesan pelajar tiga'), item('TD-04')],
    );

    expect(evidence.samples.map((sample) => sample.caseId)).toEqual(['TD-03', 'TD-04', 'TD-02']);
    expect(evidence.samples[0]).toMatchObject({ message: 'Pesan pelajar tiga', reply: 'unsafe one', category: 'concept' });
    expect(evidence.samples[1].reply).toBe('second repeat is wrong');
  });

  it('shows no more than two cases of a category and no more than eight cases in all', () => {
    const many = Array.from({ length: 30 }, (_, index) => result(`TD-${String(index + 1).padStart(2, '0')}`, { category: `c${index % 6}`, dims: { correctness: false } }));

    const { samples } = build(many);

    expect(samples.length).toBeLessThanOrEqual(MAX_EVIDENCE_SAMPLES);
    for (const category of new Set(samples.map((sample) => sample.category))) {
      expect(samples.filter((sample) => sample.category === category).length).toBeLessThanOrEqual(MAX_SAMPLES_PER_CATEGORY);
    }
    expect(new Set(samples.map((sample) => sample.category)).size).toBeGreaterThan(3);
  });

  it('shortens long messages and replies and collapses their white space', () => {
    const evidence = build([result('TD-01', { text: `${'kata '.repeat(400)}\n\n selesai`, dims: { correctness: false } })], [item('TD-01', 'pesan   panjang '.repeat(80))]);

    expect(evidence.samples[0].reply.length).toBeLessThanOrEqual(MAX_EVIDENCE_REPLY_CHARS);
    expect(evidence.samples[0].message.length).toBeLessThanOrEqual(MAX_EVIDENCE_MESSAGE_CHARS);
    expect(evidence.samples[0].reply).not.toMatch(/\n/);
    expect(evidence.samples[0].reply.endsWith('…')).toBe(true);
  });

  it('has nothing to show when no case failed', () => {
    const evidence = build([result('TD-01'), result('TD-02')]);

    expect(evidence.samples).toEqual([]);
    expect(evidence.weaknesses.every((weakness) => weakness.failedCorrectness + weakness.failedCitation + weakness.failedSafety + weakness.lowPedagogy === 0)).toBe(true);
  });
});
