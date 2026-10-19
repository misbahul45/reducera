# ADR-024: Remind a learner once a day when concepts start to fade, and let the learner turn it off

- Status: built on 2026-10-16 at the owner's request to implement the reminder after the review schedule of ADR-021; the hour, the pause and the activity window are proposals that wait for the owner (decision D-31)
- Date: 2026-10-16

## Context

The review schedule (`review-v1`, ADR-021) tells a learner what is fading, but only when the learner opens the review card. A reminder pushes it, and a badly designed one is spam. The owner did not say at which hour, how often or whether it could be switched off, so the rules below are the defaults chosen to keep it quiet.

## Decision

1. A job `send-review-reminders` of the queue `review-reminders` runs every day at 18.00 Asia/Jakarta (BullMQ repeatable job, the same pattern as the canary evaluation).
2. A learner is considered only if the account is active, `reviewReminders` is true (the default) and at least one concept with evidence was practised in the last 30 days. A learner who left a month ago is not contacted.
3. The learner is reminded only if at least one concept is due by `review-v1`. The notification (`type REVIEW`) names the first two due concepts, counts the rest and, when a step can be opened, says how long the short session takes (never less than one minute).
4. At most one reminder per learner and Jakarta calendar day: the notification carries `dedupeKey = review-reminder:{userId}:{day}`, which is unique in the database, so a retried job cannot send twice.
5. A reminder is not repeated while the previous one is unread and newer than three days.
6. The learner switches the reminder on or off on the review card (`PUT /learner-model/me/review/reminders`). The card says in words when it comes and that it is at most once a day.
7. In the web, a `REVIEW` notification shows a button to the review card.

## Consequences

- The sweep reads one learner at a time (about three queries each) in pages of 200. This is fine for the pilot; a larger user base needs the due check moved to one query.
- The hour is fixed in WIB. Learners in WITA and WIT receive it one or two hours later by the clock. A per-learner hour needs a preference and a job per timezone.
- There is no e-mail or push. The reminder is only visible in the app, which also means it costs nothing and cannot reach a learner who does not open the app.
- Migration `20261016140000_review_reminders`: enum value `REVIEW`, `Notification.dedupeKey` (unique, nullable) and `User.reviewReminders` (default true).
