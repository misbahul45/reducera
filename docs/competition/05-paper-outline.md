# Paper Outline (English, 13 official sections)

> **Status**: `in-progress` · **Owner**: `technical-writer` · **Last reviewed**: `2026-10-17`
>
> The structure, page and word budget, facts, figures and forbidden claims for each section of the competition paper. Only verified facts and the labelled statuses of the proof matrix go in.

Rules from `https://developerday.id/` (fetched 2026-10-17): English, PDF, **at most 15 pages and 20 MB, submitted as a link**, with the 13 sections below in this order. The budget keeps 1.25 pages of slack for layout.

The paper uses the claim IDs of [01](./01-winning-positioning.md). A sentence that states a capability carries the ID of its claim in the working draft and the ID is removed from the final PDF. A claim whose state is not `VERIFIED_E2E` or `VERIFIED_COMPONENT` is written as "planned" or "pending" with its reason.

---

## 1. Budget

| # | Section (official title) | Pages | Words | Figures |
|---|---|---|---|---|
| 1 | Title Slide (Innovation Name) | 0.75 | 60 | Hero screenshot of the learner dashboard |
| 2 | Problem Statement | 0.75 | 300 | none |
| 3 | Target User & Market | 0.75 | 300 | none |
| 4 | Proposed Solution | 1.5 | 550 | Loop diagram (F1) |
| 5 | Key Features & Tech Stack | 2.0 | 650 | Architecture diagram (F2), stack table |
| 6 | Screenshots or Product Demo | 2.0 | 250 | 6 screenshots (F3 to F8) with captions, video link |
| 7 | Competitive Advantage | 1.0 | 380 | Comparison table |
| 8 | Current Status & Development Plan | 1.5 | 520 | Status table |
| 9 | Business Model | 1.0 | 380 | Value-flow table |
| 10 | Impact Plan | 1.0 | 380 | Metric table |
| 11 | Roadmap & Future Direction | 0.5 | 200 | none |
| 12 | Team Profile & Contact | 0.5 | 120 | none |
| 13 | Reference | 0.5 | 0 (list) | none |
| | **Total** | **13.75** | **about 4090** | |

---

## 2. Section plan

### 2.1 Title Slide (Innovation Name)

- Name: ReduCera. Subtitle: an evidence-driven circular learning platform for university accounting students.
- Category and track, team name, demo video link, product link on the `.id` domain: **owner fills** ([07](./07-submission-checklist.md)). Do not print a link that does not resolve.
- One sentence: "From learner evidence to better teaching, from mastery to creator, from creator knowledge back to the next learner."

### 2.2 Problem Statement

- Accounting rules (journal, ledger, trial balance) are practised with late feedback, so the same errors repeat. Label as the team's hypothesis; no survey exists (01 section 2).
- Students who master a topic have no route to teach it and earn from it.
- General AI help is not tied to what the learner has shown.
- Do not state a number of affected students.

### 2.3 Target User & Market

- Primary user: university accounting students, learners first and creators later ([ADR-012](../decisions/ADR-012-launch-segment.md)). School students are a later segment, gated by consent, minors and payout rules.
- Secondary users: creators (students who passed the mastery gate), reviewers and administrators.
- Market: describe the segment and name the unknowns (size, willingness to pay, retention). No market-size figure; if the team adds one, it carries an official source with retrieval date.

### 2.4 Proposed Solution

- The loop (F1): learner evidence, then a short activity chosen from mastery and review schedule, then a cited AI companion, then server-graded practice, then an appended event and recomputed mastery, then a due review or a concept-linked creator product, then the mastery gate to the creator path, then measured failures feeding a human-governed prompt change.
- Server decides: grading, mastery, review schedule, recommendation, payments, moderation. The model explains and drafts only (CL-01 to CL-08).
- Wording for the AI claim: "A prompt revision is a draft until a person approves it; a frozen benchmark, a canary, a rollback and a kill switch govern activation." Never "self-improving" without "human-governed".

### 2.5 Key Features & Tech Stack

| Feature | State | Claim |
|---|---|---|
| Event-sourced mastery (`mastery-v1`) and rebuildable projection | `VERIFIED_E2E` | CL-01 |
| Server-side grading, answer key not exposed, idempotent submit | `VERIFIED_E2E` | CL-02 |
| Teaching strategy per turn and recorded outcome | `VERIFIED_E2E` (observed change, no control arm) | CL-03 |
| Review schedule (`review-v1`) with reason | `VERIFIED_E2E` | CL-04 |
| Concept-linked recommendation with honest fallback label | `VERIFIED_E2E` | CL-05 |
| Mastery gate to creator, human approval, moderated publication | `VERIFIED_E2E` | CL-06, CL-07 |
| AI companion with typed actions (practice questions, simplify, add example, save note) | reply `VERIFIED_E2E`; lesson-introduction citations `VERIFIED_E2E`; no citation markers in chat yet | CL-08 |
| Admin metrics page with five component metrics and "not enough evidence" states | panel `VERIFIED_E2E`; values are demo fixtures | CL-15 |
| Frozen benchmark, deterministic checks, separate judge | `VERIFIED_LIVE`; judge not calibrated | CL-09 |
| Prompt registry: draft, gate, canary, approval, rollback, kill switch | `VERIFIED_COMPONENT` | CL-10 |
| Sandbox (accounting journal, SQL playground), gamification, per-user theme | implemented, outside the five-minute story | not claimed as proof |

