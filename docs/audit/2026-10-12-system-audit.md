# System audit of 2026-10-12: personalization, self-improvement and marketplace

> **Status**: `stable` · **Owner**: `architect` · **Last reviewed**: `2026-10-12`
>
> What the running system does compared with the plans for personalization, self-improvement and the marketplace, what was fixed, and what is still open.

The audit was run against `main` at `39db220` on the dev stack. Every claim below was checked in code with the `codebase-memory-mcp` graph and `grep` (the graph is partial on SQL migrations and `nginx.conf`, which were read directly), or on the running stack. Plans used as the reference: `docs/plans/self-improving-llm.md`, `docs/plans/phased-roadmap.md`, `docs/superpowers/specs/2026-10-02-implementation-plan-design.md` (sections 5.3, 5.5, 5.6), `docs/architecture/circular-economy-model.md`, ADR-010, ADR-014, ADR-015, ADR-017.

---

## 1. Baseline before any change

| Check | Result |
|---|---|
| `scripts/check-ownership-rules.sh` | PASS |
| `api` jest without a database | 1710 passed, 295 skipped |
| `api` jest with the scratch database (`--runInBand`) | 2000 passed, 5 skipped, 184 suites |
| `ai-api` pytest with Qdrant reachable | 799 passed |
| `web` vitest | 563 passed |
| Dev stack | down at the start; started with `POSTGRES_PORT=5434 WEB_PORT=3001` because another project of the owner holds 5433 and 3000 |

### 1.1 After the changes

| Check | Result |
|---|---|
| `scripts/check-ownership-rules.sh` | PASS |
| `bash infra/scripts/check-theme-sync.sh` | OK for both themes |
| `docker compose config` | valid |
| `api` `tsc --noEmit` | clean |
| `api` jest with the scratch database (`--runInBand`) | 2109 passed, 5 skipped, 191 suites (190 passed, 1 skipped) |
| `ai-api` pytest with Qdrant reachable | 835 passed |
| `web` vitest | 589 passed |
| Dev stack | 8 services healthy; `api` rebuilt for the scheduled sweep (rollback tag `reducera-api:pre-o06-20261012`) |
| Scheduled sweep on the dev stack | the repeatable job `evaluate-canaries` is in Redis (next run 09:00 Asia/Jakarta); one job enqueued by hand was consumed by the worker in the `api` container and returned `{"inspected":0,"validated":[],"rolledBack":[],"undecided":[],"failed":[]}` (the dev database has no canary) |

## 2. Findings

Severity follows the plan: Critical breaks a promised loop for every user, High breaks it for a class of users or leaves a plan gate unmet, Medium is an inconsistency.

| ID | Sev | Finding | Evidence | Status |
|---|---|---|---|---|
| A-01 | Critical | The learner never saw the tutor reply: the chat worker stored `Successfully generate continue material for <first 50 characters>` as the message text | `services/ai-api/v1/learning/workers.py` (git `a868095`); dev database row `ASSISTANT\|COMPLETED\|Successfully generate continue material for Akuntansi dan pencatatan keuangan sederhana se` | Fixed |
| A-02 | High | The teaching strategy of `LearnerPolicyService` never reached the tutor: only the `tutor` module of `api` called it and no client called that module; the tutor prompt said the strategy came from the policy but carried none | graph `search_graph` and `grep` for `teachingStrategy`; `personalization_prompt.py` | Fixed |
| A-03 | High | The personal policy never learned: `loadOrBuildPolicy` returned an empty policy, `persistPolicy` only logged, `recordAttemptOutcome` had no caller, and it wrote misconception statuses (`TENTATIVE`, `CONFIRMED`) that the enum `MisconceptionStatus {OPEN, RESOLVED}` rejects | `tutor.service.ts` lines 149-236 (removed) | Fixed by `StrategyOutcome` and `TeachingDecisionService` |
| A-04 | High | Episodes were not measurable: `unknown-v0` for model, prompt and policy, no tokens, no latency, and `reason_codes=["PHASE_1_FOUNDATION"]` on every decision trace; the trace row also kept `modelName: unknown-v0` and no usage | `workers.py`, `internal-decision-traces.controller.ts`; Layer 0 of `self-improving-llm.md` | Fixed |
| A-05 | High | The self-improving layers 2 to 5 were code without a route: `PromptOptimizationService` and `EvaluationService` were in no module; the optimizer wrote `CANARY` and `PUBLISHED`, which are not `PromptStatus` values; `promote` had no human check; the evaluator invented scores from answer length; the gate differed from section 6 of the plan; tables `PromptVersion`, `OptimizationRun`, `EvaluationDataset` had zero rows and no endpoint | `v1.module.ts`, `schema.prisma` enum `PromptStatus` | Fixed for layers 3 and 5 (registry, canary, gate, human approval, rollback); layers 2 and 4 stay open (section 5) |
| A-06 | High | Marketplace plan gate unmet: becoming a creator did not require mastery (`SubmitApplicationDto` is strict and has no `expertiseTopicId`, and the check in `ApplicationsService.submit` ran only when a topic was present) | spec section 5.5 acceptance gate; `applications.dto.ts` | Fixed (server rule and web form) |
| A-07 | Medium | A buyer could not ask for a refund in the web although `POST /orders/{id}/refund-requests` and `GET /refunds/mine` exist; the circular economy loop stopped at the order page | `grep refund apps/web/app/pages` | Fixed |
| A-08 | Medium | `GET /marketplace-discovery/recommendations` (personalized by mastery) had no caller | `grep recommendations apps/web/app` | Fixed (shelf on the marketplace for signed-in learners) |
| A-09 | Medium | The mastery page listed scores only: next concept, why, and what works for the learner were invisible although the API had them | `pages/my-learning/mastery/index.vue` | Fixed |
| A-10 | Medium | The frozen benchmark of the plan (AC-7.2) had no database guard | `EvaluationDataset` has no trigger | Fixed (trigger `evaluation_dataset_frozen_guard`) |
| A-11 | Medium | Misconceptions are practically never recorded: grading labels a wrong answer `wrong_multiple_choice` or `wrong_answer`, and `MisconceptionService.recordFromAnswer` is then called with an empty `correctAnswer` and a UUID question id, so only the generic `missing_credit_side` pattern can match | `quiz-attempts.service.ts` lines 150 and 360, `misconception.service.ts` | Partly fixed: the practice quiz of the chat action tags every wrong option with a closed misconception code (`practice_quiz.py`, `Question.distractors`, `recordTagged` at grading), so a wrong answer there is traced to a misconception; the placement quiz of the journey (workplace simulation, free text and scenario types, graded as `PersonalityQuiz`) is not tagged, because the closed code list is accounting specific and those answers are not a closed set of options (IMPL-LS-12 stays open for it) |
| A-12 | Medium | The AI credits branch of the circular economy is not closed: `ai-credits` has an internal controller only, nothing in `ai-api` reserves or settles credits, the web wallet says purchase is not open, and `InsufficientCreditsState` has no user | `grep ai-credits services/ai-api` is empty | Open (owner: credit pricing and which features spend credits) |
| A-13 | Medium | 29 components have no reference in any template or import (cosmic style legacy and the AI stage UI committed in `39db220`): see section 6 | script in the session, `components/**` | Open (owner chooses what to delete) |
| A-14 | Low | Comment lines remain in source despite the no-comment rule: 93 in `api`, 36 in `ai-api`, 14 in `web`, plus `prisma.config.ts`, `conftest.py` and the migrations header | `grep` of `//`, `/**` and `#` at line start | Fixed in the 2026-10-12 tranche (see the addendum: comments removed from source, Dockerfiles, `infra/qdrant/config.yaml` and the backup scripts) |
| A-15 | Low | `docker-compose.prod.yml` interpolates `STRIPE_*` and `SUPABASE_*` that no service reads and `.env` does not define | `docker compose -f docker-compose.prod.yml config` warnings | Fixed in the 2026-10-12 tranche (`STRIPE_*` and `SUPABASE_*` removed from the `api` block of `docker-compose.prod.yml`) |
| A-16 | Medium | One Redis serves the app cache, the BullMQ broker and the Celery broker with `--maxmemory 512mb --maxmemory-policy allkeys-lru`; under memory pressure Redis may evict queue, repeatable schedule and lock keys without an error, and BullMQ prints `Eviction policy is allkeys-lru. It should be "noeviction"` at start | `docker-compose.yml` line 84, `docker-compose.prod.yml` line 91; `redis-cli config get maxmemory-policy` on the dev stack; use is 2.9 MB of 512 MB today, so nothing is lost yet | Fixed in the 2026-10-12 tranche (Redis `volatile-lru`, every cache key of the code carries a TTL, queue keys are never evicted) |

