# ADR-021: Link marketplace products to concepts, recommend from what the learner needs, and schedule review by forgetting

- Status: built on 2026-10-16 at the owner's request to audit the plan and continue micro-learning, personalization and the marketplace; the weights, thresholds and intervals below are proposals that wait for the owner (decision D-29)
- Date: 2026-10-16

## Context

The audit of 2026-10-16 found two places where the personalization loop of the plan stopped short of the learner.

Marketplace recommendations were a placeholder. `MarketplaceDiscoveryService` set `matchesGoal`, `matchesDifficulty` and `matchesPrerequisites` to `true` for every article, scored the rest from "free or paid" and the age of the product, ignored the topics and sub-topics the controller loaded for it, and read the whole catalog on every call. A product had no link to any concept, so "personalized by mastery" could not be true. The web then turned the constant signals into the sentence "Dekat dengan topik yang sedang kamu pelajari, sesuai levelmu" and, for the rest, "Populer di kalangan pelajar", neither of which was ever measured. The controller also raised a learner without evidence to the intermediate level (`Math.max(0.4, mastery)`) and its test named that floor "beginner".

Micro-learning stopped at the size of one lesson. `microlearning-v1` picks the length and the number of exercises of generated material, but nothing brings a learner back to a concept: mastery never ages, the `REVIEW` strategy was only reachable from the `PRACTICE` intent after seven idle days, and no screen asked the learner to review anything.

## Decision

1. A product carries up to five concept tags. `ProductConceptLink` (migration `20261016100000_product_concept_links`) has exactly one of `articleId` or `classProductId` (check constraint), one row per product and concept (unique indexes), a review status and the proposer. The author tags the product in the studio; the tags are `PROPOSED`, shown to the reviewer next to the content, and become `APPROVED` in the same transaction that approves the product. Only `APPROVED` links act, the same rule as `ConceptAlias` and `ConceptCurriculumLink`. The limit of five is also a trigger, so a writer that skips the service cannot pass it. Tags of an editable product (draft or rejected) change with the product; see the addendum for products that are waiting or live.
2. Recommendations (`reco-v1`) start from the needs of the learner, not from the catalog: a concept that was started and not passed (`WEAK`, priority 0.6 to 1.0 by how low the score is), the next concept of the policy (0.9), a concept due for review (0.55) and a concept that is ready to start (0.4). A product is ranked by the strongest need it covers, plus 0.1 for each further need up to 0.2, times a level fit for classes (1, 0.8 or 0.5), plus two small tie breakers (free, recent). A product that covers no need is never ranked. Price, clicks and revenue are not in the score. The database is asked only for approved links to the concepts of the needs, of published products by someone else, and products the learner owns or is enrolled in are left out.
3. The reason shown is built from the data of that learner ("Membahas X, penguasaanmu baru 38%"). When too few products match, the list is filled with new arrivals that say so ("Terbaru di marketplace.") and are marked `personalized: false`; the shelf title follows. A learner without evidence is a beginner.
4. Review is scheduled by a forgetting curve (`review-v1`, `learner-model/review/review-schedule.ts`). Stability in days is `1.5 * 2^(min(evidence, 12) / 2) * (0.5 + score)`, retrievability is `exp(-days / stability)`, a concept is due when retrievability falls below 0.7 (the interval is capped at 60 days), most forgotten first. A concept at or above the pass score is `REVIEW`, below it `RELEARN`. A session is at most three concepts of three questions each (about 40 seconds a question). Nothing is written: the schedule is derived on read from `ConceptMastery.lastEventAt`, so a fresh assessment moves a concept off the list by itself and the mastery formula is untouched.
5. `GET /learner-model/me/review` returns the due and the coming concepts with the step of the learner that teaches each one (through approved curriculum links). The web card opens that step with `?ulas=<concept>`; the step page then runs the existing `QUIZ` chat action (three questions, focus on the concept) once and removes the parameter. The quiz is graded by the API as any practice quiz, which is what writes the evidence.
6. Concepts that are due also feed the marketplace needs, so a learner who is about to forget a concept can be shown a class on it.

## Consequences

- A creator who tags a product gets it in front of the learners who need that concept; an untagged product is only shown as a new arrival. Existing published products have no tags until their author proposes them with the addendum below.
- The reason of a recommendation can be checked against the mastery page.
- Reviews are as good as the concept links: a concept with no approved link to a lesson the learner has a step for cannot be opened from the card (the card says so).
- The review model is a proposal. `evidenceCount` counts assessments, not successful reviews, so stability grows with practice and not yet with a measured recall; replacing it with the observed recall outcomes of `StrategyOutcome` is the next step once there is enough data (the same route to learn it exists for strategies and chunk sizes).
- Not done: tags for the other product kinds that do not exist yet, and a measured effect of reviews on later mastery (needs the pilot protocol of D-19).

## Addendum (2026-10-16): tags of products that are waiting or live

A published product is locked, so on the first day no product that was already live could be recommended. Tags are a claim about the product, not part of the text a buyer paid for, so they are decided separately from the content.

1. `PUT /articles/{id}/concepts` and `PUT /classes/{id}/concepts` replace the tag set of a product that is DRAFT, REJECTED, PENDING_REVIEW or PUBLISHED. A product that is SUSPENDED or ARCHIVED answers 409 `CONTENT_LOCKED`. The text, the price and the published version never change through this route.
2. A concept that is added is `PROPOSED` and invisible to learners and to ranking until an administrator decides (`POST /admin/articles|classes/{id}/approve-concepts`, `/reject-concepts`). Approving or rejecting is allowed for PUBLISHED products, is idempotent, and rejecting needs a reason that goes to the audit trail. A product in PENDING_REVIEW is still approved with its tags by the product approval.
3. A concept that is removed leaves at once, even if it was `APPROVED`: taking back a claim cannot mislead a learner, so it needs no review.
4. The queue of `/admin/articles` and `/admin/classes` returns `pendingConceptTags` and accepts `pendingTags=true`, so the reviewer can work through only the products that wait for a tag decision. The web moderation page has the filter "Hanya yang punya tag menunggu", shows the claimed concepts with their status and offers "Setujui tag" and "Tolak tag".
5. The studio shows the picker with its own "Simpan tag" button for a waiting or live product; the autosave of the editor still covers only DRAFT and REJECTED.
