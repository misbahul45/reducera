# Per-User Gamify Theme — Implementation Plan

> **Status**: `done` · **Owner**: `api-lead` · **Last reviewed**: `2026-10-17`
>
> Ordered tasks that give every learner a theme of their own for the gamification surface: the learner picks up to three moods and an intensity, the server generates a palette that is certain to pass the contrast rules, and the application shows it. The administrator keeps only the default theme.

Decision: [ADR-027](../decisions/ADR-027-per-user-generated-theme.md). Builds on [ADR-018](../decisions/ADR-018-play-ui-and-db-defined-gamify.md) item 10 (the resolver accepts a user theme as the first entry of its chain; the preference and the endpoint were left as the next stage) and [ADR-026](../decisions/ADR-026-gamify-rules-administered-as-data.md) (the administrator sets defaults).

---

## Objective

The owner said the administrator sets only the default, while the gamification on the user side is a dynamic theme for every user, and chose "the theme is made automatically from a mood". Today `User` has no theme field, the themes controller is administrator-only for writes, and `ThemeShell` resolves `[step, lesson, subTopic, topic, default]` with no user entry. After this plan a learner opens settings, picks moods, sees a live preview in light and dark, saves, and every page (first HTML included) uses the palette; resetting returns to the default.

## Audit findings that shape the plan

| # | Finding | Evidence | Consequence |
|---|---|---|---|
| 1 | `ThemeProposerService.propose()` is deterministic HSL arithmetic, not a model | `themes/theme-proposer.service.ts` | no `ai-api` call, no credit, no rate budget; the service boundary holds |
| 2 | Its hue for several moods is the arithmetic mean of the base hues (playful 320 plus energetic 30 gives 175, a cyan), and a spec pins that behavior | `dominantHue`, `theme-proposer.service.spec.ts` ("averaging mood entries") | the user generator needs its own circular blend; the admin proposer stays as it is |
| 3 | The proposer emits no `primaryDepth` or `secondaryDepth`; the web fills missing optional tokens with the Play defaults, so a purple primary would sit on a teal button edge | `apps/web/app/theme/normalize.ts` | the generator must emit both depth tokens |
| 4 | `validateForPublish` accepts or refuses a token pair (11 contrast pairs) | `theme-validator.ts` | the generator is tested against it for every combination; a user theme is never stored without passing it |
| 5 | `ThemeShell` is mounted once in `app.vue` and builds the chain from props and the default payload; dark colors are injected with `useHead` keyed by the theme slug | `components/theme/ThemeShell.vue`, `theme/shell.ts` | adding a user entry at the front of the chain is enough; the slug must match `^[a-z0-9-]+$` |
| 6 | The SSR auth plugin already calls the API with the caller's cookie, and `request()` keeps SSR cookies and refreshes tokens | `plugins/auth.server.ts`, `lib/api.ts` | a plugin can load the user theme during the server render, so the first HTML has the palette |
| 7 | Icons are resolved by name through the theme chain, then the default theme, then the bundled fallback | ADR-018 item 3, `useGameIcons` | a user theme carries colors and atmosphere only; icons stay the default's, so nothing needs an asset policy |
| 8 | Route prefix `gamify` is applied to `ThemeModule`; `GET gamify/me` exists | `gamify/gamify.module.ts`, `me/gamify-me.controller.ts` | the new routes are `gamify/me/theme`; no clash with `gamify/themes/:id` |

## Scope

| Area | Created | Edited |
|---|---|---|
| `services/api` | `gamify/themes/{user-theme-palette,user-theme.dto,user-theme.service,user-theme.controller}.ts`, specs, `prisma/migrations/*_user_theme/` | `prisma/schema.prisma` (model `UserTheme`, relation on `User`), `themes/themes.module.ts` |
| `apps/web` | `lib/user-theme.ts`, `services/theme.ts`, `composables/useUserTheme.ts`, `plugins/user-theme.ts`, `components/play/ThemeMoodPicker.vue`, specs | `components/theme/ThemeShell.vue`, `theme/shell.ts` (only if needed), `pages/learn/profile/settings.vue`, `assets/css/play.css` |
| repo | ADR-027, tracker RC-29 | `docs/architecture/AUTHORIZATION_MATRIX.md`, `AGENTS.md` (one line), memory |

Rules for every task: no comments in code or configuration; never `git add`, `commit` or `push`; failing test first; everything runs in the `tools` containers; database specs only on the scratch database; the migration is written by hand and `migrate diff` must be empty after `migrate deploy`; verify the web in a browser through Playwright.

## Step-by-step