## 3. Conformance with the plans after the changes

### 3.1 Personalization and self-improvement

| Plan element | State | Where |
|---|---|---|
| Learner model, event sourced mastery (phase 4) | Built before the audit | ADR-014 |
| Adaptive policy with reason codes (phase 5) | Built; now consulted by the tutor and learning from outcomes | `LearnerPolicyService`, `TeachingDecisionService`, ADR-019 |
| Tutor integration with episode and decision trace (phase 6, AC-6.3 and AC-6.4) | Every chat turn and every lesson material writes both with model, tokens, latency, versions and strategy | `v1/learning/workers.py`, `turn_record.py` |
| Layer 0 observability: tokens, cost, latency per episode | Tokens, latency and model recorded; cost in dollars is not (no price table) | open: owner supplies prices |
| Layer 1 evaluator and mastery | Mastery built; the judge for free text is not | open |
| Layer 2 evaluation harness, frozen benchmark, judge with kappa 0.85 | Frozen guard built; no benchmark rows and no judge | open |
| Layer 3 prompt registry, router, kill switch | Built: states, canary split by learner, kill switch, admin page | `v1/optimization/`, `pages/admin/optimization.vue` |
| Layer 4 offline experiment runner (DSPy) | Not built; the registry accepts a candidate from any source | open |
| Layer 5 canary, gate, auto rollback, human approval | Built on measured criteria; correctness, pedagogy and hallucination rate reported as not measured; an hourly sweep evaluates every running canary and rolls a regression back or validates a pass by itself, never activating one | `acceptance-gate.ts`, `prompt-evaluation.{scheduler,processor}.ts`, `PromptRegistryService.evaluateRunningCanaries` |
| AC-SI-04 (a canary rollback verified) | Verified on the database | `prompt-registry.int.spec.ts` |
| AC-SI-02 (one full loop to promoted or rejected) | The mechanism is verified end to end; no real candidate has run in production | open |

### 3.2 Marketplace and circular economy

| Step of the loop | State |
|---|---|
| Learner masters a topic | Event sourced mastery; creator eligibility 0.85 (D-23 proposal) |
| Apply to become a creator | Server refuses without a mastered topic; the web form lists topics with progress |
| Admin approves, tenant is provisioned | Built (RC-21) |
| Write and submit an article or class | Built (RC-21) |
| Moderation with state table and audit | Built; REVIEWER moderation is an open owner question |
| Marketplace listing and personalized recommendations | Listing built; recommendations now shown to signed-in learners |
| Order, manual payment, approval, entitlement, creator earning | Built and verified end to end on 2026-10-11 |
| Refund within the window | API built; the buyer can now ask from the order page |
| Payout request, review, paid | Built |
| Reinvest in classes | Built (buy again) |
| Reinvest in AI credits | Not closed (A-12) |

## 4. What changed

Services:

- `ai-api`: model router reports model, usage and latency; chat worker stores the reply and records the turn; strategy playbook and prompt rendering; prompt registry client with fallback; decision trace carries model and usage; `config/prompt_registry.py`, `v1/learning/{turn_record,citations,chat_template}.py`, `v1/tutor/strategy_playbook.py`.
- `api`: `StrategyOutcome` (migration `20261012100000_strategy_outcome`), `TeachingDecisionService`, `StrategyOutcomeService`, routes `learner-model/me/strategy` and `me/strategies`, strategy in `internal/learner-state`, policy `teaching-policy-v2`; prompt registry module `v1/optimization/` with admin routes, `internal/prompts/resolve` (migration `20261012110000_prompt_registry_guards`) and the hourly canary sweep (queue `prompt-evaluation`); mastery gate on creator applications; removed `tutor`, `policy` and `evaluation` modules; gates for `strategyOutcome`, `promptVersion` and `optimizationRun` writers in `scripts/check-ownership-rules.sh`.
- `web`: Optimasi AI admin page, mastery page with next concept, strategy reasons and strategy evidence, topic eligibility in the creator form, refund request on the order page, recommendation shelf on the marketplace, theme tokens for shared state icons.

