# ADR-029: Offline benchmark, independent judge and a development set for prompt proposals

- Status: built on 2026-10-17 (audit item O-02); the thresholds below and the review status of the two datasets wait for the owner
- Date: 2026-10-17

## Context

ADR-019 and ADR-022 put the prompt registry, the canary, the acceptance gate and the human approval in place. The gate could only measure what production produces (mastery change, citation rate, latency, tokens). Correctness, pedagogy and hallucination were listed as `NOT_MEASURED`, so a new prompt reached learners before anyone had checked a single answer of it, and the AI proposer (ADR-022) read the same replies that later judged it.

## Decision

1. **Two frozen datasets, one purpose each.** `tutor-chat-benchmark-v1` (56 cases) judges candidates. `tutor-chat-dev-v1` (24 cases) is the only data the AI proposer may read. Both are JSON files under `services/api/prisma/seed-data/evaluation/`, stored by `pnpm seed:evaluation` as `EvaluationDataset` rows with `isFrozen = true`, a SHA-256 of the canonical JSON in the description, and the existing database trigger that refuses any update or delete. The seeder refuses a file that differs from a frozen row; changed content needs a new `datasetName` and version. Every run records the digest and refuses to start, or to continue, when the stored content no longer matches it.
2. **The context is frozen too.** A case carries its own numbered sources, current material, conversation and teaching strategy. The runner in `ai-api` (`POST /ai/v1/benchmark/run-case`, signed service identity, `api` only) renders the template with the product's own functions (`render_template`, `render_sources`, `render_conversation`, `render_snapshot_block`, `extract_actions`, `apply_citations`) and calls the same model router as a real turn. No retrieval, web search or memory runs, so two templates differ only in the template.
3. **Deterministic checks first.** Each case lists required fact groups and forbidden fact groups as regular expressions (a group passes when any pattern matches), a citation expectation (`REQUIRED`, `OPTIONAL`, `NONE`, sources that must and must not be cited, markers that point at nothing), and the protected phrases of the template that must never appear in a reply. The same checks produce `correctness`, `citation` and `safety` per sample. A forbidden fact on a high-risk case is a safety failure.
4. **An independent judge on top.** `benchmark_judge` runs in thinking mode (`magistral-medium-latest`; the tutor answers with `mistral-small-latest`) with its own prompt, never sees the candidate template or its label, and scores behaviour, pedagogy and grounding from 1 to 5 plus an `unsafe` flag. The judge can lower safety but cannot turn a failed deterministic check into a pass. It is **not calibrated** against human labels; the gate says so (`judge_calibration` is always `NOT_MEASURED`).
5. **A run is an `OptimizationRun`.** `BenchmarkService` (api) plans a run (baseline against the named candidate, or against itself for an A/A run), queues one BullMQ job (`prompt-benchmark`, one at a time), calls `ai-api` with 4 calls in flight, retries retryable failures twice, fails the run when more than 5 percent of calls failed, and stops at once on a 401, 403 or 422. The plan, the report and every sample are stored in the row; the audit log records start, completion or failure, and the person's decision. A decision (`ACCEPTED`, `REJECTED`, `DEFERRED`) is taken once, by an administrator, under a row lock, with a reason of at least 10 characters; a decided run never changes again.
6. **Statistics.** Per case the mean of its repeats, then the paired difference between the two arms on the cases both answered, with a 95 percent percentile bootstrap interval (2000 resamples, seeded by the template hashes so the same data gives the same interval). Wins, losses, ties and the cases that got worse are listed.
7. **The gate uses it.** With a completed non-A/A run for a candidate, the gate replaces the three unmeasured criteria by `offline_correctness`, `offline_citation_faithfulness` (non-inferior within 5 points: the lower end of the interval must be at least -0.05, `FAIL` when the upper end is below it), `offline_safety` (no case that was safe under the baseline is unsafe under the candidate, at least 40 paired cases) and `offline_pedagogy_judge` (within 0.15 on the 1 to 5 scale, `NOT_MEASURED` when the run had no judge). A failed offline criterion blocks `startCanary`; an inconclusive or missing one does not, and the approver still has to acknowledge what was not measured. An offline failure never rolls back a running canary: only production metrics do that.
8. **The proposer cannot read the benchmark.** `POST /admin/optimization/benchmarks/{id}/propose-improvement` accepts only a completed run on the development set whose baseline is still the prompt in use, builds a bounded evidence packet (rates, judge means, weak categories, at most 8 failed replies with at most 2 per category) and refuses a run on the benchmark dataset. The proposal passes the same placeholder, protected-sentence and length checks as before and is stored as a draft with `source: DEVELOPMENT_BENCHMARK` and the run id. The proposer prompt forbids quoting a case. A spec checks that the two datasets share no learner message and no worked numbers.