| ID | Task | Verify |
|---|---|---|
| UT-01 | Palette generator: `generateUserTheme({ mood[1..3], intensity 0..100 })` returns tokens for light and dark (14 required, `primaryDepth`, `secondaryDepth`), atmosphere and variants, with a circular hue blend, and nudges lightness until `validateForPublish` finds no issue | property sweep over every combination of one to three moods and eleven intensities: no contrast issue, valid hex, deterministic, depth tokens present, motion bounds respected |
| UT-02 | Model `UserTheme(userId unique, mood[], intensity, tokens, atmosphere, variants, generatorVersion)` with check constraints (one to three moods, intensity 0 to 100), migration by hand, cascade on user delete | integration spec on the scratch database: constraint violations, one row per user, cascade |
| UT-03 | `UserThemeService`: `get`, `preview` (no write), `save` (upsert under the user's own id), `reset` (delete); strict Zod DTOs | unit specs with a fake Prisma, integration spec on the scratch database |
| UT-04 | Controller `me/theme` (`GET`, `PUT`, `POST preview`, `DELETE`), `@AuthenticatedOnly()` with the id from the token only, wiring in `ThemeModule`, authorization matrix rows | controller spec (401, 200, 400 for an extra field and for four moods and for intensity 101), `route-access.spec.ts` |
| UT-05 | Web: `lib/user-theme.ts` (moods with Indonesian labels, toggle with the limit of three, draft validation, preview style), `services/theme.ts`, `useUserTheme`, plugin that loads the theme on the server and on login, `ThemeShell` puts the user theme first only while a user is signed in | `vitest` for the pure parts and for the chain order |
| UT-06 | Settings: mood chips, intensity, live preview of the real gamification pieces in light and dark, save and reset, in the "Tampilan" card | Playwright at 375, 768 and 1280, light and dark, no console error; first HTML of a page carries the palette |
| UT-07 | Docs, ADR-027, tracker RC-29, memory; full suites; deploy `api` and `web`; dev migration; live check as two learners (own palette, other learner unaffected, reset returns the default) and as administrator (default untouched) | checks of the list |

## Acceptance criteria

1. A learner who saves moods and an intensity gets the same palette on the next request and after a reload, and the server-rendered HTML already has the `--rc-*` variables of that palette.
2. No generated palette fails a contrast pair, for any combination the API accepts.
3. A learner can read and write only their own theme (the id comes from the token), a body with an unknown field or more than three moods or an intensity outside 0 to 100 gets 400, a request without a session gets 401.
4. Resetting deletes the row and the default theme returns; another learner is never affected; the administrator's default theme and `set-default` keep working unchanged.
5. Reduced motion still turns atmosphere off for a user theme; `EXAM` variant stays calm.
6. API `jest` (with the scratch database), `tsc`, web `vitest`, ownership and theme gates pass; the stack is healthy.

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| A palette is unreadable | High | generator output is validated before it is stored or previewed, and the sweep test covers every input the DTO accepts |
| SSR and client disagree on the theme (hydration error) | Medium | the theme lives in `useState`, loaded in a plugin before render; the shell reads only that state |
| A user theme hides a content theme the author chose | Low | the order user, content, default is the one in strategy 08; documented in ADR-027 |
| The first HTML gets slower | Low | one extra call only for a signed-in user, answered from one indexed row |

## Rollback

- Images before this plan: `reducera-api:pre-user-theme-20261017` and `reducera-web:pre-user-theme-20261017`.
- One migration adds a table. Rolling back the images leaves the table unused; dropping it is safe because nothing else references it.

## Progress

| ID | State | Evidence |
|---|---|---|
| UT-01 | [x] | `generateUserTheme` with circular hue blend, both depth tokens and a lightness nudge; sweep of 92 mood sets by 11 intensities (1012 inputs): no contrast issue, valid hex, deterministic (`user-theme-palette.spec.ts`) |
| UT-02 | [x] | model `UserTheme`, migration `20261017010000_user_theme` (checks for 1 to 3 moods, known moods, intensity 0 to 100, cascade); 12 integration tests on the scratch database; `migrate diff` empty after `migrate deploy` |
| UT-03 | [x] | `UserThemeService` `get`, `preview`, `save` (upsert), `reset`; strict Zod `UserThemeDto`; unit specs plus integration spec |
| UT-04 | [x] | `me/theme` controller, `@AuthenticatedOnly()`, id from the session only; 28 controller tests (401, 200, 400 for an extra field, four moods, intensity 101); `route-access.spec.ts` and the authorization matrix section |
| UT-05 | [x] | `lib/user-theme.ts`, `services/theme.ts`, `useUserTheme`, `plugins/user-theme.ts` (loads in SSR, clears and reloads when the user id changes), `ThemeShell` chain starts with the user theme; 21 vitest cases including the chain order; web suite 75 files and 951 tests |
| UT-06 | [x] | `ThemeMoodPicker` in the "Tampilan" area of settings; Playwright at 375, 768 and 1280, light and dark: palette `#5b7817` light and `#bcde6e` dark applied, first HTML carries the palette, 16 px rhythm between blocks, no element wider than the viewport, zero console errors or warnings; logout releases the palette |
| UT-07 | [x] | ADR-027, tracker RC-29, authorization matrix, `AGENTS.md`, memory; api 246 suites and 3372 tests green, `tsc` clean, ownership, theme-sync and compose-env gates pass, ai-api gate tests 14 passed, dev and prod `compose config` valid, stack healthy; two learners checked (own palette, other learner on the default, reset returns the default) |