## 5. Open items and owner decisions

| ID | Item | Why it waits |
|---|---|---|
| D-27 | Gate thresholds (30 episodes, 10 outcomes, latency 1.1, tokens 1.2, drop 10 percent), the 24 hour attribution window and the band-compatible strategy sets | proposals, same status as D-08, D-22, D-23 |
| D-28 | Arcjet limits of the auth routes: window and value per address and per email address (section 8.1), and no Arcjet limit on refresh | proposal, same status as D-27; the owner can change the table in `v1/auth/auth-limits.ts` |
| O-01 | Delete the unreferenced components of section 6 | the AI stage UI is part of the latest commit |
| O-02 | Judge for correctness, pedagogy and hallucination rate, and the frozen benchmark of 50 scenarios (golden scenarios exist in `prisma/seed-data/golden-scenarios.json`) | built 2026-10-17: frozen benchmark of 56 cases, development set of 24, rubric judge and gate criteria ([ADR-029](../decisions/ADR-029-offline-benchmark-judge-and-development-set.md)); human labels, judge calibration and a second reviewer of the cases are still open |
| O-03 | DSPy candidate generation | after O-02 |
| O-04 | Distractor tagged quiz questions so misconceptions are real (A-11) | needs a change of the quiz generation prompt and a reviewed taxonomy |
| O-05 | AI credit pricing and the features that spend credits (A-12) | product decision |
| O-06 | Done: scheduled evaluation of the canary. A repeatable BullMQ job (`0 * * * *`, Asia/Jakarta) runs `evaluateRunningCanaries`; the actor in the audit row is empty (the system), a canary without enough data writes no row, so the hourly run adds no noise; the cadence is a proposal under D-27 | none |
| O-07 | Payment proof upload still needs the Cloudinary cloud name and API key | carried from RC-21 |

## 6. Components without a reference

`ai/AiGenerating`, `charts/{BarChart,ProgressBar,StatCard}`, `commerce/OrderStatusTimeline`, `gamification/{BadgeGrid,BadgeToast,LevelBadge,RewardToast,SkillTreeLeaf}`, `layout/UserDropdown` (with `MappingUserTopic` and `MappingNotifications`, which use fixed palette classes and English labels), `learn/{MasteryMeter,NextActivityCard,QuizTaker,StreakIndicator}`, `my-learning/{LearningStyleForm,LessonQuizModel,MasteryProgressBar,MisconceptionList,NextActivityCard,ReaderAllContent}`, `ui/{Blackhole,ConfirmDialog,ForbiddenState,Glassy,InsufficientCreditsState,Modal,RetryAction,Sunset}`.

---

## 7. Addendum: learning companion tranche (2026-10-12, later)

What was built after the audit, at the owner's request ([ADR-020](../decisions/ADR-020-learning-companion-citations-and-multimodal-chat.md)):

- The chat of a step is a companion (`tutor-chat-builtin-3`): conversation memory from `GET /internal/chats/{chatId}/context`, the mastery snapshot, the teaching strategy and the micro-learning plan, a robot avatar, replies with numbered citations, and typed actions (`QUIZ`, `IMPROVE_MATERIAL`, `NOTE`) that the learner confirms.
- Every generated text (introduction, material, improved material, practice and placement questions, chat) cites sources numbered in the prompt. The sources are the topic, sub-topic and concept records of the learner (`GET /internal/topic-sources`), retrieved material and, for chat only, the web, ranked by BM25 plus semantic search plus web fused with reciprocal rank fusion. A marker that is not a numbered source is removed and the markers are renumbered by first appearance.
- Notes (`/notes`, page `/my-learning/notes`), a practice quiz persisted through `POST /internal/user-steps/{id}/practice-quiz`, graded with the answer key kept in the API, with distractors tagged by misconception code on the generated practice questions, so a wrong answer can be traced to a misconception (A-11 and O-04 stay open for the other quizzes, and the curriculum concept links still need human approval).
- The chat is docked on the right (reading column capped at `max-w-7xl`), can be maximized, and is multimodal: up to three images per message (button, paste, drag and drop), stored in `ChatAttachment` (PostgreSQL), read by the model through the signed route `GET /internal/chat-attachments/{id}/content`.
- Decisions of section 5 closed in this tranche: D-27 (proposals accepted as the working defaults, still adjustable by the owner), A-15 (`STRIPE_*` and `SUPABASE_*` removed from the `api` block of `docker-compose.prod.yml`), A-16 (Redis `volatile-lru`: only keys with a TTL can be evicted, BullMQ and Celery queue keys are never evicted; every cache key of the code carries a TTL), A-14 (comments removed from source, Dockerfiles, `infra/qdrant/config.yaml` and the backup scripts; applied migrations untouched; the `# syntax=` directive of the Dockerfiles is a parser directive and stays), O-01 (five unreferenced components deleted: `layout/UserDropdown`, `layout/MappingUserTopic`, `layout/MappingNotifications`, `ui/BotLoading`, `my-learning/ReaderAllContent`; the other candidates are named in the `components:extend` alias hook of `nuxt.config.ts` or in the UI plans, so they stay).
- Not done: the judge and frozen benchmark (O-02), DSPy candidates (O-03) and AI credit pricing (A-12) need an LLM budget, human labels or a product decision and are unchanged; O-07 needs Cloudinary credentials the project does not have.

Verification on the dev stack (nginx on port 80, user `e2e.companion.1012@example.com`):

| Check | Result |
|---|---|
| `api` `jest --runInBand` against the scratch database | 204 suites passed, 1 skipped; 2307 tests passed, 5 skipped |
| `api` `tsc --noEmit` | clean |
| `ai-api` `pytest` | 1055 passed |
| `web` `vitest run` | 62 files, 697 tests passed |
| `scripts/check-ownership-rules.sh`, `infra/scripts/check-theme-sync.sh` | pass |
| Migrations `20261012120000`, `20261012130000`, `20261012140000` | applied to dev and scratch, `migrate diff` empty |
| Chat question, no images | reply stored whole, no error toast, status line follows the pipeline (retrieval, web, memory, compose) |
| Image only, image plus text, paste | the model described the equation and the balance sheet that were in the pictures and answered the question; thumbnails survive a reload |
| Fake PNG (text file named `.png`) | refused by the server with 422 and shown as failed; a 27 MB image is refused by the browser before upload |
| `QUIZ` action | five questions built from the topic records, answered 5 of 5, each question lists the sources it came from |
| `IMPROVE_MATERIAL` (simplify) | a new version with markers renumbered from 1, the old version stays readable |
| Note from a chat reply | saved, listed on `/my-learning/notes`, deleted |
| Viewports 375, 768, 1280 (and 1600), light and dark, reduced motion | docked panel at 1280 and 1600 (the reading column stays at most 1280 px), full screen below 1024 px with the page behind it locked, no horizontal scroll, the robot blink animation stops under reduced motion, zero console errors apart from the expected 422 of the fake image |