Stack (verified against manifests and compose): Nuxt 4, Nuxt UI, Pinia and TanStack Query (web); NestJS 11, Prisma 7, PostgreSQL 15, BullMQ and Redis 7 (api); FastAPI, LangChain and LangGraph, LlamaIndex, Celery and Qdrant 1.12 (ai-api and workers); nginx 1.27; Docker Compose. LLM through one OpenAI-compatible gateway with a flash model (`mistral-small-latest`) and a thinking model (`magistral-medium-latest`); embeddings `BAAI/bge-m3` (1024 dimensions), computed locally on CPU inside the AI containers (a provider switch keeps Hugging Face Inference as the alternative, [ADR-030](../decisions/ADR-030-local-embedding-provider.md)). Service identity between `api` and `ai-api` is signed; `api` is the only service that touches the database; `ai-api` holds no database credential (ownership script `PASS`).

Test evidence for the paper: api 254 suites and 3558 tests, ai-api 1206 tests, web 1010 tests, all passing on 2026-10-17. Figure F2: the runtime map in the [audit](./00-current-state-audit.md#architecture-map-actual-runtime).

### 2.6 Screenshots or Product Demo

Six screens, all from the recording account, light theme, 1280 px, captions with the verified label:

| Fig. | Screen | Caption facts |
|---|---|---|
| F3 | Dashboard | Next concept with reason; mastery per concept |
| F4 | Mastery page | Review due date, strategy and the "not enough evidence" state |
| F5 | Lesson introduction | Numbered sources from course records and from search by meaning ("cocok makna") |
| F6 | Quiz result | Server score, basis per question |
| F7 | Marketplace shelf and class page | "Disarankan untukmu" with the concept and mastery; the fallback label for another learner |
| F8 | Admin benchmark detail | Per-dimension intervals, gate criteria, human decision form |

Add the video link and the sentence: "All learner data shown belongs to demo accounts; mastery history on the accounts was created as demo fixtures." Source of screens and ids: [02](./02-demo-flow-and-evidence.md).

### 2.7 Competitive Advantage

- Difference of design, not of measured performance: the teaching strategy is tied to a graded outcome; the recommendation comes from approved concept tags and says when it is a fallback; the prompt change path is benchmarked, human-approved and reversible.
- Comparison table of section 5 in [01](./01-winning-positioning.md), with the two vendor pages and their retrieval date. No superiority claim.
- State what is not shown: learning gain, retention, retrieval quality.

### 2.8 Current Status & Development Plan

Use the proof states directly:

| Area | State |
|---|---|
| Learning loop, grading, mastery, review | `VERIFIED_E2E` on the dev stack with fixture learners |
| Creator gate and moderation | `VERIFIED_E2E` |
| Paid order to creator earning | `VERIFIED_COMPONENT` on a scratch database; 0 earnings on dev |
| Prompt governance and benchmark | built and measured; 0 human decisions, 0 canaries on real traffic |
| Semantic retrieval | works with a local embedding model; quality not measured; chat shows no citation markers yet |
| Circularity metrics page | implemented; every metric reads "not enough evidence" (demo fixtures only) |
| AI-credit loop | not implemented |
| Pilot with real learners | none yet |

Include the benchmark result honestly (03): six runs, a real defect found and removed (41 of 560 to 0 of 232), no proven quality gain, interval wider than the gate margin. Development plan: section 2.11.

### 2.9 Business Model

- Implemented in code: manual payment adapter, order to payment to entitlement, creator share and platform fee (`PLATFORM_FEE_PERCENT`, default 10), wallet, payout and refund state machines, covered by integration specs (CL-12). A payment gateway is not implemented (the webhook route answers 501).
- No revenue exists. Do not print revenue, price points or conversion as results. Pricing and unit economics are parameters with labelled assumptions in [`strategy/02-business-model.md`](../strategy/02-business-model.md).
- Value flows (table): learner to platform (payment), platform to creator (share), creator to learner (content), learner evidence to creator eligibility. AI credits are out of scope until the spend path exists (CL-13).

### 2.10 Impact Plan

- Impact is digital knowledge reuse and creator opportunity for students; no environmental claim.
- Measurement plan: the five metrics of [04](./04-impact-and-circularity-metrics.md) with their windows and minimum samples; the table of values on dev fixtures is labelled "pipeline check, not result".
- Pilot (proposal, not done): one class of university accounting students, a consent and privacy review before it starts, no minors, a defined window, then M1 to M4 reported with `n`. The paper must say that the pilot has not run.
- Risks and safeguards: human moderation of creator content, server-side grading, no AI authority over money or publication.

### 2.11 Roadmap & Future Direction

Ordered by dependency: (1) `.id` deployment; (2) real learners so that the metrics of [04](./04-impact-and-circularity-metrics.md) leave "not enough evidence"; (3) human labels for the judge and a second reviewer of the benchmark cases; (4) a retrieval benchmark and lesson-bound indexing so chat citations appear; (5) a benchmarked candidate through a canary on real traffic with a human decision; (6) pilot; (7) payment gateway adapter and AI-credit loop; (8) school-student segment behind the consent gate. Dates: none unless the team commits them.

### 2.12 Team Profile & Contact

Names, roles, institution, e-mail: **owner fills** (maximum three members including the leader). Do not infer names from the repository.

### 2.13 Reference

| Ref | Source | Verified |
|---|---|---|
| R1 | .id DeveloperDay 2026, official page, `https://developerday.id/`, retrieved 2026-10-17 | fetched |
| R2 | Bloom, B. S. (1984). The 2 sigma problem: The search for methods of group instruction as effective as one-to-one tutoring. *Educational Researcher*, 13(6), 4-16. doi:10.3102/0013189X013006004 | Crossref |
| R3 | Roediger, H. L., and Karpicke, J. D. (2006). Test-enhanced learning. *Psychological Science*, 17(3), 249-255. doi:10.1111/j.1467-9280.2006.01693.x | Crossref |
| R4 | Cepeda, N. J., Pashler, H., Vul, E., Wixted, J. T., and Rohrer, D. (2006). Distributed practice in verbal recall tasks: A review and quantitative synthesis. *Psychological Bulletin*, 132(3), 354-380. doi:10.1037/0033-2909.132.3.354 | Crossref |
| R5 | Corbett, A. T., and Anderson, J. R. (1995). Knowledge tracing: Modeling the acquisition of procedural knowledge. *User Modeling and User-Adapted Interaction*, 4(4), 253-278. doi:10.1007/BF01099821 | Crossref |
| R6 | Pelanek, R. (2016). Applications of the Elo rating system in adaptive educational systems. *Computers and Education*, 98, 169-179. doi:10.1016/j.compedu.2016.03.017 | Crossref |
| R7 | Zheng, L. et al. (2023). Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena. arXiv:2306.05685 | arXiv |
| R8 | Khanmigo, `https://www.khanmigo.ai/`; Ruangguru, `https://www.ruangguru.com/`; retrieved 2026-10-17 | fetched |

How each reference may be used: R2 and R3 and R4 motivate practice with feedback and spaced review, as background. R5 and R6 describe the families of learner models related to `mastery-v1`, a logistic update with a shrinking step; the paper must not claim that ReduCera implements Bayesian knowledge tracing or an Elo rating. R7 supports the statement that an LLM judge is a second opinion with known biases. The review schedule parameters are heuristic and are not drawn from R4.

---

## 3. Forbidden or conditional statements

| Statement | Rule |
|---|---|
| "First", "fully autonomous", "always improving", "scientifically proven", "guaranteed learning gain", "fully circular" | Never |
| Any learner count, retention lift, conversion rate, revenue, market size, cost saving | Only with a measured source and its sample; none exists today |
| Retrieval quality or citation quality of the live chat | Not claimed; retrieval works but is not measured and chat shows no citation markers yet; show the lesson-introduction sources |
| Benchmark "pass" | Say "gate criteria correctness and citation `PASS`, safety `FAIL` on one case, others inconclusive" with the interval, never a single score |
| Fixture mastery as results | Always labelled "demo fixture" |
| The `.id` domain | Do not state compliance until a `.id` host serves the product |

---

## 4. Production checklist

- [ ] Draft in English, PDF export, at most 15 pages, below 20 MB (target under 8 MB: compress screenshots).
- [ ] Public link opens without sign-in from a clean browser profile.
- [ ] All 13 headings present in the official order.
- [ ] Every number traced to [02](./02-demo-flow-and-evidence.md), [03](./03-evaluation-report.md) or [04](./04-impact-and-circularity-metrics.md).
- [ ] Screenshots from the demo accounts only; no tokens, e-mails of real people or logs.
- [ ] References checked once more against R1 to R8.
- [ ] Owner fields filled: team, contact, category, `.id` link, video link.

---

## Evidence citations

- Section list, limits and language: `https://developerday.id/`, fetched 2026-10-17
- Claim states: [`01-winning-positioning.md`](./01-winning-positioning.md) section 4
- Stack: `services/api/package.json`, `apps/web/package.json`, `services/ai-api/pyproject.toml`, `docker-compose.yml`, `.env.example:46-48`, `:83-91`
- Test counts: gate runs of 2026-10-17 recorded in `docs/progress-tracker.md` (RC-34)
- References: Crossref records read on 2026-10-17 (R2 to R6), arXiv record (R7)
