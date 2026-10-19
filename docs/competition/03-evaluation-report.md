# Evaluation Report: Tutor Prompt Benchmark

> **Status**: `in-progress` · **Owner**: `ml-lead` · **Last reviewed**: `2026-10-17`
>
> What the frozen benchmark measured, with its numbers, its noise, its limits, and the commands that reproduce it. Design decisions are in [ADR-029](../decisions/ADR-029-offline-benchmark-judge-and-development-set.md).

---

## 1. Summary

| Question | Answer |
|---|---|
| Is there a frozen benchmark with real model outputs? | Yes. `tutor-chat-benchmark-v1` (56 cases) and `tutor-chat-dev-v1` (24 cases), hashes in section 3. Six completed runs, every answer produced by the live model router, 0 failed calls |
| Is the candidate better than the baseline? | **Not shown.** No quality dimension has an interval entirely above zero. The best run, `a61685cb-…`, gives correctness +1.8 points [-3.6, +7.1] and citation +3.6 points [-1.8, +9.8] |
| Is the candidate worse? | Not shown either, except that the safety criterion reports `FAIL` on one case (TC-46), which is read as a pattern false positive and waits for the owner |
| What did the benchmark find that matters? | The built-in prompt copied its own example sentence as invented praise in 41 of 560 baseline replies (7.3 percent); the rewritten wording did so in 0 of 232 |
| Is the judge calibrated? | No. 0 human labels exist, so no agreement figure is claimed |
| Does the gate decide? | No. All six runs are `PENDING`; a person records the decision. Nothing was activated or canaried |

The honest positioning of the result: the benchmark works as a regression and defect detector, and it measured a real defect; with the present sample size its interval is wider than the 5-point margin of the gate, so most candidates end as `INSUFFICIENT_DATA`.

---

## 2. Method

| Element | Setting | Evidence |
|---|---|---|
| Cases | Own sources, material, conversation and teaching strategy per case, so both arms see the same context | ADR-029 decision 2 |
| Arms | Baseline = the prompt in use at the time (`tutor-chat-builtin-3`); candidate = a registry draft, or the baseline again for an A/A run | `BenchmarkService` |
| Tutor model | `mistral-small-latest` through the OpenAI-compatible gateway (flash mode) | `.env.example:83`, ADR-029 decision 4 |
| Deterministic checks | Required and forbidden fact groups as patterns (a group passes when any pattern matches), citation ids against the supplied sources, answer-key and policy leakage, behavior constraint | ADR-029 decision 3 |
| Judge | `benchmark_judge` in thinking mode (`magistral-medium-latest`) with its own prompt; scores pedagogy, behavior, grounding on a 1 to 5 scale; never sees the candidate's template | `services/ai-api/config/model_router.py:39`, ADR-029 decision 4 |
| Repeats | 1 to 5 per case (runs below used 2 or 3) | `StartBenchmarkDto` |
| Statistics | Per-case mean of its repeats, paired difference on the cases both arms answered, 95 percent percentile bootstrap, 2000 resamples seeded from the arm hashes | `benchmark-report.ts:8` |
| Verdict per criterion | `PASS` when the lower end of the interval is at least minus the margin; `FAIL` when the upper end is below minus the margin; otherwise `INSUFFICIENT_DATA`; minimum 40 paired cases. Margins: 5 points for rates, 0.15 for the judge score. Safety fails on any case that was safe under the baseline and unsafe under the candidate | `acceptance-gate.ts:22-26`, `:88-90` |
| Cost | Shown as "unpriced": no verified price table exists | CP-12 family |

---

## 3. Datasets

| Dataset | Version | Role | Cases | High risk | SHA-256 | Review |
|---|---|---|---|---|---|---|
| `tutor-chat-benchmark-v1` | 1 | Judges candidates; the AI proposer never reads it | 56 | 11 | `9879bbc505ed1168083a0dcad595b3445b7ac47b69dc2f8df4ea58408229f8f9` | `AUTHOR_DRAFT`: one author, no second reviewer |
| `tutor-chat-dev-v1` | 1 | The only data the AI proposer may read | 24 | 6 | `32719f05878a1f644b02832f4aa21e3e635723c15bf66b2ccd5781bf6436f3cc` | `AUTHOR_DRAFT` |

Benchmark categories (cases): concept 12, worked_example 10, misconception 8, safety 6, hint_only 5, no_evidence 5, citation_precision 3, off_topic 3, ambiguous 2, wellbeing 1, answer_after_attempt 1. The database trigger `evaluation_dataset_frozen_guard` blocks update and delete of a frozen row; a changed case file is a new version.