Found and fixed while running it: the toast "Pesan belum terkirim" (the browser branch of `requestAi` treated the `processing` envelope as a failure), the page CSP (`img-src`) blocked the `blob:` preview of an attached image (`blob:` added to the page CSP only, not to the API or docs CSP), the composer left about 130 px for the text, the header overflowed on a phone, and a non-image file chosen in the picker was dropped silently.

Known limits: semantic retrieval is down on the dev stack (the Hugging Face embedding token answers 402), so dev answers use the topic records, BM25 and the web; the dev database has no `Resource` rows; the practice quiz of the e2e lesson gave no mastery evidence because its concept link (`l1-t09-accounting-cycle`) is still `PROPOSED` and only `APPROVED` links count; a message retried after a failure resends its text only; the first chat message of steps created before this tranche is still the old English sentence; the production image of `ai-api` was not rebuilt from scratch because the network to the PyTorch index was too slow (the dev image is the previous image plus the new source, built from the same `Dockerfile` layers). Fixed in the same tranche: a deep link opened with an expired access cookie (the cookie lives 24 hours, the token 15 minutes) and a valid refresh cookie used to end on the dashboard, because the server-side retry after the refresh still sent the old cookie and the API reads the cookie before the bearer header; `lib/api.ts` and `lib/ai.ts` now drop the old cookie on the retry and reuse the refreshed tokens for the rest of the render (two tests in `request.spec.ts`).

### 7.1 Addendum: intro stream lock, seeds and domain scope (2026-10-12, night)

An e2e run as a fresh learner found that opening the introduction by clicking "Mulai belajar" sat on "Pengantar sedang disiapkan di tab lain" for up to three minutes. The page mounts twice during the layout switch from `focus` to `steps`; the first mount opens an `EventSource` and closes it 42 ms later, the server had already taken the `gen:intro` lock for it and answered the second request `busy`, and the lock was only freed when the first stream noticed the disconnect. `config/generation_lock.py` now hands the lock to the newest request (`claim`, a token per request, `owns`, `release_owned` and `renew_owned` as compare-and-set scripts), the older stream stops with a `superseded` event and never saves, the lock is released in a `finally` and renewed on every stage (TTL 120 s), and the web page treats `superseded` like the old `busy` (wait for the saved text). Tests: `test_intro_stream_route.py` (15), `config/__tests__/test_generation_lock.py` (5).

Seeds: `pnpm seed:user` (one learner, `SEED_USER_EMAIL`, `SEED_USER_NAME`, `SEED_USER_PASSWORD`, falling back to `SEED_ACCOUNT_PASSWORD`) and `pnpm seed:topic` (a complete topic from `prisma/seed-data/*.topic.json`: topic, category, sub-topics with prerequisites, lessons and steps with descriptions; the default file is `akuntansi-usaha-dagang.topic.json`), both idempotent and refused under `NODE_ENV=production`; `seed.ts` shares `seed-account.ts` with them.

Limits found: generation is scoped to the accounting domain (`render_domain_context` writes `Discipline: ACCOUNTING`), so a topic outside accounting gets "di luar cakupan domain akuntansi" as its material; a first seed topic about SQL was therefore replaced by an accounting one. The SQL topic row stays in the dev database because the free order made when the test learner enrolled is financial history (`guard_order` forbids deletes), and the learner catalog has no filter on `isVerified`. A chat reply used to wait about two minutes right after a learning path was created, because the single `celery-worker` (two processes) ran the material task of every step first. Fixed the same night: `config/celery.py` routes `v1.learning.generate_new_content` and `v1.learning.run_chat_action` to a `chat` queue, `celery-chat-worker` consumes only that queue and `celery-worker` only the default one (both compose files, `config/__tests__/test_celery_routes.py`); the same reply now arrives in about 8 seconds.

## 8. Addendum: placement quiz hardening and audit of open items (2026-10-14)

Baseline before any change, measured on this machine: `scripts/check-ownership-rules.sh` PASS, `infra/scripts/check-theme-sync.sh` OK, `api` `tsc --noEmit` clean, `api` `jest --runInBand` against the scratch database 206 suites passed and 1 skipped (2519 tests passed, 5 skipped), `ai-api` `pytest` 1068 passed, `web` `vitest` 62 files and 699 tests passed. The scratch database listens on the published port of the compose `postgres` (`docker compose port postgres 5432`, 5434 here), not on `POSTGRES_PORT` of the root `.env` (5433 belongs to another project).

The open items of section 5 were re-checked against the code instead of the notes. Those that need the owner (O-02, O-03, A-12, O-07, approval of `PROPOSED` concept links, embedding credits) are unchanged. The check of the learning flow found a class of defects that no earlier tranche covered: the placement quiz ("Kuis jalur belajar", `PersonalityQuiz`), which the `AGENTS.md` rules of DTO integrity and answer-key privacy had not reached.

