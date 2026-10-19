# Impact and Circularity Metrics

> **Status**: `in-progress` · **Owner**: `product-strategist` · **Last reviewed**: `2026-10-17`
>
> Five component metrics with exact formulas, sources, window, sample size and limits, computed by the API and shown on the admin page `/admin/metrics` (task T4). The dev database shows demo fixtures only, so every metric reads "not enough evidence".

The circular economy of ReduCera is digital: knowledge reuse and creator value. The metrics below measure parts of that loop from server records. They do not combine into one score, they do not use attention data, and they say "not enough evidence" instead of a number when the sample is small.

Rejected as evidence of learning or circularity: page views, clicks, notification opens, message counts, time on app, streak length, XP, a single opaque "circularity score", AI-credit circulation (not implemented, CP-12), and any physical or environmental claim.

---

## 1. Common rules

| Rule | Setting |
|---|---|
| Window | Half-open interval `[from, to)` in UTC; default the last 30 days; always printed next to the value |
| Sample size | Every value prints `n` (rows) and the number of distinct learners |
| Enough evidence | Each metric has a minimum (section 8). Below it the state is `NOT_ENOUGH_EVIDENCE` and no rate is shown. The minimums are proposals for the owner, not power calculations |
| Fixtures | Rows of the demo accounts `t1.*@reducera.local` are labelled "demo fixture" and counted separately; they never count as organic use |
| Causality | A before and after difference is an observed change. None of the metrics supports a causal claim |
| Authority | Computed by `api` from `LearningEvent`, `ConceptMastery`, `StrategyOutcome`, `ProductConceptLink`, `Entitlement`, `TeacherApplication`, `PromptVersion`, `OptimizationRun`. The metric reads and never writes |

---

## 2. M1 Mastery change after a graded activity

| Item | Definition |
|---|---|
| Question | After a server-graded activity, how does the concept estimate change? |
| Unit | One `ASSESSMENT_COMPLETED` event `e` of learner `u` on concept `c` with `occurredAt` in the window |
| Formula | `before(e)` = score of the state of `(u, c)` after folding all earlier events of that stream with `mastery-v1` (0.5 when none); `after(e)` = score after folding `e`; `delta(e) = after(e) - before(e)` |
| Reported | `n` events, `n` learners, mean `delta`, median `delta`, share of events with `delta > 0` |
| Sources | `LearningEvent` (`eventType`, `conceptId`, `payload`, `streamSeq`); the fold is `foldAssessment` in `mastery/mastery-v1.ts` |
| Interpretation | How graded results compare with the expectation of the model: `delta = uncertainty x weight x (score - expected)` with `expected = sigmoid(theta - difficulty)`, so a positive mean only says results beat the expectation |
| Limits | The rule moves the estimate toward the result by construction; the step shrinks with evidence (`1 / (1 + 0.05 x evidenceCount)`) and with retakes (`0.5` per extra attempt). It is an audit of the evidence pipeline, not a learning gain. A learning gain needs a delayed re-assessment with unseen items and a comparison group |

---

## 3. M2 Outcome of a scheduled review

| Item | Definition |
|---|---|
| Question | When a concept is assessed while the schedule says it is due, how often is the result a pass? |
| Unit | A graded event `e` whose prior state had `evidenceCount > 0` and was **due** at `occurredAt(e)` |
| Due | `retrievability = exp(-daysSince / stability) <= 0.7`, with `stability = 1.5 x 2^(min(evidence, 12) / 2) x (0.5 + score)` days and an interval capped at 60 days (`review-v1`) |
| Formula | `reviewPassRate = count(due events with payload.score >= 0.7) / count(due events)` |
| Reported | `n` due events, `n` learners, pass count, and for context the pass rate of not-due events of the same learners |
| Sources | `LearningEvent`, `ConceptMastery` history by replay, `review/review-schedule.ts` |
| Interpretation | Whether review attempts are passed, compared with the pre-review state recorded in the prior score |
| Limits | Events do not record whether the learner came from the review card, so "due" is derived from the schedule. The schedule parameters are heuristic and not fitted to learner data. A pass after a review is not retention: long-term retention needs a follow-up assessment after a further delay |

---

## 4. M3 Knowledge reuse rate