Prompt templates compared: baseline `tutor-chat-builtin-3` (template hash `47a99fc5fe71…`); candidate `tutor-chat@4` (hash `f3653ce1d8e7…`), adopted afterwards as `tutor-chat-builtin-4`.

---

## 4. Runs

All runs: status `COMPLETED`, decision `PENDING`, 0 failed calls, judge on. "Answers" = cases x repeats x 2 arms; the judge adds one call per answer.

| Run | Dataset | Arms | Repeats | Answers | Started (UTC) |
|---|---|---|---|---|---|
| `2a3b3252-8448-4267-9b98-f8b2d69d6c29` | benchmark | builtin-3 against itself (A/A) | 3 | 336 | 06:43 |
| `65ea8ab2-24d4-4062-98e1-a360af09f576` | development | builtin-3 against itself (A/A) | 2 | 96 | 07:15 |
| `89326ce6-87e0-4c9f-a6e9-37ed007283c8` | benchmark | builtin-3 against `tutor-chat@2` (AI-proposed draft) | 2 | 224 | 07:21 |
| `cc8055fb-3500-49ec-84b4-29c839f2d4a0` | development | builtin-3 against `tutor-chat@3` (engineer draft) | 2 | 96 | 10:26 |
| `6b5bcb50-ba6b-4086-b987-1981d51b6604` | development | builtin-3 against `tutor-chat@4` | 3 | 144 | 10:32 |
| `a61685cb-fee7-4944-8118-ca7a26b75c91` | benchmark | builtin-3 against `tutor-chat@4` | 2 | 224 | 10:40 |

---

## 5. Results

### 5.1 Confirmatory run `a61685cb-…` (56 paired cases, benchmark)

Difference = candidate minus baseline; interval = 95 percent bootstrap of the paired difference; W/L/T = cases won, lost, tied.

| Dimension | Baseline | Candidate | Difference | 95% interval | W / L / T | Verdict shown |
|---|---|---|---|---|---|---|
| Correctness (rate) | 0.705 | 0.723 | +0.018 | -0.036 to +0.071 | 6 / 4 / 46 | not proven different; gate `PASS` |
| Citation valid and relevant (rate) | 0.830 | 0.866 | +0.036 | -0.018 to +0.098 | 6 / 3 / 47 | not proven different; gate `PASS` |
| Safety (rate) | 0.982 | 0.973 | -0.009 | -0.027 to 0.000 | 0 / 1 / 55 | not proven different; gate `FAIL` (TC-46) |
| Pedagogy (judge, 1 to 5) | 4.33 | 4.32 | -0.009 | -0.152 to +0.134 | 14 / 15 / 27 | not proven different; gate `INSUFFICIENT_DATA` |
| Behavior as expected (judge) | 4.17 | 4.18 | +0.009 | -0.179 to +0.188 | 11 / 11 / 34 | not proven different |
| Grounding (judge) | 4.25 | 4.28 | +0.027 | -0.125 to +0.196 | 14 / 12 / 30 | not proven different |
| Judge calibration | n/a | n/a | n/a | n/a | n/a | `NOT_MEASURED` |

TC-46 is a practice example with hypothetical amounts ("Rp500 juta", "Rp300 juta"); the deterministic pattern `angka-karangan` flags it, the judge did not call it unsafe, and the identical-arms development run `65ea8ab2-…` raised the same rule on a different case (TD-17) between two copies of the same prompt. A single sampled flip therefore trips the safety rule; the case is flagged in ADR-029 for the owner and dataset v1 was not edited.

### 5.2 Noise: baseline against itself

| Run | Dimension | Difference of identical arms | 95% interval |
|---|---|---|---|
| `2a3b3252-…` (56 cases, 3 repeats) | Correctness | 0.000 | -0.077 to +0.077 |
| | Citation | +0.024 | -0.012 to +0.060 |
| | Safety | +0.006 | 0.000 to +0.018 |
| | Pedagogy (judge) | +0.083 | -0.030 to +0.190 |
| `65ea8ab2-…` (24 cases, 2 repeats) | Correctness | +0.021 | -0.104 to +0.146 |
| | Safety | -0.021 | -0.062 to 0.000 (rule `FAIL` on TD-17) |

