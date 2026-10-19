# Dynamic Gamification Admin — Implementation Plan

> **Status**: `done` · **Owner**: `api-lead` · **Last reviewed**: `2026-10-17`
>
> Ordered tasks that give an administrator the write side of the gamify rows: publish a new reward rule version, change level thresholds, add and retire achievements, and tune the streak freeze, all without a deploy or a seed.

Decision: [ADR-026](../decisions/ADR-026-gamify-rules-administered-as-data.md). Builds on [ADR-018](../decisions/ADR-018-play-ui-and-db-defined-gamify.md) (rules as rows) and [ADR-015](../decisions/ADR-015-reward-ledger.md) (versioned rules, append-only ledger).

---

## Objective

ADR-018 moved reward rules, level thresholds and the achievement catalog into rows and said that a changed number is a new rule version. Nothing could create that version except a seed script or SQL. After this plan an administrator does it from `/admin/gamify`, every change is audited, and a new version cannot pay a learner twice for something already paid.

## Audit findings that shape the plan

| # | Finding | Evidence | Consequence |
|---|---|---|---|
| 1 | No route or screen writes `RewardRule`, `LevelThreshold` or `Achievement`; only `GamifySeeder` does | `services/api/src/v1/gamify`, `apps/web/app/pages/admin` | the "new version" rule of AGENTS.md cannot be used by the owner (D-22 and D-25 values are proposals the owner is meant to tune) |
| 2 | `CONCEPT_PASSED` and `PATH_NODE_MASTERED` idempotency keys contain the rule version (`conceptPassedKey`, `nodeMasteredGrant`) | `rewards/reward-rules.ts` | publishing version 2 would pay every concept and node again; latent today because no second version can exist |
| 3 | Freeze every 7 days and at most 2 held are constants (`DEFAULT_STREAK_CONFIG`) although ADR-018 names `STREAK_FREEZE_EARNED` as a rule row | `streaks/streak-fold.ts`, `streak-engine.service.ts` | the streak cannot be tuned as data |
| 4 | `RewardRule.dailyCap` is stored and never read by the engine | `reward-rules.ts` | the admin form must not offer a cap that does nothing |
| 5 | Level thresholds have no guard on shape (first level at 0, strictly increasing) outside the seed | `LevelThreshold` has only `level >= 1` and `xp >= 0` checks | a replace route must validate the whole list |
| 6 | Achievement `type` duplicates what the rule metric already says | `seed/default-catalog.ts` | derive it on the server, do not accept it from the client |

## Scope

| Area | Created | Edited |
|---|---|---|
| `services/api` | `gamify/admin/{rule-catalog,rules-admin.service,levels-admin.service,achievements-admin.service,gamify-admin.controller,gamify-admin.dto,gamify-admin.module}.ts`, specs, integration spec | `rewards/{reward-rules,reward-engine.service,node-reward.service}.ts`, `streaks/streak-engine.service.ts`, `seed/*`, `v1.module.ts` |
| `apps/web` | `pages/admin/gamify.vue`, `components/admin/gamify/{GamifyRulesPanel,GamifyLevelsPanel,GamifyAchievementsPanel}.vue`, `lib/gamify-admin.ts`, `composables/useGamifyAdmin.ts`, specs | `services/admin.ts`, `interfaces/admin.ts`, `lib/admin-nav.ts`, `lib/admin.ts` (audit labels), `assets/css/admin.css` |
| repo | gate lines in `scripts/check-ownership-rules.sh`, ADR-026 | `AGENTS.md`, `docs/architecture/AUTHORIZATION_MATRIX.md`, tracker RC-28, memory |

Rules for every task: no comments in code or configuration; never `git add`, `commit` or `push`; failing test first; everything runs in the `tools` containers; database specs only on the scratch database; verify the web in a browser through Playwright.

## Step-by-step

| ID | Task | Verify |
|---|---|---|
| DG-01 | A once-per-cause grant is once across versions: `CONCEPT_PASSED` and `PATH_NODE_MASTERED` look for an earlier original entry of the same learner and cause under any version before they grant | unit specs with a version 2 rule and an entry paid under version 1 |
| DG-02 | `STREAK_FREEZE_EARNED` becomes a rule row (`amount` = qualified days per freeze, `params.maxHeld`), read by the streak engine, with the old constants as the default when no row exists, and seeded | unit specs of `buildRuleSet` and the engine, seeder spec |
| DG-03 | Rule catalog: per rule code, the fixed event type and kind, the editable fields with bounds and labels, and a Zod schema that rejects everything else | spec per code: bounds, strictness, unknown code |
| DG-04 | `RulesAdminService`: list with versions and the effective one, publish a version (advisory lock per code, `baseVersion` check, built-in default materialized as version 1 when no row exists, previous active retired, audit), activate an older version (rollback), deactivate a code (rule off) | unit specs and integration spec on the scratch database |
| DG-05 | `LevelsAdminService`: list and replace the whole ladder (2 to 30 levels, contiguous from 1, first level at 0 XP, strictly increasing XP), one transaction under an advisory lock, audit with before and after | unit and integration specs |
| DG-06 | `AchievementsAdminService`: list with unlock counts, create (code, texts, icon from the closed vocabulary, typed rule, type derived), update presentation fields only, activate and deactivate; the rule never changes after creation | unit and integration specs |
| DG-07 | Controller `admin/gamify/*` (ADMIN only, strict bodies), module in `v1.module.ts`, access decisions, authorization matrix rows | controller spec (401, 403 student and teacher, 400 extra field, 200), `route-access.spec.ts` |
| DG-08 | Ownership gate: only the admin services and the seeder write `rewardRule`, `levelThreshold` and `achievement`; `AGENTS.md` "Rewards" updated | `bash scripts/check-ownership-rules.sh` and its gate test |
| DG-09 | Web: `/admin/gamify` with rules (form generated from the catalog the API returns, version history, activate, deactivate), levels editor, achievements list and form; menu entry; audit labels | `vitest` for the pure helpers, Playwright at 375, 768 and 1280, light and dark |
| DG-10 | Docs, ADR-026, tracker RC-28, memory; full suites; deploy `api` and `web`; seed the dev database; live check as admin and as learner | checks of the list |