| Item | Definition |
|---|---|
| Question | Of the published, concept-linked creator products, how many were used by at least two distinct learners other than their author? |
| Denominator | Products with `status = PUBLISHED` (`ClassProduct` or `Article`) that have at least one `ProductConceptLink` with `status = APPROVED` |
| Qualifying use | Learner `v` is not the author, holds an `ACTIVE` `Entitlement` for the product created inside the window, and has at least one `ASSESSMENT_COMPLETED` event on a concept linked to the product at or after `Entitlement.startsAt` |
| Numerator | Products in the denominator with at least 2 distinct learners that qualify |
| Formula | `reuseRate = numerator / denominator` (undefined when the denominator is 0) |
| Reported | Denominator, numerator, per product the count of holders and of qualifying learners |
| Sources | `ClassProduct`, `Article`, `ProductConceptLink`, `Entitlement` (a free class enrolment creates one), `LearningEvent` |
| Interpretation | Reuse of creator knowledge by learners who then practised the linked concept |
| Limits | An assessment on the linked concept after access is a proxy for use; it does not show that the product caused it. Products of one creator in a tenant are not weighted by price. Free and paid access count alike |

---

## 5. M4 Learner-to-creator conversion

| Item | Definition |
|---|---|
| Question | Of the learners who meet the server-defined eligibility, how many became approved creators? |
| Eligibility (per topic `T`) | Every approved concept of `T` has `score >= 0.7` and `evidenceCount >= 3`, and the mean score is at least 0.85 (`isCreatorEligible`, `ELIGIBILITY_SCORE = 0.85`) |
| Cohort `E` | Users who are not administrators and are eligible for `T` at the end of the window |
| Numerator `C` | Members of `E` with a `TeacherApplication` in status `APPROVED` |
| Formula | `conversion(T) = |C| / |E|` |
| Reported | `|E|`, `|C|`, per topic, and the fixture count inside each |
| Sources | `ConceptMastery`, `ConceptCurriculumLink` (approved), `TeacherApplication`; code `mastery/topic-aggregate.ts`, `teacher/applications/applications.service.ts:46` |
| Interpretation | How much of the eligible pool takes the creator path, once a person has approved |
| Limits | Eligibility uses the current projection, not the state at an earlier date. The application needs a person's approval, so the rate depends on the reviewer. Eligible learners may have no wish to teach, so a low rate is not a failure |

---

## 6. M5 Prompt improvement evidence

| Item | Definition |
|---|---|
| Question | What evidence stands behind each prompt change? |
| Reported (counts, no rate) | Per prompt name: drafts by origin (AI-proposed, engineer), benchmark runs completed by dataset, criterion verdicts per run (`PASS`, `FAIL`, `INSUFFICIENT_DATA`, `NOT_MEASURED`), human decisions recorded on runs, canaries started, rollbacks, `StrategyOutcome` rows per prompt label, latency and token difference of each run |
| Sources | `PromptVersion`, `OptimizationRun` (benchmark reports), `AuditLog` (`PROMPT_PROPOSED`, `PROMPT_PROPOSED_BY_AI`, `PROMPT_REJECTED`, rollback actions), `StrategyOutcome` |
| Interpretation | A change is justified when a completed run shows per-dimension verdicts and a person decided; the count of measured outcomes states how much live evidence exists |
| Limits | Counts show activity of the governance process, not quality. Quality is read from [03](./03-evaluation-report.md) |

---

## 7. Values on the dev database (2026-10-17)

The dev database holds three demo-fixture accounts and no organic learner, so every value below is pipeline output on fixtures. None of it is an impact result. The numbers were first read with a throwaway script at 14:51 UTC and were reproduced by `GET /admin/metrics/circularity` at 16:03 UTC (the same 134, 14, 1 and 1 rows); the table shows the route's output.

| Metric | Window | n | Value | State |
|---|---|---|---|---|
| M1 | last 30 days | 134 events, 3 learners (all fixtures) | mean +0.032, median +0.022, 97 percent of events above 0 | `NOT_ENOUGH_EVIDENCE` (organic events: 0). The positive values come from fixture events written as strong results |
| M2 | last 30 days | 121 events with a prior state; 14 due, 3 learners | 12 of 14 due events scored at least 0.7 (all fixtures) | `NOT_ENOUGH_EVIDENCE` |
| M3 | last 30 days | denominator 1 of 1 published product; 1 holder, 1 qualifying learner (fixture) | numerator 0 (needs 2); rate 0 of 1 | `NOT_ENOUGH_EVIDENCE` |
| M4 | at 2026-10-17 | topic "Akuntansi Dasar — Golden Graph": `|E|` = 1, `|C|` = 1 (the fixture creator) | 1 of 1 | `NOT_ENOUGH_EVIDENCE` |
| M5 | all time | 4 drafts (2 AI-proposed, 2 engineer): 3 rejected with a reason, 1 open; 6 benchmark runs completed; 0 human decisions on runs; 0 canaries; 0 rollbacks; 2 strategy outcomes (one per built-in label) | counts only | Process evidence exists; no live outcome evidence |