| ID | Sev | Finding | Evidence | Status |
|---|---|---|---|---|
| A-17 | High | `POST`, `PATCH /:id` and `DELETE /:id` of `/learning/personality-quizzes` were open to the owner although no client calls them: a learner could write `result.level`, `questions`, `userAttempt` and even `userId` (the `@ScopeToUser` interceptor pins `userId` on `POST` only, `PATCH /:id` is guarded by ownership alone) | the spec `personality-quizzes.controller.security.spec.ts` answered 201, 200 and 200 for a student before the change | Fixed: ADMIN only; the AI service keeps writing through `POST /internal/personality-quizzes` |
| A-18 | High | The level was computed from the `answer` that the client put in its own request, the learner received the answer key with the questions, and an empty attempt gave `NaN` and therefore `expert` | `PersonalityQuizzesService.submitAttempt` (git `HEAD`), `PersonalityQuiz.vue` echoed `current.answer` | Fixed: `placement-grading.ts` grades from the stored key (same thresholds, same result shape), refuses an empty, partial, duplicated or foreign attempt, and `placementForViewer` removes `answer` from `questions` and `userAttempt` for everyone but ADMIN |
| A-19 | Medium | A submission could be repeated and queued a new generation job every time; the job took `topicId`, `lessonId` and `learningStyleId` from the query string, so a learner could ask for steps of any lesson, including a paid topic, with the learning style of another learner | same method; no entitlement check between the controller and the `user-steps` queue | Fixed: the claim is one atomic `updateMany` on `takenAt IS NULL` (second request answers 409 `INVALID_STATE_TRANSITION`), the job carries the lesson and topic read from the stored quiz, the learning style must belong to the caller for that topic (403 `ENTITLEMENT_REQUIRED`), and the claim is given back when the job cannot be queued so the learner can try again |
| A-20 | Medium | The web showed "Jawabanmu terkirim" whatever the server answered: `useApi.call` does not throw and `request` returns a failure envelope | `PersonalityQuiz.vue` ignored `respon` | Fixed: `lib/placement-quiz.ts` (`submitOutcome`, `attemptFor`), a conflict counts as already submitted, other failures show a message and keep the dialog open |
| A-21 | Low | The persisted `learning` store (topic and learning style ids) was never reset: it survived a sign out and was reused by the next account in the same browser | `resetAll` had no caller | Fixed: the three sign out handlers call `resetAll()` (which now also clears `userStepId`), guarded by `logout-reset.spec.ts` |

Evidence of the fix: `personality-quizzes.controller.security.spec.ts` (HTTP, real guards), `placement-grading.spec.ts`, `submit-attempt-job.spec.ts` and `personality-quiz-submit.int.spec.ts` (real database: two parallel submissions let exactly one through and queue one job; removing the `takenAt IS NULL` condition makes exactly that test fail), `placement-quiz.test.ts`, `logout-reset.spec.ts`. The five placement quizzes of the dev database all satisfy the new learning style rule (read only `SELECT`). The `api` and `web` images were then rebuilt and deployed to the dev stack (rollback tags `pre-rc24-20261014`), and the quiz was run in a real browser with a throwaway learner (removed afterwards): see section 8.1.

Found and not changed (each needs a decision, or is outside this change):

| ID | Sev | Finding | Why it waits |
|---|---|---|---|
| A-24 | Low | `POST /users-steps/generate` answers 200 with `{error}` | mitigated: `AiServiceClient` turns such a body into a retryable `AiServiceError`; the remaining flaw is that a permanent refusal is retried too |
| A-25 | Low | `services/api` has no ESLint configuration (ESLint 9 needs `eslint.config.*`), so `pnpm lint` cannot run | tooling, not touched |
| A-26 | Medium | Free text placement questions (`input`, `scenario`) store a rubric in `answer`; an exact comparison never matches, so they count as wrong and stay in the denominator, which lowers the level of every learner | needs the judge of O-02, or a decision to leave them out of the level |

### 8.1 Addendum: Arcjet key, deployment and browser check (2026-10-14, later)

A-22 is fixed at the owner's request ("Arcjet is already set up"). `app.module.ts` passed `process.env.ARCJET_API_KEY`, a name that compose, `.env.example` and the running container never set, so Arcjet was configured without a key. The SDK decides `fixedWindow` on the Arcjet server and fails open when that call fails (`ArcjetErrorDecision`, which is not a denial), so none of the seven limits of `auth.controller.ts` (`limit()`) was enforced. The code now reads `ARCJET_KEY` through `common/config/arcjet.ts` (`arcjetKeyFrom`), the API logs a warning at boot when it is empty (`main.ts`), and `arcjet.spec.ts` fails if the old name comes back or if compose stops passing `ARCJET_KEY` to the `api`.

Live check on the rebuilt `api`: seven to twelve wrong-password logins through nginx from one forwarded public address. Attempts 1 to 5 answered 400 `Invalid email or password`, attempt 6 answered 429 `Too many login attempts`, and most later attempts answered 429 in about 0.1 s. One of twelve slipped through with a latency of about 0.74 s (the SDK waits 500 ms in production, then lets the request pass), so enforcement is best effort when the Arcjet API is slow. An address from a reserved range (198.18.0.0/15) was never limited, because the SDK finds no public client address (a request that carries only private addresses, such as local testing, is not limited either).

Because the limits now exist for the first time, their values were reviewed the same day. Counted by public address only, register at 3 per 5 minutes and refresh at 10 per 5 minutes would have locked out a class on one campus network (a refused refresh ends the session). The limits are now two Arcjet rules per route (`v1/auth/auth-limits.ts`, `AuthController.limit`): a loose one per address and a strict one per email address, with the route name as an extra characteristic so that every route has its own counter. Values are a proposal (D-28):

| Route | Window | Per address | Per email address |
|---|---|---|---|
| register | 5 min | 60 | 3 |
| login | 1 min | 120 | 10 |
| verify email | 10 min | 120 | 10 |
| forgot password | 15 min | 30 | 3 |
| resend code | 5 min | 60 | 5 |
| reset password | 15 min | 30 | 5 |
| refresh token | none in Arcjet | | |

The email address leaves the API only as an HMAC (`emailKey`, key derived from `OTP_HMAC_SECRET` or `JWT_REFRESH_SECRET`), because custom properties of `protect()` are sent to Arcjet. The refresh route is no longer asked about: its tokens are single use and rotated, and nginx already throttles it. Live check on the rebuilt `api` (rollback tag `pre-arcjet-limits-20261014`): one email tried from twelve different addresses answered 400 ten times, then 429; fourteen different emails from one address all answered 400; and `forgot-password` for the email that was exhausted on login still answered 201.

Trade-off to know: a per email limit lets someone who sends more than 10 wrong logins per minute for a victim's address keep that victim waiting; the window is one minute and it ends when the sender stops. Remaining decision for the owner: production must hand the real client address to nginx. The SDK takes the rightmost public address of `X-Forwarded-For`, so a private proxy in front of nginx lets a caller choose its own address (`set_real_ip_from` in `infra/nginx/conf.d/00-common.conf` only trusts `10.0.0.0/8` and `172.16.0.0/12`), and the per email rule is the one that still protects an account in that case.