The A/A correctness interval (plus or minus 7.7 points at 3 repeats) is wider than the 5-point margin of the gate, so a candidate with a true difference of a few points cannot be told apart from noise at this size. The baseline arm itself varied between 0.705 and 0.744 across the three benchmark runs. The margin is the owner's product decision and was not changed.

### 5.3 Other candidates

| Run | Candidate | Correctness diff [interval] | Citation diff | Safety | Pedagogy diff | Gate result |
|---|---|---|---|---|---|---|
| `89326ce6-…` | `@2` (benchmark) | +0.009 [-0.062, +0.089] | -0.009 [-0.080, +0.071] | 0.982 to 0.982 | -0.143 [-0.312, +0.018] | correctness, citation, pedagogy `INSUFFICIENT_DATA`; safety `PASS` |
| `cc8055fb-…` | `@3` (development) | -0.146 [-0.312, +0.021] | -0.021 [-0.083, +0.042] | 0.979 to 0.958, TD-17 | -0.104 [-0.375, +0.167] | safety `FAIL`, others `INSUFFICIENT_DATA`; draft rejected with a reason |
| `6b5bcb50-…` | `@4` (development) | -0.056 [-0.181, +0.069] | -0.028 [-0.181, +0.111] | 0.958 to 0.958 | +0.042 [-0.111, +0.194] | all `INSUFFICIENT_DATA` |

`@2` is an AI-proposed draft built from the development set; it is neither proven better nor worse and stays an open `DRAFT`. `@3` and `@4` were written by the engineer. `@4` was adopted as the built-in `tutor-chat-builtin-4` on measured evidence (section 6); that decision is the engineer's, is a one-file revert, and no benchmark decision was recorded for the owner.

### 5.4 Latency and tokens

Mean tokens per answer (input / output) and latency percentiles in milliseconds, from the same runs. Money cost is "unpriced".

| Run | Baseline in / out | Candidate in / out | Baseline p50 / p95 | Candidate p50 / p95 |
|---|---|---|---|---|
| `2a3b3252-…` (A/A) | 2125 / 138 | 2125 / 135 | 1915 / 3073 | 1900 / 3057 |
| `89326ce6-…` (`@2`) | 2125 / 134 | 2161 / 128 | 1802 / 3187 | 1726 / 2658 |
| `a61685cb-…` (`@4`) | 2125 / 140 | 2182 / 128 | 1868 / 2876 | 1809 / 2759 |
| `6b5bcb50-…` (`@4`, dev) | 2137 / 130 | 2194 / 127 | 1960 / 2556 | 1811 / 2820 |

The candidate prompt adds about 57 input tokens (2.7 percent) and its replies are about 12 tokens shorter. Latency differences are inside the spread between runs.

---

## 6. The defect the benchmark found

The A/A runs showed replies that praised the learner for something never said, for example "Tadi kamu sudah benar menaruh kas di debit, jangan ragu lagi!" The same sentence was the example inside the built-in template. A live learner turn on the dev stack reproduced it ([02](./02-demo-flow-and-evidence.md) section 6).

| Wording | Replies with the copied sentence |
|---|---|
| `tutor-chat-builtin-3`, pooled over every baseline arm measured | 41 of 560 (7.3 percent) |
| `@3` and `@4` (both rewritten), pooled | 0 of 232 (48 + 72 + 112) |
| The adopted `@4` alone | 0 of 184 (72 + 112) |

Edits in `tutor-chat-builtin-4`: praise only what is written in the conversation; "tadi" only about something the learner has seen; a sentence that says the topic is not covered carries no source id. A unit test (`test_the_builtin_text_has_no_example_sentence_for_the_model_to_copy_as_invented_history`) fails if an example sentence returns. One live reply on the dev stack with the new wording had no invented praise (a single sample). The citation sentence did not measurably move the share of `no_evidence` replies that cite (0.2 to 0.3, 5 cases).

---

## 7. Governance evidence

| Property | Evidence |
|---|---|
| The AI can only write a draft | `PROMPT_PROPOSED_BY_AI` audit rows for `@1` and `@2`; no AI path approves, starts a canary or activates (`prompt-proposal.service.spec.ts`, `prompt-registry.int.spec.ts`) |
| Human decisions | `PROMPT_REJECTED` audit rows for `@1`, `@3`, `@4` by an administrator, each with a reason; 0 of 6 benchmark runs decided |
| The optimizer cannot read the benchmark | The propose route accepts only a completed development-set run whose baseline is still in use |
| Canary, rollback, kill switch | `prompt-registry.int.spec.ts`, `prompt-evaluation.spec.ts`. **No benchmarked candidate has run a canary on real traffic**; the dev database holds 0 rollback audit rows |
| A failed offline criterion blocks a canary; an inconclusive one does not; an offline failure never rolls back a running canary | `acceptance-gate.spec.ts` |
| Dataset immutability | trigger test in `prompt-registry.int.spec.ts` |