How to read them again: sign in as an administrator, open `/admin/metrics`, or call `GET /api/v1/admin/metrics/circularity?from=<ISO>&to=<ISO>` (default last 30 days, at most 366). The route returns `value: null` below the minimum, and `demoValue` for the demo accounts (e-mail ending `@reducera.local`) apart from the organic numbers. The simple counts can also be checked with SQL:

```sql
select count(*) from "ClassProduct" c
where c.status = 'PUBLISHED'
  and exists (select 1 from "ProductConceptLink" l where l."classProductId" = c.id and l.status = 'APPROVED');

select e."classId", count(distinct e."userId") as holders
from "Entitlement" e where e.status = 'ACTIVE' and e."classId" is not null group by e."classId";

select status, count(*) from "TeacherApplication" group by status;
select status, count(*) from "PromptVersion" group by status;
select "promptVersion", strategy, success, count(*) from "StrategyOutcome" group by 1, 2, 3;
```

---

## 8. Minimum evidence (proposed)

| Metric | Minimum before a rate is shown |
|---|---|
| M1 | 30 events from at least 10 organic learners |
| M2 | 20 due events from at least 10 organic learners |
| M3 | 5 published concept-linked products in the denominator |
| M4 | 20 eligible learners in `E` |
| M5 | 1 completed benchmark run with a recorded human decision |

Until a minimum is met, the panel prints the counts, the window and the words "not enough evidence". The paper and video report the definitions and these states. They do not report the fixture values as results.

---

## 9. Implementation (task T4)

| Part | Where |
|---|---|
| Pure formulas and thresholds (`observeAssessments`, `masteryChange`, `reviewOutcome`, `knowledgeReuse`, `creatorConversion`, `promptEvidence`, `resolveWindow`, `MINIMUM_EVIDENCE`, `DEMO_ACCOUNT_DOMAIN`) | `services/api/src/v1/circularity/circularity-metrics.ts` |
| Reads the database, read-only, and assembles the report | `circularity-metrics.service.ts` |
| Route `GET /admin/metrics/circularity`, role `ADMIN`, query `from` and `to` | `admin-circularity.controller.ts`, `circularity.dto.ts`, `circularity.module.ts`; listed in `docs/architecture/AUTHORIZATION_MATRIX.md` |
| Specs | `circularity/__tests__/circularity-metrics.spec.ts` (22 tests: formulas, thresholds, demo split), `admin-circularity.controller.spec.ts` (8), `v1/__tests__/circularity-metrics.int.spec.ts` (scratch database: real events, a published class, entitlements, an approved application) |
| Page and cards | `apps/web/app/pages/admin/metrics.vue`, `components/admin/AdminCircularityPanel.vue`, `AdminCircularityCard.vue`, `lib/circularity.ts` (definitions in Indonesian, 11 tests) |

Design decisions that the formulas above did not fix:

- A user is a demo account when the e-mail ends with `@reducera.local`, the domain the seed scripts use. Demo rows are counted and shown apart and never count toward the minimum. An organic learner on a demo product, or the reverse, is left out of both groups of the reuse metric.
- The window applies to events, entitlements, outcomes, audit rows and benchmark runs. M4 reads the current mastery projection and M5 counts versions by their current status.
- Below its minimum a metric answers with `state: NOT_ENOUGH_EVIDENCE` and `value: null`. M5 is the exception: it reports counts, and its state follows the decided runs.
- The panel shows the evidence against the minimum as a bar and a count, the values only when the state is `OK`, the demo block under a dashed border with the words "Akun demo (fixture), bukan hasil", and the formula, sources and limits in a closed section.

Not covered: a time series, export, or alerting; all five minimums are proposals for the owner (section 8); organic data does not exist yet, so the `OK` branch of the page has been exercised by specs and not by the dev stack.

---

## Evidence citations

- Mastery fold: `services/api/src/v1/learner-model/mastery/mastery-v1.ts`; pass rule `PASS_SCORE = 0.7`, `PASS_EVIDENCE = 3` in `learner-model/policy/learner-policy.service.ts:16-17`
- Review schedule: `services/api/src/v1/learner-model/review/review-schedule.ts`
- Eligibility: `services/api/src/v1/learner-model/mastery/topic-aggregate.ts` (`isCreatorEligible`, `ELIGIBILITY_SCORE`), `teacher/applications/applications.service.ts:46`
- Free enrolment: `services/api/src/v1/classes/class-enrollments.service.ts` (`enrollFree`)
- Schema: `services/api/prisma/schema.prisma` (`LearningEvent`, `ConceptMastery`, `StrategyOutcome`, `ProductConceptLink`, `Entitlement`, `TeacherApplication`, `PromptVersion`)
- Values: dev database, read-only, 2026-10-17; the earlier audit counts in [`00-current-state-audit.md`](./00-current-state-audit.md) came from an earlier database state
