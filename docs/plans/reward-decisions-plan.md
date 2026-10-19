# Reward and Streak Decisions D-22 and D-25 — Implementation Plan

> **Status**: `done` · **Owner**: `api-lead` · **Last reviewed**: `2026-10-17`
>
> Close the gap between the accepted text of D-22 and D-25 and the code, then record the acceptance.

Decision: [ADR-028](../decisions/ADR-028-reward-and-streak-decisions-accepted.md). Builds on ADR-015, ADR-018 and ADR-026.

---

## Audit findings that shape the plan

| # | Finding | Evidence | Consequence |
|---|---|---|---|
| 1 | The values of the catalog, the 12 level thresholds and the 11 achievements already equal the proposals | `reward-rules.ts`, `default-catalog.ts`, `me/level-progress.ts`; dev rows of `RewardRule`, `LevelThreshold`, `Achievement` | nothing to change, only to pin and to accept |
| 2 | Any quiz with evidence extends the streak, even at a score of zero | `quiz-attempts.service.ts` calls `afterAssessment` for every graded attempt without a hint; `AssessmentGamifyService` always called `onQualified` | RD-02: a streak day needs a passed assessment |
| 3 | Two legacy read routes expose score rows with their users and accept arbitrary filters | `leaderboards.controller.ts`, `leaderboards.repo.ts` (`where[key] = q[key]`, `include user`); live read of another learner's row with name and email | RD-01: delete them |
| 4 | The authorization matrix says "row-level rules enforced in the service" for those routes | `AUTHORIZATION_MATRIX.md` | remove the rows |
| 5 | A freeze cannot be bought | grep of `freeze` in commerce, credits, orders finds no purchase path | nothing to build |
| 6 | The docs say thirteen level rows; the code and D-25 say twelve | `play-ui-and-themed-gamify.md` | correct the doc |

## Step-by-step

| ID | Task | Verify |
|---|---|---|
| RD-01 | Delete `LeaderboardsController` and `LeaderboardsService`, strip `findAll` and `findOne` from the repository, keep only the topic board | `board-surface.spec.ts` fails before and passes after; route-access spec; live 404 |
| RD-02 | `passed` on `AssessmentGamifyInput`; `StreakEngineService.standing`; quiz passes `score >= passingScore`; sandbox passes on a correct journal | unit specs for the service and the quiz, integration spec for `standing`, live as a learner |
| RD-03 | Web copy: streak states, streak page, support answer, auth pitch, landing demo; quiz result shows the passing score | `vitest`, browser |
| RD-04 | Docs: ADR-028, register, matrix, AGENTS, ledger doc, tracker RC-31, memory | review |

## Rollback

Images before this plan: `reducera-api:pre-reward-decisions-20261017` and `reducera-web:pre-reward-decisions-20261017`. No migration.

## Progress

| ID | State | Evidence |
|---|---|---|
| RD-01 | [x] | `LeaderboardsController` and `LeaderboardsService` deleted, repository reduced to writes, matrix rows removed; `board-surface.spec.ts` (4 tests) red before and green after; live as a learner: `GET /gamify/leaderboards` with and without `cohortId`, by id and with `include=user` answer 404, the topic board and `gamify/me` answer 200 |
| RD-02 | [x] | `passed` on `AssessmentGamifyInput`, `StreakEngineService.standing`, quiz passes `score >= passingScore` (default 70), sandbox passes on a correct journal; unit specs (service and quiz), integration specs (`standing` in `streak-engine.int.spec.ts`, a failed, an empty and a passed attempt on a real database in `quiz-evidence.int.spec.ts`) |
| RD-03 | [x] | streak copy, streaks page, support answer, auth pitch, landing demo and the quiz result (passing score shown when not reached); web 76 files and 970 tests; live at 375 and 1280: new wording present, no overflow, zero console errors |
| RD-04 | [x] | ADR-028, register D-22 and D-25 `ACCEPTED`, matrix, `AGENTS.md`, ledger doc invariant, tracker RC-31, memory; api 246 suites and 3379 tests on a fresh scratch database, `tsc` clean, ownership gate and 14 ai-api gate tests pass |