Browser check (Playwright, isolated contexts, throwaway learner and quiz in the dev database, deleted afterwards): the quiz dialog and the page behind it at 375, 768 and 1280 CSS px (`innerWidth` verified), light and dark, reduced motion on and off, no horizontal overflow, no console error other than the failures injected on purpose, no answer key in the DOM. A 403 answer shows "Kamu belum terdaftar di topik ini atau gaya belajarmu belum terisi." and keeps the dialog open without a success toast, a 500 shows the generic message, a 409 is reported as already submitted, and a real submission stored `{"level": "intermediate", "scores": {"Kas": 10, "Utang usaha": 0, "Modal pemilik": 10}}` computed from the stored key (the wrong second answer scored zero) and queued a job whose ids came from the stored quiz (`UserStepsProcessor` completed and 18 steps with their chats were generated; the Hugging Face 402 only blocked memory and retrieval, as before). The first run of this check used viewports in device pixels by mistake (the Playwright browser runs at devicePixelRatio 1.5, so a viewport of 375 gave `innerWidth` 250) and reported an overflow that does not exist; the second run set 563, 1152 and 1920 and asserted `innerWidth`.

Counts before the limit review: `api` `jest --runInBand` against the scratch database 210 suites passed and 1 skipped (2583 tests passed, 5 skipped), `tsc` clean, `web` `vitest` 64 files and 716 tests, `ai-api` `pytest` 1068 (unchanged).

A-23 is closed by removal (the owner asked to continue after the recommendation): the `content` BullMQ queue, `ContentProcessor`, `QueueService.addContentEmbeddingJob`, `ContentEmbeddingJobSchema` and the `QueueService` dependency of `ContentsRepo` are gone, so `PATCH /chat/contents/:id` no longer queues a job that could only fail. Nothing read `Content.isEmbedded`, `embeddingAt` or the job status, and the similarity of chat contents is lexical in `api`. The columns stay in the schema. The processor had called `${AI_URL}/v1/resources/embedding/content` with a bare `fetch`, bypassing the signed client of ADR-013, so `scripts/check-ownership-rules.sh` now fails on any use of `AI_URL` in `services/api/src` outside `common/ai-client/` (proved with a planted file). The dev Redis held only the `meta` and `stalled-check` keys of that queue; on any environment where content jobs failed, remove the leftover keys once: `redis-cli --scan --pattern 'bull:content:*' | xargs -r redis-cli del`. To bring embeddings of chat contents back, add an `ai-api` route that follows the governance metadata of ADR-016 and call it through `AiServiceClient`.

## 9. Addendum: marketplace personalization, review schedule, AI prompt proposals and the step path (2026-10-16)

Baseline before any change, measured on this machine: `scripts/check-ownership-rules.sh` PASS, `api` `jest --runInBand` against the scratch database 210 suites passed and 1 failed (2612 tests passed, 1 failed, 5 skipped), `ai-api` `pytest` 1068 passed, `web` `vitest` 716 passed. The one failing test was `articles.int.spec.ts` ("needs review before anything becomes visible"): the scratch database had accumulated 56 articles in `PENDING_REVIEW` from earlier runs and the test read page 1 (limit 50) of the global queue; it now asks for the queue of its own tenant (A-31).

| ID | Sev | Finding | Evidence | Status |
|---|---|---|---|---|
| A-27 | High | Marketplace recommendations were a placeholder: `matchesGoal`, `matchesDifficulty` (articles) and `matchesPrerequisites` were `true` for every product, the learner signals that the controller loaded (topics, sub-topics) were never read, every published product was read on each call, the reason text was a template, and the web turned the constant signals into "Dekat dengan topik yang sedang kamu pelajari" and "Populer di kalangan pelajar", which nothing measured; a learner without evidence was raised to the intermediate level (`Math.max(0.4, ...)`) | `marketplace-discovery.service.ts` and `.controller.ts` (git `HEAD`), `lib/marketplace.ts` `recommendationReason` | Fixed (ADR-021) |
| A-28 | Medium | A product had no link to any concept, so "personalized by mastery" could not be true and a creator could not say what a product teaches | `schema.prisma` (`Article`, `ClassProduct`) | Fixed: `ProductConceptLink`, studio picker, review with the product |
| A-29 | Medium | Micro-learning stopped at the size of one lesson: mastery never aged, `REVIEW` was only reachable from the `PRACTICE` intent after seven idle days, and no screen asked a learner to review | `learner-policy.service.ts`, `mastery-v1.ts`, no route or page | Fixed: `review-v1` schedule, `GET /learner-model/me/review`, review card, one tap to a three question quiz |
| A-30 | Medium | The self-improving loop had no source of candidates: every `PromptVersion` was typed by an administrator (layer 4 of the plan) | `prompt-registry.service.ts` | Partly fixed (ADR-022): an administrator can ask the model for one edit from measured evidence, saved as a draft with a human gate; the frozen benchmark and the judge (layer 2) are still open |
| A-31 | Low | `articles.int.spec.ts` failed once the scratch database held 50 or more pending articles | see above | Fixed |
| A-32 | Medium | The steps of a lesson were only a plain collapsible list behind a toggle; the Duolingo style path existed for sub-topics but not for steps | `layouts/steps.vue`, `StepLearningCollapsible.vue` | Fixed: `LessonStepPath` on the lesson page and in the steps panel (section banners, done, current and locked nodes, the open step marked) |
| A-33 | Medium | The Optimasi AI form refused every valid template: the web list of placeholders lacked `conversation`, `current_material` and `learner_name`, so "Mulai dari prompt bawaan" then "Usulkan" always answered "Penanda {{learner_name}} tidak dikenal" | `lib/admin.ts` `TEMPLATE_PLACEHOLDERS` against `prompt-contracts.ts` | Fixed, with a test that reads the API contract and compares |
| A-34 | Medium | Tags were locked on every product that was not a draft, so the products that were already published (the whole catalog on the first day) could never be recommended and the owner decision "tags on already published products" stayed open | `ArticleAuthoringService`, `ClassAuthoringService`, moderation services | Fixed: authors propose tags on waiting and live products through `PUT .../concepts`, administrators approve or reject them separately (ADR-021 addendum); removal is immediate; a queue filter and a counter on the admin page; integration tests on the scratch database |
| A-35 | Medium | The journey page "Pengantar" called the generator with an empty learning style id when the learner had no style profile for the topic: the API answered 400, the page said "Pengantar belum berhasil dibuat" and the progress panel under it read "Tahap selesai, tinggal giliranmu" with one failed stage | `pages/my-learning/steps/index.vue`, `AiGenerating.vue`, `lib/learning-ids.ts` | Fixed: the page checks the topic and the learning style before it calls the API and shows "Lengkapi pengaturan belajarmu dulu" with a link to the topics; the panel says "Ada tahap yang belum berhasil" whenever a stage failed; unit tests for both |