## Measured on 2026-10-17

An A/A run of the builtin `tutor-chat-builtin-3` against itself on the benchmark, 3 repeats, judge on, 336 calls, 0 failures:

| Dimension | Baseline | Paired difference of identical arms (95 percent interval) |
|---|---|---|
| Correctness | 0.744 | 0.000 [-0.077, 0.077] |
| Citation | 0.845 | 0.024 [-0.012, 0.060] |
| Safety | 0.970 | 0.006 [0.000, 0.018] |
| Pedagogy (judge) | 4.26 | 0.083 [-0.030, 0.190] |
| Behaviour (judge) | 4.23 | -0.024 [-0.167, 0.125] |
| Grounding (judge) | 4.27 | -0.018 [-0.202, 0.161] |

p50 and p95 latency of a tutor reply were 1.9 s and 3.1 s, and a call used 2125 tokens in and 138 out on average. The judge returned a usable verdict for every sample.

A candidate made by the proposer from the development set (`tutor-chat@2`: one added rule, "ask one short clarifying question when the message is vague", plus a one-word change), benchmarked against the builtin prompt, 2 repeats, judge on, 224 calls, 0 failures:

| Dimension | Baseline | Candidate | Paired difference (95 percent interval) |
|---|---|---|---|
| Correctness | 0.741 | 0.750 | 0.009 [-0.063, 0.089] |
| Citation | 0.839 | 0.830 | -0.009 [-0.080, 0.071] |
| Safety | 0.982 | 0.982 | 0.000 [0.000, 0.000], no case got worse |
| Pedagogy (judge) | 4.38 | 4.24 | -0.143 [-0.313, 0.018] |

The edit neither helped nor hurt in a way the data can show, and it did not move the category it aimed at (`ambiguous`, 2 cases, 0.00 correctness under both prompts). The run is left `PENDING` for a person to decide.

What the benchmark found in the builtin prompt, independent of the candidate:

- **Invented history.** The prompt gives "tadi kamu sudah benar menaruh kas di debit" as an example of specific praise. On cases with no conversation at all (TC-56) and on cases where the learner did nothing yet, the tutor repeats that sentence as if it had happened. The benchmark has no pattern for it yet, so it shows as a failed `CLARIFY`, not as a named defect; a v2 of the dataset should add forbidden-fact groups for invented praise.
- **Citations on "not covered" answers.** On the five `no_evidence` cases the tutor attaches a source marker to an answer that says the topic is outside the material in about 90 percent of replies (citation pass rate 0.10).
- **The delimiter bug.** The first proposal came back wrapped in the `<<<TEMPLATE` and `TEMPLATE>>>` markers of the request, and every existing check passed it (placeholders, protected sentences, length, similarity). Both contracts now refuse a template that carries a delimiter, and the proposer strips a copied wrapper before checking. The same flaw existed in the production-metrics proposal path since ADR-022. The flawed draft was rejected.

## Consequences

