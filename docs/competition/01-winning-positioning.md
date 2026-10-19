# Winning Positioning (.id DeveloperDay 2026)

> **Status**: `in-progress` · **Owner**: `product-strategist` · **Last reviewed**: `2026-10-17`
>
> The problem, the primary user, the category fit, the differentiation and the proof each claim needs before it appears in the paper or the video.

Every claim carries a stable ID (`CL-nn`). Docs [02](./02-demo-flow-and-evidence.md), [05](./05-paper-outline.md), [06](./06-five-minute-demo-script.md) and [07](./07-submission-checklist.md) refer to these IDs, and the proof states are the ones of the [feature proof matrix](./00-current-state-audit.md#feature-proof-matrix). A claim that is not `VERIFIED_E2E` or `VERIFIED_COMPONENT` is worded as pending or left out.

---

## 1. Positioning

ReduCera is an evidence-driven circular learning platform: a learner's graded evidence decides the next short activity, demonstrated expertise can become reusable creator content, and the AI tutor's prompt can be revised from measured failures only through a benchmarked, human-approved, reversible process.

One sentence: from learner evidence to better teaching, from mastery to creator, and from creator knowledge back to the next learner.

The circular economy here is digital (knowledge reuse and creator value). No claim is made about physical waste, carbon or environmental effect. The AI-credit loop is not closed and is not part of any claim (CP-12, CL-13).

---

## 2. Problem and primary user

| Item | Statement | Evidence status |
|---|---|---|
| Primary user | University accounting students, first as learners and then as creators | Decided by the owner: [ADR-012](../decisions/ADR-012-launch-segment.md) (2026-10-09). Option A of D-01 |
| Later segment | School students (SMA) | Gated by D-02 (minors, consent, payout); not built for launch and not shown in the demo |
| Problem 1 | Journal, ledger and trial-balance rules are learned from text and graded late, so the same errors repeat | Hypothesis from [`strategy/02-business-model.md`](../strategy/02-business-model.md) §2.1. No interview, survey or usage data exists in the repository |
| Problem 2 | A student who masters a topic has no path to teach it and earn from it | The path exists in code and ran on the dev stack (CL-06, CL-07). Demand for it is not measured |
| Problem 3 | Generic AI help is not tied to what the learner has shown | The tutor receives learner state and a teaching strategy (CL-08). Whether it helps is not measured (CL-14) |

The competition entry does not state a market size, a learner count, a retention gain or a conversion rate. None was measured. The paper's "Target User & Market" section describes the segment and the unknowns, and cites only sources that are named in section 6 of [05](./05-paper-outline.md).

Demo scope: one coherent curriculum, the course "Akuntansi Dasar — Golden Graph" (10 concepts, 13 approved curriculum links), and one concept-linked creator product, the class "Akuntansi Dasar untuk Pemula". The UTBK-SNBT course and the SQL playground exist but stay out of the five-minute story.

---

## 3. Category fit

Weights are copied from `https://developerday.id/` (fetched 2026-10-17).

| Criterion | Student | Inclusions & Community Services (Education) | Consumer (Marketplace) |
|---|---|---|---|
| Uniqueness | 15 | 25 | 25 |
| Proof of Concept / Market Potential | 15 (Proof of Concept) | 30 (Market Potential) | 25 (Market Potential) |
| Functionalities & Features | 15 | 25 | 25 |
| Quality (Technology) | 30 | 20 | 25 |
| Presentation | 25 | not listed separately | not listed separately |

Observations from the table and the current evidence:

- The Student track puts 55 of 100 points on technology quality and presentation. The strongest verified assets are the event-sourced learner model, the server-side grading, the governed prompt registry and the frozen benchmark, and a recorded demo.
- The Education category puts 30 points on market potential. The repository holds no market evidence, so the weakest criterion would carry the largest weight.
- Consumer → Marketplace fits only the marketplace part; the main value is learning.
- The Student track is assessed apart from professional teams. Whether the team qualifies as students is a fact only the team knows.
- The official page says a team picks one main category and one subcategory at registration. The page lists subcategories for the five categories and none for the Student track; ask the organizer whether Student has subcategories (`info@developerday.id`).
- The page also says a participant may register in more than one category with a separate team registration per category, and the fee is IDR 100,000 per team.

Decision status: **open, owner** (CP-13 family). The default recommendation, if the team qualifies, is Student first. The entry must not be registered under a category before the team confirms eligibility in the portal.

---

## 4. Differentiation and the proof each claim needs

| ID | Claim (wording allowed in the paper) | What a judge can check | State | Where proven |
|---|---|---|---|---|
| CL-01 | Mastery is computed from graded evidence appended to an event log and folded by a versioned rule (`mastery-v1`) | A graded quiz appends a `LearningEvent` and changes `ConceptMastery`; a rebuild equals the stored projection | `VERIFIED_E2E` | [02](./02-demo-flow-and-evidence.md) §5, `demo-path.int.spec.ts` |
| CL-02 | Practice is graded by the server and the answer key is not exposed to the client | Questions route has no key; a second submit answers 409 and appends nothing | `VERIFIED_E2E` | 02 §5 |
| CL-03 | The platform records whether a teaching strategy was followed by higher mastery on the same concept (observed change, no control arm) | `StrategyOutcome` rows with before, after and delta | `VERIFIED_E2E`, 2 rows on dev, fixture learner | 02 §5, [04](./04-impact-and-circularity-metrics.md) |
| CL-04 | A due review is scheduled by a forgetting-curve rule and surfaced with its reason | Review queue before and after a quiz | `VERIFIED_E2E` | 02 §5 |
| CL-05 | A creator product is recommended when an approved concept tag matches the learner's current need; otherwise it is labelled "Terbaru di marketplace" | Two learners, two different labels, same product | `VERIFIED_E2E` | 02 §5 |
| CL-06 | Only a learner whose every concept in the topic is passed with mean mastery of at least 0.85 can apply to become a creator; an administrator approves | Application accepted for the eligible fixture learner (live); the 422 `MASTERY_THRESHOLD_NOT_MET` refusal is covered by `applications.security.spec.ts` | `VERIFIED_E2E` (fixture mastery) | 02 §5 |
| CL-07 | Creator content passes human moderation before publication and its concept tags are approved by an administrator | Audit rows `CLASS_CREATED`, `CLASS_SUBMITTED`, `CLASS_APPROVED`; tag `PROPOSED` then `APPROVED` | `VERIFIED_E2E` | 02 §5 |
| CL-08 | The tutor answers with the learner's state and chosen strategy in its prompt; lesson introductions write only from numbered sources, some found by meaning | Episode stores strategy and prompt version; an introduction cites four sources, one labelled "cocok makna"; chat replies carry no citation markers yet | reply and lesson-introduction sources `VERIFIED_E2E`; citation markers in chat not shown | 02 §3 S4, §6 |
| CL-09 | Tutor prompts are compared on a frozen set of 56 cases with deterministic checks and a separate rubric judge, per dimension, with intervals | Admin page "Benchmark offline", six completed runs | `VERIFIED_LIVE`; judge not calibrated against humans | [03](./03-evaluation-report.md) |
| CL-10 | A prompt change is a draft until a person approves it; canary, rollback and kill switch exist | Registry state table, audit rows, specs | `VERIFIED_COMPONENT`; no benchmarked candidate has run a canary on real traffic | 03 §7 |
| CL-11 | The benchmark found a real defect (the builtin prompt's example sentence copied as invented praise) and the fixed prompt does not copy it | 41 of 560 baseline replies copy it, 0 of 232 under the two rewritten wordings (0 of 184 under the adopted one) | `VERIFIED_LIVE`; correctness gain not shown | 03 §5 |
| CL-12 | A paid order creates a creator earning and a ledger entry | Integration specs on a scratch database | `VERIFIED_COMPONENT` on scratch only; 0 earnings on dev | CP-06 |
| CL-13 | AI credits | none | `NOT_IMPLEMENTED`; **not claimed** | CP-12 |
| CL-14 | Learning gain, retention, learner-to-creator conversion at scale | none | `NOT_MEASURED`; **not claimed** | [04](./04-impact-and-circularity-metrics.md) |
| CL-15 | An admin page shows five component metrics with formulas, windows, sample sizes and a "not enough evidence" state | `/admin/metrics` and `GET /admin/metrics/circularity`; on dev every metric reads "not enough evidence" because only demo fixtures exist | panel `VERIFIED_E2E`; **no metric value is a result** | [04](./04-impact-and-circularity-metrics.md) |
| CL-16 | Retrieval by meaning works (local `bge-m3` on CPU, 65 outline chunks indexed); its quality is not claimed | `[RETRIEVE] returned=10` in the chat worker; introductions with "cocok makna" sources | works `VERIFIED_E2E`; quality `NOT_MEASURED`, **not claimed** | [ADR-030](../decisions/ADR-030-local-embedding-provider.md) |

Words that stay out of every artefact unless ReduCera-specific evidence is added: "first", "fully autonomous", "always improving", "scientifically proven", "guaranteed to increase learning", "fully circular", "self-improving" without the qualifier "human-governed".

---

## 5. Alternatives the learner has today

Public product pages were read on 2026-10-17. Only what the page states is recorded; capabilities the page does not mention are marked "not stated", not "absent".

| Alternative | What the public page states | Source | Relation to ReduCera |
|---|---|---|---|
| Khanmigo (Khan Academy) | "AI-powered personal tutor and teaching assistant"; "doesn't just give answers"; lists teachers, learners and parents; "elementary school through college". Mastery tracking: not stated | `https://www.khanmigo.ai/` | Same idea of guiding instead of answering. ReduCera ties the strategy to a graded outcome and to creator content; Khanmigo's own claims are not compared |
| Ruangguru | Video lessons with practice questions, live classes, tryouts, private tutoring; "Video adaptif yang menyesuaikan kecepatan belajar" for SD to university and the general public. AI tutoring: not stated | `https://www.ruangguru.com/` | Content is produced by the vendor; no learner-to-creator path is stated |
| Open course marketplaces (for example Udemy) | Creators publish and sell courses; revenue terms are published by the vendor | `https://support.udemy.com/` (terms not compared here) | Discovery is by catalogue; ReduCera ranks by the learner's demonstrated need and labels fallbacks |
| General chat assistants | Not assessed | none | No graded evidence, review schedule or governed prompt are assumed |

No claim of superiority over any product is made. The comparison is a difference of design, and the design difference is only worth stating where CL-01 to CL-11 are proven.

---

## 6. Proof requirements before submission

| Requirement | State on 2026-10-17 | Remaining action |
|---|---|---|
| One learner flow from state to graded practice to updated state | Done (CL-01 to CL-05), browser and spec | Re-run on the recording account |
| Citations shown in the UI resolve to returned sources | Lesson introductions print numbered references that link to the listed sources (4 sources, including one found by meaning) and the quiz result lists its basis ("Dasar soal ini"); chat replies carry no citation markers yet | Index lesson-bound material so retrieved chunks carry a lesson id, or say it in the video |
| One recommended product with an approved concept link matching a real need | Done on the dev stack (fixture learner) | None |
| Same frozen benchmark for baseline and candidate with real outputs | Done (six runs) | None |
| Human-labelled calibration | 0 labels | Owner labels at least 20 outputs (high risk first) |
| At least two auditable circularity metrics | Defined in 04, values from dev fixtures | T4 route, and real learners for real values |
| A `.id` domain for the product | None exists | Owner decision, see [07](./07-submission-checklist.md) |

---

## 7. Risks to the positioning

| Risk | Severity | Mitigation |
|---|---|---|
| The `.id` domain rule is a validity condition and no `.id` host exists | High | [07](./07-submission-checklist.md) section 2 |
| Live data is demo fixtures; a judge may read fixture numbers as results | High | Label every figure with its source; use fixtures only for pipeline proof |
| Benchmark noise is wider than the gate margin, so most candidates stay inconclusive | Medium | Say so in the paper; do not present a pass as an improvement |
| Retrieval works but chat replies show no citation markers (the indexed outline chunks have no lesson id and the model did not cite) | Medium | Say so; show lesson-introduction citations and the offline citation measurement; index lesson-bound material |
| Working tree is uncommitted (CP-14) | High | Owner commits before the freeze |

---

## Evidence citations

- Category weights, fee, team size, registration rules: `https://developerday.id/`, fetched 2026-10-17
- Launch segment: `docs/decisions/ADR-012-launch-segment.md`
- Problem hypotheses: `docs/strategy/02-business-model.md` §2.1
- Claims table sources: the proof matrix and T1 notes in [`00-current-state-audit.md`](./00-current-state-audit.md), [`03-evaluation-report.md`](./03-evaluation-report.md)
- Creator gate: `services/api/src/v1/teacher/applications/applications.service.ts:46`, `services/api/src/v1/learner-model/mastery/topic-aggregate.ts` (`ELIGIBILITY_SCORE = 0.85`)
- Competitor pages: URLs in section 5, read 2026-10-17