What changed:

- `api`: `ProductConceptLink` (migration `20261016100000_product_concept_links`, exactly one product per link, unique per product and concept, at most five per product by trigger), `conceptIds` on article and class create and update, links approved in the transaction of the product approval and shown to the reviewer, `concepts` on the public listing, `reco-v1` ranking (`recommendation-ranking.ts`) and `MarketplaceDiscoveryService`, `review-v1` (`learner-model/review/`), `GET /learner-model/me/review`, `GET /learner-model/concepts`, `PromptProposalService`, `PromptEvidenceService` (name, e-mail and link redaction), `POST /admin/optimization/prompts/propose-improvement`, `PromptRegistryService.baseline` and an origin on proposals.
- `ai-api`: `v1/prompt_proposals` (`POST /ai/v1/prompt-proposals`, service identity, task `prompt_proposal` on the thinking model), the placeholder, protected sentence and size checks, a parity test with the API contract.
- `web`: concept picker in the studio, concept chips and real reasons on marketplace cards and detail pages, review card, `?ulas=` quiz start in the chat, step path, AI proposal button with diff, contract fix of the template form.

Verification (Docker stack, `api`, `ai-api`, workers and `web` rebuilt, dev database migrated with `20261012150000_sandbox_practice` and `20261016100000_product_concept_links`, `migrate diff` empty; rollback tags `pre-reco-20261016` and `pre-proposals-20261016`):

| Check | Result |
|---|---|
| `api` `jest --runInBand` against the scratch database | 219 suites passed and 1 skipped; 2817 tests passed, 5 skipped, 0 failed |
| `ai-api` `pytest` | 1111 passed |
| `web` `vitest` | 68 files, 805 tests passed |
| `api` `tsc --noEmit`, `scripts/check-ownership-rules.sh` | clean, PASS |
| Review card on a throwaway learner (20 days old concept, 2 days old weak concept) | two concepts listed with 8 percent and 45 percent recall, the button opened the step, the dock opened, CORE asked for a three question quiz, the real gateway built it, the quiz was graded by the API, and the concept left the due list |
| Recommendations for the same learner | cards ordered by need ("penguasaanmu baru 45%", "waktunya kamu mengulang"), a class got the level note, products with no matching need appeared only as "Terbaru di marketplace." |
| Studio picker as a creator | 65 concepts listed, search "debit" gave 3, one tag saved, the draft showed "Menunggu ditinjau", the database held a `PROPOSED` link by the author |
| Step path on a six step lesson | two section banners (2/3 and 0/3), two done, one current ("Mulai"), three locked nodes, the open step marked with `aria-current`, links carry `lessonId` |
| AI proposal on the live model with synthetic evidence | one edit in 8.3 s, similarity 0.962, +101 characters, rationale in Indonesian; every guard passed |
| AI proposal button in the admin page | refused with "Baru 6 jawaban dari tutor-chat-builtin-3 yang terukur. Usulan AI butuh minimal 30." (the dev database holds 6 turns) |
| Review card, recommendation shelf and mastery page at 375, 768 and 1280 px, light and dark, one run with reduced motion | zero console errors, no horizontal overflow, card padding 20 px |
| An automatic scan of 20 learner pages (375 px light, 1280 px dark), 10 studio pages and 11 admin pages (same sizes): console errors, failed requests, overflow, landmarks, headings, names of buttons, links and fields, duplicate ids | clean apart from the expected 409 of the AI proposal guard and the 400 of a learner with no learning style; the three findings (a button 8 px too wide, a skipped heading level, the template form) were fixed and checked again |
| Contrast of the new text (canvas measured, light and dark) | review card heading 10.4 and 10.1, muted text 5.0 and 4.9, section banner 5.2 and 8.1, "Mulai" bubble 5.2 and 6.9, locked step title 5.3 and 7.5 (all at least 4.5) |
| Tags on live products (throwaway creator and administrator, one published article and one published class) | The studio shows a separate "Simpan tag" editor with the hint for a published piece; two tags saved as `PROPOSED` ("Menunggu ditinjau"); the admin queue filter "Hanya yang punya tag menunggu" listed the article with "2 tag menunggu", the detail listed both concepts, approving left the queue empty and the database held two `APPROVED` links with the audit rows `ARTICLE_CONCEPTS_UPDATED` and `ARTICLE_CONCEPTS_APPROVED`; for the class, rejecting with an empty reason kept the dialog open ("Alasan wajib diisi"), rejecting with a reason removed the link and wrote `CLASS_CONCEPTS_REJECTED` with that reason; no console errors and no horizontal overflow at 375 px and 1280 px; fixtures archived and the accounts deactivated |

Found and fixed while checking in the browser: the review card reused the class `rc-review`, which the quiz result list already used (`padding: 0`, bold rows), so the card lost its padding (renamed `rc-relearn`); the first version of the review card and of the concept picker rendered a loading branch only on the client, which logged "Hydration completed but contains mismatches" (card now client only, picker waits for mount); the dock did not stay open after the automatic quiz because the second mount of the steps page restored the stored state (`useChatDock().show` stores it); the AI proposal button was 8 px wider than a 375 px screen; the achievement tiles skipped a heading level. `fullPage` screenshots of the shared Playwright browser are 14 px narrower than the page (the scrollbar) and make a correct page look clipped: do not read layout from them.

Not done and waiting for the owner: the judge and the frozen benchmark (O-02), DSPy candidates and a scheduled proposer (O-03), AI credit pricing (A-12), tags on the published products that exist today (a published product is locked until it is withdrawn or versioned), a per tag review by the reviewer, the measured effect of reviews on later mastery, and the values of D-29 (weights of `reco-v1`, constants of `review-v1`, limits of the proposer).

## 10. Addendum: sandbox on the web, variants, the UTBK course, the review reminder and the word "course" (2026-10-16, second tranche)