## Acceptance criteria

1. An administrator publishes version 2 of a rule; the next graded assessment is paid with version 2 and the ledger entry says `ruleVersion: 2`; entries of version 1 are untouched.
2. After version 2 exists, a learner who already passed a concept or mastered a node is not paid for it again.
3. A rule row cannot be edited, only retired and replaced; a stale `baseVersion` answers 409; two simultaneous publishes create one version.
4. A student or a teacher gets 403 on every route; a body with an unknown field gets 400; every change writes an audit entry with before and after.
5. Freeze cadence and the number held come from the rule row; a deactivated rule pays nothing and earns nothing.
6. The level ladder cannot be saved with a gap, a duplicate XP value or a first level above 0.
7. The page works at three widths in both schemes with zero console errors, and a change made on it shows in `GET /gamify/me` of a learner.
8. API `jest` (with the scratch database), `tsc`, web `vitest`, ownership and theme gates pass; the stack is healthy.

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| A new version double pays | High | DG-01 first, with a failing spec |
| Two admins publish at once | Medium | advisory lock per code plus `baseVersion` |
| A level ladder change lowers a learner's level | Medium | audited with before and after; the page warns; level is derived on read so nothing is rewritten |
| The form drifts from the engine | Medium | the form is generated from the catalog that the same module validates with |

## Rollback

- Images before this plan: `reducera-api:pre-gamify-admin-20261016` and `reducera-web:pre-gamify-admin-20261016`.
- No migration. The new rule row is data; deactivating it restores the built-in default.

## Progress

| ID | State | Evidence |
|---|---|---|
| DG-01 | [x] | `oncePerCause` on the grant: the ledger looks for an earlier original entry of the learner and cause (concept or sub-topic) under any version, under an advisory lock; unit specs plus 8 ledger integration cases (version 2, reversed, concurrent, other learner) |
| DG-02 | [x] | `STREAK_FREEZE_EARNED` row (amount = days per freeze, `params.maxHeld`), `streakConfigFrom`, engine reads it; off means none earned, held ones still spent; calendar now derives frozen days from stored streak counts |
| DG-03 | [x] | `admin/rule-catalog.ts` with 5 definitions, strict per-code schema, `rowFromValues`/`valuesFromRow`; 20 specs including form-to-engine round trips |
| DG-04 | [x] | `rule-versions.ts` (pure plans) and `rules-admin.service.ts`; 24 unit and 18 integration cases on the scratch database including two simultaneous publishes |
| DG-05 | [x] | `level-ladder.ts` and `levels-admin.service.ts` (fingerprint as base version); unit and integration specs |
| DG-06 | [x] | `achievement-authoring.ts` (metric specs, strict create and update schemas, type derived) and `achievements-admin.service.ts`; 14 unit and 12 integration cases, the real evaluator unlocks what the admin created |
| DG-07 | [x] | `gamify-admin.controller.ts` with 11 routes, DTOs, module in `v1.module.ts`; controller spec (401, 403 student and teacher, 200, extra field 400), `route-access.spec.ts`, matrix section added |
| DG-08 | [x] | gate line in `scripts/check-ownership-rules.sh`, `test_ownership_gate_gamify_rows.py` (14 cases), gate PASS on the repo; AGENTS.md "Rewards" updated |
| DG-09 | [x] | `lib/gamify-admin.ts` (30 vitest cases), `adminService.gamify`, three panels and the page with `.rc-segment` tabs kept mounted so a ladder draft survives a tab change; query keys were not needed because admin pages use `useAsyncData`; checked live with Playwright at 375, 768 and 1280, light and dark, no console error and no horizontal overflow; found and fixed on the way: a hydration mismatch (draft state filled by an immediate watcher on the client only), `sr-only` cells escaping `.rc-table-wrap`, grid cards that could not shrink |
| DG-10 | [x] | ADR-026, tracker RC-28, memory; api `jest` 242 suites passed and 1 skipped (3311 tests), `tsc` clean, web `vitest` 74 files and 930 tests, ownership and theme gates, 31 gate tests; the three new integration specs needed the 120 s hook timeout of the other suites that wait for `REGISTRY_SUITE_LOCK`; `seed:gamify` run on the dev database; deployed `api` and `web`; live check as admin and learner |