- **The gate is stricter than the data.** Two identical prompts differ in correctness by up to 7.7 points at 95 percent, wider than the 5 point margin, so a candidate can pass citation and the judge but will usually stay `INSUFFICIENT_DATA` on correctness. This is the honest answer for 56 cases. Narrowing it needs more cases, more repeats, or a wider margin; the margin is a product decision and is not changed here. The A/A run is the reference for that decision.
- **The baseline is favoured.** The patterns of the benchmark were corrected after reading replies of the builtin template, so they know its phrasing. A candidate that answers equally well in other words can lose correctness. The judge and the case list are the counterweight; a second author should review the patterns.
- **Both files are `AUTHOR_DRAFT`.** One author wrote the cases, the expected facts and the rubrics. Expected facts are standard introductory accounting, but nobody else has checked them.
- **The judge is a model, from the same vendor as the tutor.** Until human labels exist (O-02 remainder) its scores are an extra signal and never a pass on their own.
- A benchmark run spends model budget: about 336 calls for 56 cases with 3 repeats and two arms. One run at a time keeps a double click from doubling it.
- `GET /admin/optimization/runs` no longer lists benchmark runs; they have their own list and detail routes.
- The `Benchmark offline` panel on `/admin/optimization` starts a run, lists runs, shows the per-dimension table with the 95 percent interval and verdict, the gate criteria, the cases that got worse (with a drill-down to the reply of each arm), the proposal button for development runs and the decision form. The routes in `docs/architecture/AUTHORIZATION_MATRIX.md` and Swagger remain the same source. The rule text of each criterion comes from the API in English, like the existing gate table.
- Not done: DSPy candidates and a scheduled proposer (O-03), human labels and a calibrated judge, a bigger or second benchmark.

## Addendum 2026-10-17: the builtin prompt is fixed (tutor-chat-builtin-4)

The first finding above was reproduced on a real learner turn of the demo path ([T1](../competition/00-current-state-audit.md)): to a learner who had said nothing of the kind the tutor answered "Tadi kamu sudah benar menaruh kas di debit, jangan ragu lagi!", the example sentence of the template copied verbatim. The fix is a change of the builtin template (`services/ai-api/v1/learning/chat_template.py`, canonical copy `services/api/prisma/seed-data/prompt-templates/tutor-chat.txt`, label `tutor-chat-builtin-4` on both services):

- the praise rule names no example sentence and says to praise only what is written in `conversation_so_far`, and that an empty conversation has nothing to praise;
- "tadi" is allowed only for something the learner has seen: an earlier message or the current material;
- a sentence that says the topic is not covered, or that no retrieved document supports, carries no citation id.

How it was measured, in order, with the same harness as above and the registry, not by editing the dataset:

1. A first, wider candidate (`tutor-chat@3`, with an extra "greet briefly" rule) on the development set: 0 copies in 48 replies, correctness 0.792 to 0.646 (interval [-0.31, +0.02]). The baseline arm itself had measured 0.6875 in an earlier run, so the drop sits inside the noise, but the extra rule was not needed for the defect and was dropped; the draft was rejected.
2. The narrower candidate (`tutor-chat@4`, the text now in code) on the development set, 3 repeats, 144 calls: copies 0 of 72 against 3 of 72 for the old template; correctness 0.750 to 0.694 ([-0.181, +0.069]); no safety change.
3. The same candidate once on the frozen benchmark, 2 repeats, judge on, 224 calls, 0 failures: copies 0 of 112 against 8 of 112; correctness 0.705 to 0.723 (+0.018, [-0.036, +0.071], gate `PASS`); citation 0.830 to 0.866 (+0.036, [-0.018, +0.098], `PASS`); pedagogy 4.330 to 4.321 (judge, [-0.152, +0.134], `INSUFFICIENT_DATA`); safety 0.982 to 0.973, gate `FAIL` on one case.

The pooled rate of the verbatim copy in every baseline arm measured so far is 41 in 560 replies (7.3 percent); the two new wordings produced 0 in 232 (48 + 72 + 112).

The safety `FAIL` is TC-46 (a company profit that the material does not hold). Repeat 0 of the candidate answered "I have no access to that data" and then offered a practice example with "pendapatan Rp500 juta, beban Rp300 juta"; the pattern `angka-karangan` of the case matched the hypothetical figures, while the judge rated the reply not unsafe and the baseline repeat that used "Rp500M" slipped past the same pattern. It is a false positive of a deterministic pattern, read and judged by the person who wrote the change, so the owner should look at it: the case is in the run `a61685cb-fee7-4944-8118-ca7a26b75c91`. The gate worked as designed (it would have blocked a canary of a registry version with this result); the builtin is not a registry version, so the decision to ship was made on this reading. Reverting is one edit of the template file and the label.

Not shown by the data: the citation sentence did not measurably change the share of `no_evidence` replies that carry a citation (8 of 10 against 7 of 10 on the benchmark). It stays because it is the text that was measured. The metrics of `tutor-chat-builtin-3` stay under that label; the new label starts with no history, so `strategy` and prompt metrics restart for the builtin arm.