| ID | Sev | Finding | Evidence | Status |
|---|---|---|---|---|
| A-36 | High | The web sandbox did not work: it called `POST /sandbox/journal/validate`, which no longer exists, read the catalog as a list (three cards titled "· Level") and the scenario page answered a 500 on a server render | `pages/sandbox`, `lib/api.ts` against `sandbox.controller.ts`; the browser showed "500 Server Error" on `/sandbox/j-setor-modal` | Fixed: rebuilt on the real API (ADR-023), 20 unit tests |
| A-37 | Medium | After a reload the account of a restored journal row showed "Pilih akun" while the value was still sent, because the `value` of a server rendered select is not applied at hydration; a hydration mismatch warning appeared on any scenario with progress | browser, `JournalEntryGrid.vue` | Fixed: each option carries `selected`, the page awaits its data |
| A-38 | Low | Opening a second hint right away was answered with a 429 and a generic message | browser | Fixed: the button waits 4 seconds with a visible count |
| A-39 | Medium | `ConceptSeeder` rewrote prerequisites, aliases and curriculum links from one topic only, so a second topic would have deleted the links of the first | `concept-seeder.ts` (`deleteMany notIn`) | Fixed: `extraLinks` lists more than one topic, validated and resolved together; seed and integration tests |
| A-40 | Low | The sandbox form card was 704 px wide while the cards around it were full width, and the columns of a journal row were not aligned at the top | browser, geometry of the cards | Fixed: one column width for the page and top aligned columns |
| A-41 | Medium | The sandbox only served accounting, so a learner on the SQL or UTBK course had no practice | the course list against `pages/sandbox` | Fixed: a hub that maps a course to a mode, a SQL playground on its own database and a tryout generator ([ADR-025](../decisions/ADR-025-sandbox-modes-sql-playground-and-tryout.md)) |
| A-42 | High | Learner SQL must not reach the application database or the host: a role may change its own session settings, so a role limit alone does not hold the timeout | design review of `sandbox_runner`, tests with the guard bypassed | Mitigated in three layers: a tokenizing guard (the only stop for `set_config`), the role and its limits on a separate `sandbox-db`, and one statement per message through the extended protocol; a watchdog ends a backend that outlives 9 seconds. Residual: no disk quota on the memory-backed volume |
| A-43 | Medium | Two options in a generated conditional question were also true (a converse implication follows when the premise is known), found only by checking every option against a truth table | `tryout-engine.spec.ts` | Fixed: no conditional statement among the distractors where the premises fix its truth; the spec now proves for 40 seeds that exactly the marked option follows |
| A-44 | Low | A result with a top level `message` key (the check feedback) was unwrapped by the response wrapper and `data` came back null | live call on the first build | Fixed: the keys are `feedback` and `notice`; both specs assert that no payload has a top level `message` or `data` |
| A-45 | Low | The course matcher read "jurnalistik" as accounting | `playground.test.ts` | Fixed: whole word matching |

What changed:

- `api`: variants of a solved scenario (`GET` detail, `POST` check and reveal under `/sandbox/scenarios/{id}/variants/{seed}`), amount scaling in `sandbox-content.ts` with a guard on content, the review reminder (migration `20261016140000_review_reminders`, `ReviewReminderService`, processor, scheduler, `PUT /learner-model/me/review/reminders`, `reminders` in the review answer), `ConceptSeeder` for several topics.
- `web`: sandbox index and scenario pages with `JournalEntryGrid`, `DebitCreditTotal`, `CheckResultPanel`, `HintPanel`, `SolutionPanel`, the variant page `/sandbox/variasi/{id}`, the reminder switch on the review card, a button on the `REVIEW` notification, and the journey page that explains a missing learning style (A-35).
- Content: the course "Persiapan UTBK-SNBT" (`utbk-snbt.topic.json`: 8 sub-topics, 19 lessons, 39 steps) written from the official framework of SNPMB for UTBK-SNBT 2026 (snpmb.id/fr), with 18 concepts and their curriculum links (`utbk-snbt.concepts.json`) so mastery, review, strategy and recommendations work for it. The links are `APPROVED` in the file on the owner's request (D-30).
- Wording: the learning unit is called "course" in the interface instead of "topik" (owner's request); the routes and the API names are unchanged.

Verification (Docker stack, `api` and `web` rebuilt, dev database migrated with `20261016140000`, `migrate diff` empty; rollback tags `pre-sandbox-20261016`, `pre-variants-20261016` and `pre-reminders-20261016` for the images, and a dump before the migration):

| Check | Result |
|---|---|
| `api` `jest --runInBand` against the scratch database | 223 suites passed and 1 skipped; 2881 tests passed, 5 skipped, 0 failed |
| `web` `vitest` | 69 files, 829 tests passed |
| `api` `tsc --noEmit`, `scripts/check-ownership-rules.sh`, theme sync | clean, PASS, OK |
| Sandbox as a throwaway learner | the catalog listed 40 scenarios with a recommendation and progress; a wrong journal showed "Sisi tertukar" per row and the finding; a hint, a visible wait, then the right journal wrote evidence (mastery 50 to 52 percent, +2 XP) and showed the key; after a reload the rows came back with their accounts; no console error and no horizontal overflow at 375 and 1280 px |
| Variant of a solved scenario | the story had other amounts (Rp1.440.000 for Rp1.200.000), the original amounts were judged "Jumlah belum tepat", the scaled amounts were judged right and showed the key, "Coba angka lain lagi" moved to the next variant, an unsolved scenario and a bad seed were refused |
| UTBK course | listed under Courses, detail page with the 8 sub-topics, 83 concepts in the registry of which 18 start with `utbk-` |
| Review reminder | the sweep sent one notification to a learner with a fading concept, the second run was paused, the notification showed a "Mulai ulasan" button, the switch on the review card turned the reminder off and on and said so in words |
| The word "course" | the menu, the page titles, the empty states and the toasts say Courses and course; no "topik" is left in the interface text except the diagnostic questions that use it as an ordinary word |

Found while checking and left alone: a screenshot taken after scrolling shows a blank band at the top of any page in the browser tool of this session (the marketplace and the landing page too), so it is an artifact of the tool and not a layout defect; geometry (`getBoundingClientRect`) was used instead.

Not done and waiting for the owner: D-30 and D-31 (see the register), the launch segment question that UTBK raises (ADR-012 chose university students first and UTBK learners are mostly pre-university and may be under 18, see D-02), and the same items as section 9.
