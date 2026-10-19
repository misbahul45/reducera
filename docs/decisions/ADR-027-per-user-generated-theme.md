# ADR-027: Give every learner a theme of their own, generated from moods, while the administrator sets only the default

- Status: built on 2026-10-17 at the owner's request ("yang atur admin cuman default tapi gamifikasi ini sisi usernya dynamic theme every user"); the owner chose "tema dibuat otomatis dari suasana" among a pick from published themes, a theme the learner builds, and a generated one
- Date: 2026-10-17

## Context

ADR-018 item 10 left the user theme as the next stage: the resolver accepts a user theme as the first entry of its chain, but there was no preference field, no endpoint and no screen. Themes were created, published and set as default only by an administrator, so every learner saw the same palette. The owner wants the administrator to set only the default and the learner side of the gamification to be a dynamic theme per user.

## Decision

1. **A learner picks moods, the server makes the palette.** The learner chooses one to three different moods from a closed list (calm, energetic, analytical, welcoming, playful, serious, mysterious, natural) and an intensity from 0 to 100. `generateUserTheme` turns that into tokens for light and dark, an atmosphere and variants. It is deterministic, runs in `api` and calls no model: the existing `ThemeProposerService` is arithmetic too, so `ai-api` is not involved and the service boundary is unchanged.
2. **Readable by construction.** Hues of several moods are blended around the color wheel (the admin proposer averages them arithmetically, a spec pins that, so it stays as it is). Every generated palette is checked with `validateForPublish`, and lightness is nudged until no pair fails; a palette that still fails throws and is never stored or previewed. A sweep spec covers every combination the API accepts (92 mood sets by 11 intensities) in both schemes.
3. **Colors and atmosphere, not icons.** A user theme carries the 14 required tokens plus `primaryDepth` and `secondaryDepth` (without them the web would fill the Play defaults and a purple primary would sit on a teal button edge). Semantic colors (success, danger, warning, info, gold, flame) stay the default's so a star is still gold and a streak still a flame. Icons resolve by name through the existing chain, so no asset policy is needed for a learner.
4. **One row per learner.** `UserTheme(userId primary key, mood[], intensity, tokens, atmosphere, variants, generatorVersion)` with cascade on user delete and database checks (one to three moods from the known list, intensity 0 to 100). The generated tokens are stored, not recomputed on read, so a later change of the generator never changes a learner's look; `generatorVersion` allows a deliberate migration. A stored row whose tokens no longer parse is treated as "no custom theme".
5. **Four routes, own row only.** `GET`, `PUT` and `DELETE /gamify/me/theme` and `POST /gamify/me/theme/preview`, all `@AuthenticatedOnly()`, strict bodies, the id from the session; a body that names a user is refused. `PUT` is an upsert and `DELETE` is idempotent. Preview writes nothing, so the settings page can show the real result with a short debounce and the web has no copy of the generator to drift.
6. **The shell reads it first, only while signed in.** A plugin loads the theme during the server render (so the first HTML already has the `--rc-*` variables and the dark stylesheet) and again when the account changes on the client, clearing the previous account's theme first. `ThemeShell` puts it before the content chain and the default, which is the order of strategy 08. Reduced motion still turns the atmosphere off.
7. **Settings.** A card "Tema gamifikasi milikmu" with mood chips (at most three), an intensity slider, a light and dark preview that uses the real streak, XP, star, level ring, progress and button components, save, and "Pakai tema bawaan" to delete the row.

## Not built, on purpose

Learner-made colors or icons, sharing or publishing a learner's theme, per-topic user themes, an administrator view of learner themes, an AI generated theme, and a user-chosen icon set. The administrator keeps `set-default`, publish and the icon vocabulary unchanged.

## Consequences

- Learners see different palettes in the same screenshot or support call; the settings page is where to look first.
- A new generator version needs a deliberate migration of stored rows; nothing changes by itself.
- A user theme overrides a content theme chosen by an author. The order is the one in strategy 08; if an author theme must win on some page, that page passes it after the user entry.
- One extra read per signed-in server render, answered from one primary-key row.
- Rollback images: `reducera-api:pre-user-theme-20261017`, `reducera-web:pre-user-theme-20261017`. The migration only adds a table.
- Plan: `docs/plans/user-theme-plan.md`; matrix: `docs/architecture/AUTHORIZATION_MATRIX.md`.