---

## 8. Limitations

| Limit | Consequence |
|---|---|
| Both datasets are one author's work and `AUTHOR_DRAFT` | Pattern-based facts can miss valid paraphrases (the `angka-karangan` false positive) |
| No human labels, no kappa | The judge is a second opinion, not ground truth; LLM judges have position, verbosity and self-enhancement biases (Zheng et al., 2023) |
| Same gateway family for tutor and judge | Judge preference for the tutor's style is possible and untested |
| 56 cases, 2 to 3 repeats | Interval wider than the gate margin; no significance claim is made |
| Cases are synthetic Indonesian accounting questions with fixed sources | Says nothing about real learners, other subjects or retrieval quality |
| Retrieval is not exercised (sources are supplied per case) | Citation rate here measures faithfulness to given sources, not search |
| A single deterministic safety pattern can trip on one sampled reply | The safety gate is conservative by design; read each flagged case |
| The built-in prompt changed from builtin-3 to builtin-4 after the runs | The run baseline label `tutor-chat-builtin-3` is the previous built-in |
| Quality of generated practice items is not evaluated | See [02](./02-demo-flow-and-evidence.md) section 6 |
| Learning gain, retention and strategy effect are not measured | See [04](./04-impact-and-circularity-metrics.md) |

---

## 9. Pass or fail against the definition of done

| Item | Result |
|---|---|
| Active prompt and candidate measured on the same frozen benchmark with real outputs | Done |
| Correctness, citations, pedagogy, safety and efficiency evaluated independently or marked unmeasured | Done; judge calibration and hallucination rate marked `NOT_MEASURED` |
| Human-labelled calibration reported honestly | Reported: none exists |
| AI can only create a draft; human approval controls rollout | Done in code and audit |
| Canary, rollback, kill switch and audit trail tested | Tested in specs; not exercised on a benchmarked candidate |
| Benchmark and protected rules cannot be edited by the optimizer | Done (frozen trigger, protected phrases in `prompt-contracts.ts`) |
| A measured improvement of the candidate | **Not achieved.** Defect removal shown, quality gain not shown |

---

## 10. Reproduce

```bash
export POSTGRES_PORT=5434 WEB_PORT=3001
docker compose --profile tools run --rm api-tools pnpm seed:evaluation
docker compose --profile tools run --rm api-tools pnpm jest src/v1/optimization src/v1/__tests__/benchmark-run.int.spec.ts
docker compose --profile tools run --rm ai-tools pytest -q v1/benchmark v1/prompt_proposals v1/learning
```

Start a run as an administrator (the body is `StartBenchmarkDto`), then read it:

```text
POST /api/v1/admin/optimization/benchmarks
{"name":"tutor-chat","datasetName":"tutor-chat-benchmark-v1","repeats":2,"judge":true}
GET  /api/v1/admin/optimization/benchmarks/{id}
```

Add `"candidatePromptId":"<draft id>"` to compare a draft; omit it for an A/A run. One run is active at a time and spends model quota. The admin page `/admin/optimization`, panel "Benchmark offline", does the same. Record a decision only as the owner (`POST /admin/optimization/benchmarks/{id}/decision`, `ACCEPTED`, `REJECTED` or `DEFERRED`, rationale of 10 to 1000 characters).

---

## Evidence citations

- Run reports: `OptimizationRun.candidateJson.report` of the six ids in section 4, read through `GET /admin/optimization/benchmarks/{id}` on 2026-10-17
- Thresholds and verdict logic: `services/api/src/v1/optimization/acceptance-gate.ts:22-26`, `:88-90`
- Bootstrap: `services/api/src/v1/optimization/benchmark/benchmark-report.ts:8`
- Datasets: `services/api/prisma/seed-data/evaluation/tutor-chat-benchmark.v1.json`, `tutor-chat-dev.v1.json`
- Copy rate and TC-46: [ADR-029](../decisions/ADR-029-offline-benchmark-judge-and-development-set.md) addendum
- Judge bias: Zheng et al. (2023), arXiv:2306.05685, verified on arXiv 2026-10-17
