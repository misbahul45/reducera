# ADR-028: Accept D-22 and D-25, and make the code match them

- Status: accepted on 2026-10-17; the owner asked to continue the implementation of D-22 and D-25 ("lanjutkan implementasinya D22 dan D25"), which accepts the proposals of the decision register as written
- Date: 2026-10-17

## Context

D-22 (reward rules and values) and D-25 (gamify values, streak and freezes, topic board) were `PROPOSED, built; owner-confirm first`. ADR-015, ADR-018 and ADR-026 built them as data and gave the administrator a page to tune them. An audit of the code against the text of both decisions found two differences.

1. A streak day was credited by any graded quiz with evidence, even a score of zero, so a learner could keep a streak by submitting blank quizzes. D-25 says a streak day is credited only by a passed assessment, and `AGENTS.md` says the same.
2. `GET /gamify/leaderboards` and `GET /gamify/leaderboards/{id}` were still routed. They took any query field as a database filter and any relation through `include`, so with an arbitrary `cohortId` a signed-in learner could read the score row of another learner together with that learner's user record (name and email), checked on the dev stack on 2026-10-17. The web never used them. D-25 says boards are per topic, opt-in, show handles and never emails, and there is no global board.

## Decision

1. **D-22 is accepted as proposed.** The catalog stays `MASTERY_PROGRESS` v1 (progress above the previous best, at most 50 per concept), `CONCEPT_PASSED` v1 (50, once per concept) and `STREAK_BONUS_7` v1 (50 on every seventh day), 100 points per concept at most. The streak bonus is kept and stays active: it no longer pays on activity, only on a streak made of passed assessments. Completing a step pays nothing by itself; points come only from assessment evidence through the ledger.
2. **D-25 is accepted as proposed.** `PATH_NODE_MASTERED` v1 pays one star per sub-topic, `STREAK_FREEZE_EARNED` v1 gives one freeze per 7 streak days and holds at most 2, a freeze is never sold (no purchase path exists), the level ladder has 12 thresholds (0 to 4500 XP) and the catalog has 11 achievements. The administrator tunes every number on `/admin/gamify` as a new version (ADR-026); this ADR fixes the starting values, not the ceiling.
3. **"Passed" is defined per surface.** A graded quiz without hints passes when its percent score reaches the passing score of that quiz (70 when the quiz has none). A sandbox journal passes when it is correct and the learner did not see the answer first. Only a passed assessment calls `StreakEngineService.onQualified`. A graded assessment that was not passed still records its evidence, pays XP for real progress, counts stars and achievements, and returns the streak as it stands (`StreakEngineService.standing`, no write).
4. **The learner is told.** The streak copy says "lulus satu penilaian", the quiz result shows the passing score when the attempt did not reach it, and the streak page and the support answer name both ways to pass.
5. **One board surface.** `LeaderboardsModule` has one controller, `TopicBoardController` (`GET /gamify/leaderboards/topics/{topicId}`, `PUT /gamify/leaderboards/me`). The legacy controller and service are deleted and the repository keeps only its writes. A source-level spec fails if a controller, a by-id read or `user: true` comes back.

## Consequences

- A learner who scores below the passing score of a quiz keeps the XP of real progress but no streak day for that attempt; the same day can still be saved by a passed assessment. Streaks of learners who relied on failing attempts will be shorter.
- `GET /gamify/leaderboards` and `GET /gamify/leaderboards/{id}` answer 404. Nothing in the repository called them.
- The authorization matrix lost two rows that claimed row-level rules the service did not enforce.
- Changing the meaning of "passed" (for example a lower bar for a streak than for a quiz) is a new decision, not a rule version, because it is code.
- Plan: `docs/plans/reward-decisions-plan.md`; register: D-22 and D-25 are `ACCEPTED`.
