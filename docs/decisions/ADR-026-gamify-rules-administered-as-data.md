# ADR-026: Administer gamify rules as data: versioned reward rules, the level ladder, achievements and the streak freeze, from one admin page

- Status: built on 2026-10-17 at the owner's request ("audit codebase pahami planning implementasi gamify dynamic lalu plan dan implementasikan next code implementasinya"); the reward values stay the proposals of decisions D-22 and D-25 until the owner tunes them on the new page
- Date: 2026-10-17

## Context

ADR-018 moved reward rules, level thresholds and the achievement catalog into rows and said that a changed number is a new rule version. Nothing could create that version: only `GamifySeeder` or SQL wrote the three tables, so the owner could not tune D-22 and D-25 without a deploy. The audit behind this decision (`docs/plans/gamify-admin-plan.md`) also found that publishing a second version of `CONCEPT_PASSED` or `PATH_NODE_MASTERED` would pay every learner again, because the idempotency key contains the rule version, and that the streak freeze (one per seven days, two held) was still a constant although ADR-018 names `STREAK_FREEZE_EARNED` as a rule.

## Decision

1. **One page, one controller.** `/admin/gamify` on the web and `admin/gamify/*` on the API (11 routes, `@Roles(Role.ADMIN)`, strict Zod bodies). Three tabs: reward rules, level ladder, achievements. Every change needs a reason of 3 to 500 characters and writes an `AuditLog` entry with the state before and after.
2. **A rule row stays immutable.** The `reward_rule_immutable` trigger still allows only `active` to change. Changing a number publishes version n+1 under a transaction advisory lock per rule code and retires the version in force. The client sends `baseVersion`; a stale one answers 409, so two administrators cannot overwrite each other. When a code has no row yet, the built-in default is written as version 1 (retired) first, so history is complete. An older version can be activated again (rollback), and a code can be switched off; a code that is off pays nothing and does not fall back to the built-in default.
3. **The form comes from a catalog in code.** `rule-catalog.ts` lists, for each of the five codes, the fixed event type and kind and the fields an administrator may change with bounds, units and labels. The API returns that catalog with the values and the page generates its form from it, so the form cannot drift from the validator. `dailyCap` is not offered because the engine never reads it. A new rule code still needs engine code; the admin only tunes existing ones.
4. **Once per cause means once across versions.** `CONCEPT_PASSED` and `PATH_NODE_MASTERED` look for an earlier original entry of the same learner and concept or sub-topic under any version, under an advisory lock, before they grant. A new version therefore changes what the next learner earns and never pays anyone twice. Rewards already paid do not change.
5. **The freeze is a rule row.** `STREAK_FREEZE_EARNED`: `amount` is the number of qualified days per freeze, `params.maxHeld` the most held. The streak engine reads it and falls back to the old constants when no row exists. Switching it off earns no new freeze; held ones can still be spent. It never pays XP. The streak calendar derives frozen days from stored streak counts instead of assuming the constant.
6. **The ladder is replaced as a whole.** 2 to 30 levels, numbered from 1 without a gap, the first at 0 XP, XP strictly increasing, at most 10,000,000. One transaction under an advisory lock; the client sends the fingerprint of the ladder it loaded and a stale one answers 409. The level is computed from ledger XP on read, so nothing is rewritten and no XP changes; the page shows which learners at the old thresholds would move up or down before the administrator saves.
7. **Achievements are created and retired, never redefined.** A new one has a code, texts, an icon from the closed theme vocabulary and a rule of the form metric at least value, with metrics from a closed list and a maximum each. The type is derived from the metric on the server. Only title, description, icon and order can change afterwards, so what a learner unlocked keeps its meaning. Deactivating hides it from the learner list and from new unlocks; unlock records stay.
8. **Only the admin services and the seeder write these tables.** `scripts/check-ownership-rules.sh` has a line for `rewardRule`, `levelThreshold` and `achievement`, covered by `services/ai-api/__tests__/test_ownership_gate_gamify_rows.py`. `AGENTS.md` ("Rewards") and the authorization matrix list the routes.

## Not built, on purpose

Deleting a rule version or an achievement; editing a published row; a start date for a version; per-user or per-tenant overrides; a daily cap; new rule codes from the page; a preview of how many learners a ladder change moves (the page shows the effect on the old thresholds, not a count of real learners).

## Consequences

- The owner tunes D-22 and D-25 on the page; every change is in the audit page with its reason and can be undone by activating an older version.
- A ladder change shows at once for every learner. Lowering a threshold raises levels; raising one can lower them. The page warns before saving.
- The dev database now holds the history of the checks made on the page (a second version of `CONCEPT_PASSED`, retired again; one retired test achievement, `e2e-gamify-1017`). History is append-only by design.
- The five rule rows must exist in each database: `pnpm seed:gamify` is idempotent and adds only what is missing.
- Rollback needs no migration: activate version 1 of a rule, replace the ladder with the old values, retire the achievement.
- Plan: `docs/plans/gamify-admin-plan.md`; matrix: `docs/architecture/AUTHORIZATION_MATRIX.md`.
