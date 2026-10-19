# Authorization matrix

> Generated from the running application: route paths come from the Swagger document, access decisions from the metadata that guards read at runtime. Regenerate after route changes; `route-access.spec.ts` fails the build if any route lacks an explicit decision.

## How access is decided

Guards run in this order for every request: `JwtAuthGuard` (authentication) → `RolesGuard` (`@Roles`) → `OwnershipGuard` (`@RequireOwnership` / `@RequireParentOwnership`) → route guards (`TenantGuard` for `@TenantScoped`, `InternalServiceGuard` for `@InternalOnly`). `@ScopeToUser` adds an interceptor that pins `userId` on query and body. Services repeat the check for anything the metadata cannot express (for example order state).

| Decision | Meaning | Routes |
|---|---|---|
| Public | No credentials | 15 |
| Service | Signed service-to-service request | 2 |
| Role | Global role required | 61 |
| Tenant | Membership in the named tenant | 2 |
| Owner | Owner of the resource, or ADMIN | 66 |
| Own rows | Only the caller rows; ADMIN unrestricted | 15 |
| Authenticated | Any signed-in user, row rules in service | 34 |
| **Total** | | **195** |

## Policy by actor (product terminology: USER = `STUDENT` in the database)

| Capability | USER | TEACHER | ADMIN |
|---|---|---|---|
| Read own profile / update name and image | Y | Y | Y |
| Change any role, activate or deactivate accounts | N | N | Y (never on self) |
| Apply to become a teacher | Y | N | N |
| Approve or reject a teacher application | N | N | Y (never own) |
| Create an order for a product (topic, article, class) | Y | Y | Y |
| Read an order | own | own | all |
| Submit a payment proof | own order | own order | own order |
| Review, approve or reject a payment proof | N | N | Y |
| Reconcile a payment, run the expiry sweep | N | N | Y |
| Refund an order | not available (next phase) | not available | not available |
| Cancel an order | own, while pending | own, while pending | any |
| Enroll in a topic | free topics only | free topics only | any |
| Read or write learning progress, attempts, chats | own | own | all |
| Write curriculum (topics, lessons, steps, quizzes) | N | Y | Y |
| Delete curriculum | N | N | Y |
| Read own tenant | N | Y (member) | Y (names tenant) |
| Update tenant details | N | OWNER or MANAGER | Y |
| List, suspend, activate tenants | N | N | Y |
| Global gamification writes (daily logs, streak deletion, themes) | N | N | Y |
| Internal callbacks and resource reads | N | N | N (services only) |

## Every route

| Method | Path | Decision | Detail |
|---|---|---|---|
| POST | `/admin/entitlements/backfill/topic` | Role | ADMIN |
| POST | `/admin/payments/expire-due` | Role | ADMIN |
| POST | `/admin/payments/intents/{intentId}/reconcile` | Role | ADMIN |
| GET | `/admin/payments/manual/submissions` | Role | ADMIN |
| GET | `/admin/payments/manual/submissions/{id}` | Role | ADMIN |
| POST | `/admin/payments/manual/submissions/{id}/approve` | Role | ADMIN |
| POST | `/admin/payments/manual/submissions/{id}/reject` | Role | ADMIN |
| POST | `/admin/payments/manual/submissions/{id}/start-review` | Role | ADMIN |
| GET | `/admin/tenants` | Role | ADMIN |
| POST | `/admin/tenants/{id}/activate` | Role | ADMIN |
| POST | `/admin/tenants/{id}/suspend` | Role | ADMIN |
| GET | `/daily-log-sse/stream (SSE)` | Authenticated | Any signed-in user; row-level rules enforced in the service |
| GET | `/auth/check` | Authenticated | Any signed-in user; row-level rules enforced in the service |
| POST | `/auth/forgot-password` | Public | No credentials; the answer is identical for a registered and an unregistered email |
| POST | `/auth/login` | Public | No credentials |
| DELETE | `/auth/logout` | Authenticated | Any signed-in user; revokes the session behind the access token, so the refresh token and the access token stop working |
| GET | `/auth/profile` | Authenticated | Any signed-in user; row-level rules enforced in the service |
| POST | `/auth/refresh-token` | Public | No credentials |
| POST | `/auth/register` | Public | No credentials |
| POST | `/auth/resend-token` | Public | No credentials; `type` is `email` or `pw`; the answer is identical for a registered and an unregistered email |
| POST | `/auth/reset-password` | Public | No credentials; a 6-digit code valid 15 minutes, at most 5 wrong tries, single use; signs every device out |
| POST | `/auth/verify-email` | Public | No credentials; a 6-digit code valid 15 minutes, at most 5 wrong tries, single use |
| GET | `/categories` | Public | No credentials |
| POST | `/categories` | Role | ADMIN or TEACHER |
| DELETE | `/categories/{categoryId}/topics/topicId` | Role | TEACHER |
| POST | `/categories/{categoryId}/topics/topicId` | Role | TEACHER |
| DELETE | `/categories/{id}` | Role | ADMIN |
| GET | `/categories/{id}` | Public | No credentials |
| PATCH | `/categories/{id}` | Role | ADMIN or TEACHER |
| GET | `/chat-message-sse` | Authenticated | Any signed-in user; row-level rules enforced in the service |
| POST | `/chat/chat-messages` | Owner | Owner or ADMIN of `chat@body:chatId` |
| DELETE | `/chat/chat-messages/{id}` | Owner | Owner or ADMIN of `message` |
| PATCH | `/chat/chat-messages/{id}` | Owner | Owner or ADMIN of `message` |
| POST | `/chat/chats` | Owner | Owner or ADMIN of `user-step@body:userStepId` |
| DELETE | `/chat/chats/{id}` | Owner | Owner or ADMIN of `chat` |
| GET | `/chat/chats/{id}` | Owner | Owner or ADMIN of `chat` |
| GET | `/chat/chats/{id}/messages` | Owner | Owner or ADMIN of `chat` |
| GET | `/chat/contents` | Owner | Owner or ADMIN of `chat@query:chatId` |
| POST | `/chat/contents` | Owner | Owner or ADMIN of `chat@body:chatId` |
| GET | `/chat/contents/similarity` | Owner | Owner or ADMIN of `chat@query:chatId` |
| DELETE | `/chat/contents/{id}` | Owner | Owner or ADMIN of `content` |
| GET | `/content-sse` | Authenticated | Any signed-in user; row-level rules enforced in the service |
| POST | `/curriculum/lessons` | Role | ADMIN or TEACHER |
| DELETE | `/curriculum/lessons/{id}` | Role | ADMIN |
| GET | `/curriculum/lessons/{id}` | Authenticated | Any signed-in user; row-level rules enforced in the service |
| PATCH | `/curriculum/lessons/{id}` | Role | ADMIN or TEACHER |
| GET | `/curriculum/steps` | Authenticated | Any signed-in user; row-level rules enforced in the service |
| POST | `/curriculum/steps` | Role | ADMIN or TEACHER |
| DELETE | `/curriculum/steps/{id}` | Role | ADMIN |
| GET | `/curriculum/steps/{id}` | Authenticated | Any signed-in user; row-level rules enforced in the service |
| PATCH | `/curriculum/steps/{id}` | Role | ADMIN or TEACHER |
| GET | `/curriculum/subtopics` | Public | No credentials |
| POST | `/curriculum/subtopics` | Role | ADMIN or TEACHER |
| DELETE | `/curriculum/subtopics/{id}` | Role | ADMIN |
| GET | `/curriculum/subtopics/{id}` | Authenticated | Any signed-in user; row-level rules enforced in the service |
| PATCH | `/curriculum/subtopics/{id}` | Role | ADMIN or TEACHER |
| GET | `/curriculum/subtopics/{id}/lessons` | Authenticated | Any signed-in user; row-level rules enforced in the service |
| GET | `/curriculum/subtopics/{id}/navigation` | Authenticated | Any signed-in user; row-level rules enforced in the service |
| GET | `/curriculum/topics` | Public | No credentials |
| POST | `/curriculum/topics` | Role | TEACHER |
| DELETE | `/curriculum/topics/{id}` | Role | ADMIN |
| PATCH | `/curriculum/topics/{id}` | Role | ADMIN |
| GET | `/curriculum/topics/{slug}` | Public | No credentials |
| GET | `/gamify/achievements/me` | Authenticated | Reads the caller's own achievements and their progress; no `userId` input exists |
| GET | `/gamify/daily-logs` | Own rows | Query and body forced to the caller; ADMIN unrestricted |
| POST | `/gamify/daily-logs` | Role | ADMIN |
| GET | `/gamify/daily-logs/user/{userId}` | Owner | Owner or ADMIN of `user@param:userId` |
| GET | `/gamify/daily-logs/user/{userId}/today` | Owner | Owner or ADMIN of `user@param:userId` |
| DELETE | `/gamify/daily-logs/{id}` | Role | ADMIN |
| GET | `/gamify/daily-logs/{id}` | Owner | Owner or ADMIN of `daily-log` |
| PATCH | `/gamify/daily-logs/{id}` | Role | ADMIN |
| PUT | `/gamify/leaderboards/me` | Authenticated | The caller changes only their own board membership and handle; the body is strict |
| GET | `/gamify/leaderboards/topics/{topicId}` | Authenticated | Opt-in board per topic; shows handles and ranks, never emails |
| GET | `/gamify/me` | Authenticated | Own level, XP, stars and streak, derived from the ledger; no `userId` input exists |
| POST | `/gamify/rewards/ledger/{id}/reverse` | Role | ADMIN; body `{ reason }` (3 to 500 characters, strict); idempotent, writes a compensating ledger entry and an audit entry |
| GET | `/gamify/rewards/me` | Authenticated | Reads the caller's own ledger entries and balance; no `userId` input exists; reason, actor and keys are not returned |
| GET | `/gamify/streaks` | Own rows | Query and body forced to the caller; ADMIN unrestricted |
| GET | `/gamify/streaks/latest` | Own rows | Query and body forced to the caller; ADMIN unrestricted |
| DELETE | `/gamify/streaks/{id}` | Role | ADMIN |
| GET | `/gamify/themes/default` | Public | The default theme and its icon set; no user data |
| GET | `/gamify/themes` | Authenticated | Any signed-in user; row-level rules enforced in the service |
| POST | `/gamify/themes` | Role | ADMIN |
| POST | `/gamify/themes/icons` | Role | ADMIN |
| DELETE | `/gamify/themes/icons/{id}` | Role | ADMIN |
| DELETE | `/gamify/themes/{id}` | Role | ADMIN |
| GET | `/gamify/themes/{id}` | Authenticated | Any signed-in user; row-level rules enforced in the service |
| PATCH | `/gamify/themes/{id}` | Role | ADMIN |
| GET | `/gamify/themes/{id}/icons` | Authenticated | Any signed-in user; row-level rules enforced in the service |
| POST | `/internal/resources/callback` | Service | Signed service request (HMAC-SHA256, 60 s window, replay-protected) |
| GET | `/internal/resources/{id}` | Service | Signed service request (HMAC-SHA256, 60 s window, replay-protected) |
| GET | `/leaderboard-sse/stream` | Authenticated | Any signed-in user; row-level rules enforced in the service |
| GET | `/learner-model/me/mastery` | Authenticated | Reads the caller's own `ConceptMastery`; no `userId` input exists |
| GET | `/learner-model/me/next` | Authenticated | Computed from the caller's own `ConceptMastery`; no `userId` input exists |
| GET | `/learner-model/me/skill-nodes` | Authenticated | Derived on read from the caller's own `ConceptMastery`; no `userId` input exists |
| GET | `/learner-model/concepts` | Authenticated | The active concept registry (id, title, description, level) for the concept picker of the studio; platform-global curriculum data, no per-user data and no prerequisite graph |
| GET | `/learner-model/me/review` | Authenticated | Concepts of the caller that are due for review (forgetting curve `review-v1`), those coming due within a week, and the session plan; reads the caller's own `ConceptMastery`, `ConceptCurriculumLink` and `UserStep`; the step link only names a step of the caller; a `userId` query is ignored |
| POST | `/learning/learning-styles` | Owner | Owner or ADMIN of `user-topic@body:userTopicId` |
| DELETE | `/learning/learning-styles/{id}` | Owner | Owner or ADMIN of `learning-style` |
| GET | `/learning/learning-styles/{id}` | Owner | Owner or ADMIN of `learning-style` |
| PATCH | `/learning/learning-styles/{id}` | Owner | Owner or ADMIN of `learning-style` |
| GET | `/learning/lesson-progresses` | Own rows | Query and body forced to the caller; ADMIN unrestricted |
| POST | `/learning/lesson-progresses` | Own rows | Query and body forced to the caller; ADMIN unrestricted |
| DELETE | `/learning/lesson-progresses/{id}` | Owner | Owner or ADMIN of `lesson-progress` |
| GET | `/learning/lesson-progresses/{id}` | Owner | Owner or ADMIN of `lesson-progress` |
| PATCH | `/learning/lesson-progresses/{id}` | Owner | Owner or ADMIN of `lesson-progress` |
| GET | `/learning/personality-quizzes` | Own rows | Query forced to the caller; the answer key is removed from `questions` and `userAttempt` unless ADMIN |
| POST | `/learning/personality-quizzes` | Role | ADMIN (the AI service writes quizzes through `/internal/personality-quizzes`) |
| PATCH | `/learning/personality-quizzes/submit/{id}` | Owner | Owner or ADMIN of `personality-quiz`; graded on the server from the stored key, one submission then 409, the learning style must belong to the caller for the topic of the quiz lesson |
| DELETE | `/learning/personality-quizzes/{id}` | Role | ADMIN |
| GET | `/learning/personality-quizzes/{id}` | Owner | Owner or ADMIN of `personality-quiz`; the answer key is removed unless ADMIN |
| PATCH | `/learning/personality-quizzes/{id}` | Role | ADMIN |
| GET | `/learning/step-progresses` | Own rows | Query and body forced to the caller; ADMIN unrestricted |
| POST | `/learning/step-progresses` | Own rows | Query and body forced to the caller; ADMIN unrestricted |
| DELETE | `/learning/step-progresses/{id}` | Owner | Owner or ADMIN of `step-progress` |
| GET | `/learning/step-progresses/{id}` | Owner | Owner or ADMIN of `step-progress` |
| PATCH | `/learning/step-progresses/{id}` | Owner | Owner or ADMIN of `step-progress` |
| GET | `/learning/subtopic-progresses` | Own rows | Query and body forced to the caller; ADMIN unrestricted |
| POST | `/learning/subtopic-progresses` | Own rows | Query and body forced to the caller; ADMIN unrestricted |
| DELETE | `/learning/subtopic-progresses/{id}` | Owner | Owner or ADMIN of `subtopic-progress` |
| GET | `/learning/subtopic-progresses/{id}` | Owner | Owner or ADMIN of `subtopic-progress` |
| PATCH | `/learning/subtopic-progresses/{id}` | Owner | Owner or ADMIN of `subtopic-progress` |
| GET | `/learning/user-steps` | Own rows | Query and body forced to the caller; ADMIN unrestricted |
| POST | `/learning/user-steps` | Role | ADMIN (user steps are generated by the system) |
| POST | `/learning/user-steps/complete/{id}` | Owner | Owner or ADMIN of `user-step` |
| DELETE | `/learning/user-steps/{id}` | Owner | Owner or ADMIN of `user-step` |
| GET | `/learning/user-steps/{id}` | Owner | Owner or ADMIN of `user-step` |
| PATCH | `/learning/user-steps/{id}` | Owner | Owner or ADMIN of `user-step` |
| GET | `/learning/user-topics` | Own rows | Query and body forced to the caller; ADMIN unrestricted |
| POST | `/learning/user-topics` | Own rows | Query and body forced to the caller; ADMIN unrestricted |
| DELETE | `/learning/user-topics/{id}` | Owner | Owner or ADMIN of `user-topic` |
| GET | `/learning/user-topics/{id}` | Owner | Owner or ADMIN of `user-topic` |
| PATCH | `/learning/user-topics/{id}` | Owner | Owner or ADMIN of `user-topic` |
| GET | `/material/resources` | Role | TEACHER |
| POST | `/material/resources` | Role | TEACHER |
| DELETE | `/material/resources/{id}` | Role | TEACHER |
| GET | `/material/resources/{id}` | Role | TEACHER |
| GET | `/notification-sse/stream` | Authenticated | Any signed-in user; row-level rules enforced in the service |
| GET | `/notifications` | Own rows | Query and body forced to the caller; ADMIN unrestricted |
| POST | `/notifications` | Role | ADMIN |
| DELETE | `/notifications/{id}` | Owner | Owner or ADMIN of `notification` |
| GET | `/notifications/{id}` | Owner | Owner or ADMIN of `notification` |
| PATCH | `/notifications/{id}` | Owner | Owner or ADMIN of `notification` |
| GET | `/orders` | Authenticated | Any signed-in user; row-level rules enforced in the service |
| POST | `/orders` | Authenticated | Any signed-in user; row-level rules enforced in the service |
| GET | `/orders/{id}` | Authenticated | Any signed-in user; row-level rules enforced in the service |
| POST | `/orders/{id}/cancel` | Authenticated | Any signed-in user; row-level rules enforced in the service |
| GET | `/payments/intents/{intentId}` | Owner | Owner or ADMIN of `payment-intent@param:intentId` |
| GET | `/payments/manual/intents/{intentId}/submissions` | Owner | Owner or ADMIN of `payment-intent@param:intentId` |
| POST | `/payments/manual/intents/{intentId}/submissions` | Owner | Owner or ADMIN of `payment-intent@param:intentId` |
| GET | `/payments/methods` | Authenticated | Any signed-in user; row-level rules enforced in the service |
| GET | `/personality-quiz-sse` | Authenticated | Any signed-in user; row-level rules enforced in the service |
| POST | `/quiz/answers` | Owner | Owner or ADMIN of `quiz-attempt@body:attemptId` |
| DELETE | `/quiz/answers/{id}` | Owner | Owner or ADMIN of `answer` |
| GET | `/quiz/answers/{id}` | Owner | Owner or ADMIN of `answer` |
| PATCH | `/quiz/answers/{id}` | Owner | Owner or ADMIN of `answer` |
| POST | `/quiz/questions` | Role | ADMIN or TEACHER |
| DELETE | `/quiz/questions/{id}` | Role | ADMIN |
| GET | `/quiz/questions/{id}` | Owner | Owner or ADMIN of `question`; `correctAnswer` is only returned to ADMIN and TEACHER |
| PATCH | `/quiz/questions/{id}` | Role | ADMIN or TEACHER |
| POST | `/quiz/quiz-attempts` | Own rows | Query and body forced to the caller; ADMIN unrestricted |
| POST | `/quiz/quiz-attempts/start` | Authenticated | Attempt is created for the caller; a `userId` in the body is rejected (strict DTO); a quiz in someone's progress is only for that owner and a template quiz only for a learner enrolled in its topic (`QuizAccessService`, 403 `ENTITLEMENT_REQUIRED`) |
| POST | `/quiz/quiz-attempts/{id}/submit` | Owner | Owner or ADMIN of `quiz-attempt`; grading and learning events run in one transaction |
| DELETE | `/quiz/quiz-attempts/{id}` | Owner | Owner or ADMIN of `quiz-attempt` |
| GET | `/quiz/quiz-attempts/{id}` | Owner | Owner or ADMIN of `quiz-attempt` |
| PATCH | `/quiz/quiz-attempts/{id}` | Owner | Owner or ADMIN of `quiz-attempt` |
| GET | `/quiz/quiz-attempts/{id}/answers` | Owner | Owner or ADMIN of `quiz-attempt` |
| GET | `/quiz/quizs` | Role | ADMIN or TEACHER |
| POST | `/quiz/quizs` | Role | ADMIN or TEACHER |
| DELETE | `/quiz/quizs/{id}` | Role | ADMIN |
| GET | `/quiz/quizs/{id}` | Owner | Owner of the progress the quiz belongs to, or a learner enrolled in the topic of a template quiz; ADMIN and TEACHER always; the answer key is removed for everyone else |
| PATCH | `/quiz/quizs/{id}` | Role | ADMIN or TEACHER |
| GET | `/quiz/quizs/{id}/questions` | Owner | Same rule as the quiz; `correctAnswer` is only returned to ADMIN and TEACHER |
| GET | `/quiz/quizs/{id}/quiz-attempts` | Owner | Owner or ADMIN of `quiz` |
| GET | `/streak-sse` | Authenticated | Any signed-in user; row-level rules enforced in the service |
| GET | `/teacher/applications` | Authenticated | Any signed-in user; row-level rules enforced in the service |
| POST | `/teacher/applications` | Authenticated | Any signed-in user; row-level rules enforced in the service |
| GET | `/teacher/applications/{id}` | Owner | Owner or ADMIN of `teacher-application` |
| PATCH | `/teacher/applications/{id}` | Owner | Owner or ADMIN of `teacher-application` |
| POST | `/teacher/applications/{id}/approve` | Role | ADMIN |
| POST | `/teacher/applications/{id}/reject` | Role | ADMIN |
| GET | `/teacher/certifications` | Owner | Owner or ADMIN of `teacher-application@query:teacherApplicationId` |
| POST | `/teacher/certifications` | Owner | Owner or ADMIN of `teacher-application@body:teacherApplicationId` |
| DELETE | `/teacher/certifications/{id}` | Owner | Owner or ADMIN of `teacher-certification` |
| GET | `/teacher/certifications/{id}` | Owner | Owner or ADMIN of `teacher-certification` |
| PATCH | `/teacher/certifications/{id}` | Owner | Owner or ADMIN of `teacher-certification` |
| GET | `/teacher/experiences` | Owner | Owner or ADMIN of `teacher-application@query:teacherApplicationId` |
| POST | `/teacher/experiences` | Owner | Owner or ADMIN of `teacher-application@body:teacherApplicationId` |
| DELETE | `/teacher/experiences/{id}` | Owner | Owner or ADMIN of `teacher-experience` |
| GET | `/teacher/experiences/{id}` | Owner | Owner or ADMIN of `teacher-experience` |
| PATCH | `/teacher/experiences/{id}` | Owner | Owner or ADMIN of `teacher-experience` |
| GET | `/tenants/current` | Tenant | Active member of the tenant; ADMIN may act on any tenant when naming it |
| PATCH | `/tenants/current` | Tenant | Active member of the tenant with role OWNER/MANAGER; ADMIN may act on any tenant when naming it |
| GET | `/tenants/mine` | Authenticated | Any signed-in user; row-level rules enforced in the service |
| DELETE | `/uploads` | Authenticated | Any signed-in user; row-level rules enforced in the service |
| POST | `/uploads` | Authenticated | Any signed-in user; row-level rules enforced in the service |
| GET | `/user-steps-sse` | Authenticated | Any signed-in user; row-level rules enforced in the service |
| GET | `/users` | Role | ADMIN; query limited to `q`, `role`, `isActive`, `page`, `limit` (max 100) and `sort` (`createdAt`, `name`, `email`, `role`, with `:asc` or `:desc`); other keys are dropped, there is no `include`, the password hash is never selected |
| POST | `/users` | Role | ADMIN |
| DELETE | `/users/{id}` | Role | ADMIN |
| GET | `/users/{id}` | Authenticated | Any signed-in user; row-level rules enforced in the service |
| PATCH | `/users/{id}` | Authenticated | Any signed-in user; row-level rules enforced in the service |
| POST | `/users/{id}/activation` | Role | ADMIN |
| POST | `/users/{id}/role` | Role | ADMIN |
| POST | `/webhooks/payments/{provider}` | Public | No credentials |

## Internal routes for `ai-api` (added 2026-10-09, not yet in the counts above)

The counts above predate these routes and omit the other internal controllers (`episodes`, `decision-traces`, `agent-sessions`, `credits`); a full regeneration is task SP-020 of the progress tracker. Design: [ai-api-service-identity.md](./ai-api-service-identity.md).

Decision names used here: **Service** is `@InternalOnly()` (signed service identity only). **Service + acting user** is `@InternalActing()`: signed service identity, then `ActingUserGuard` loads the user named in `x-acting-user-id` (400 without it, 403 when unknown or inactive) and applies the stated ownership rule with no `ADMIN` bypass. Writes also require `x-idempotency-key`, and a repeated key replays the first response.

| Method | Path | Decision | Rule |
|---|---|---|---|
| GET | `/internal/lessons/{id}` | Service | Curriculum is platform-global |
| GET | `/internal/steps` | Service | Curriculum is platform-global |
| GET | `/internal/steps/{id}` | Service | Curriculum is platform-global |
| GET | `/internal/user-steps/{id}` | Service + acting user | Acting user owns the step |
| GET | `/internal/learning-styles/{id}` | Service + acting user | Acting user owns the profile |
| GET | `/internal/personality-quizzes` | Service + acting user | `userId` query is the acting user or absent, otherwise 403 |
| GET | `/internal/contents/similarity` | Service + acting user | Acting user owns the chat named by `chatId` |
| GET | `/internal/concepts` | Service | Concept registry is platform-global: active concepts, prerequisites and approved `PYTHON_DOMAIN` aliases |
| GET | `/internal/learner-state` | Service + acting user | Reads only the acting user's `ConceptMastery`; a `userId` query is ignored; `lessonId`, `conceptId` and `userStepId` (resolved only for a user step the acting user owns) choose the concepts; `intent` (closed set, default `DOUBT`) selects the teaching strategy that comes back as `strategy` for the first concept |
| PATCH | `/internal/chat-messages/{id}` | Service + acting user | Acting user owns the message; body `{ text, status? }`, other fields 400 |
| POST | `/internal/contents` | Service + acting user | Acting user owns the chat named in the body; unknown fields 400 |
| POST | `/internal/personality-quizzes` | Service + acting user | Body `userId` is the acting user or absent, otherwise 403 |

## Routes added 2026-10-11 (not yet in the counts above)

| Method | Path | Decision | Detail |
|---|---|---|---|
| GET | `/admin/audit-logs` | Role | ADMIN; filters `action`, `entityType`, `entityId`, `actorId` (uuid), `from`, `to` (from not after to), `page`, `limit` (max 100); unknown query keys are dropped, never passed to the database; rows carry no `before` or `after` |
| GET | `/admin/audit-logs/actions` | Role | ADMIN; distinct action names for the filter |
| GET | `/admin/audit-logs/{id}` | Role | ADMIN; the only route that returns the `before` and `after` payload |
| GET | `/marketplace/articles/{id}/preview` | Public | Published article of an active tenant only; returns at most the first 600 characters cut at a paragraph boundary plus word count and reading minutes, never the rest of the body; a paid article never shows more than half of its text, so a short paid article is not readable in full from the preview |
| GET | `/curriculum/lessons/{id}/prev` | Authenticated | The lesson before this one in the same sub-topic, with `completed` for the caller only |
| GET | `/curriculum/lessons/{id}/next` | Authenticated | The lesson after this one in the same sub-topic, with `unlocked` true only when the caller finished the current lesson |

Removed 2026-10-11: `/admin/moderation/*` (`pending`, `articles|classes/{id}/approve|reject`). It let an ADMIN or REVIEWER publish or reject any article or class from any state, without the state table, version publishing, tenant checks, audit entry or idempotency. Moderation now goes only through the `admin/articles` and `admin/classes` intent endpoints, which are ADMIN only.

## Routes added 2026-10-12 (not yet in the counts above)

| Method | Path | Decision | Detail |
|---|---|---|---|
| GET | `/learner-model/me/strategy` | Authenticated | Teaching strategy for the caller on `conceptId` (default: the next concept) and `intent` (closed set); reads only the caller's own mastery, misconceptions and strategy outcomes; a `userId` query is ignored |
| GET | `/learner-model/me/strategies` | Authenticated | Per strategy attempts, successes and average mastery change of the caller, and the strategy the policy prefers for them |
| GET | `/internal/prompts/resolve` | Service + acting user | Prompt template for `name` (closed set) chosen for the acting user: the canary version for a stable share of learners, the active version otherwise, `null` when none is live |
| GET | `/admin/optimization/prompts` | Role | ADMIN; every version of a prompt with its measured metrics and the metrics of the builtin prompt |
| GET | `/admin/optimization/prompts/builtin` | Role | ADMIN; the canonical text of the builtin template |
| GET | `/admin/optimization/runs` | Role | ADMIN; the last 50 gate evaluations and decisions |
| GET | `/admin/metrics/circularity` | Role | ADMIN; five read-only component metrics (mastery change, review outcome, knowledge reuse, creator conversion, prompt evidence) over `from` and `to` (default last 30 days, at most 366); demo accounts (`@reducera.local`) are counted apart; a metric below its minimum sample answers without a value |
| POST | `/admin/optimization/prompts` | Role | ADMIN; proposes a version as `DRAFT`; the template must satisfy the placeholder contract (422 otherwise) |
| POST | `/admin/optimization/prompts/{id}/canary` | Role | ADMIN; `DRAFT` to `EXPERIMENTAL` for 1 to 50 percent of learners; one canary per prompt |
| POST | `/admin/optimization/prompts/{id}/evaluate` | Role | ADMIN; compares the canary with the active (or builtin) prompt on measured criteria; passes to `VALIDATED`, rolls back on regression, otherwise stays |
| POST | `/admin/optimization/prompts/{id}/approve` | Role | ADMIN; `VALIDATED` to `ACTIVE` only on a human decision with a reason and `acknowledgeUnmeasured: true`; the previous active version is archived |
| POST | `/admin/optimization/prompts/{id}/reject` | Role | ADMIN; reason required |
| POST | `/admin/optimization/prompts/{id}/rollback` | Role | ADMIN; kill switch: `ACTIVE` to `ROLLED_BACK`, the latest archived version becomes active again |
| POST | `/notes` | Authenticated | Creates a note for the caller; the owner comes from the token, never from the body; at most 5000 notes per user (409 `NOTE_LIMIT_REACHED`) |
| GET | `/notes` | Authenticated | Lists only the caller's notes; filters, `page` and `limit` are validated, unknown keys 400 |
| GET | `/notes/{id}` | Owner | Owner or ADMIN of `note` |
| PATCH | `/notes/{id}` | Owner | Owner or ADMIN of `note`; update DTO built with `partialWithoutDefaults` |
| DELETE | `/notes/{id}` | Owner | Owner or ADMIN of `note` |
| POST | `/chat/chat-attachments` | Owner | Owner or ADMIN of `chat@query:chatId`; multipart image upload kept in memory; the type is decided by magic bytes (png, jpeg, webp, gif), at most 4 MB (413), 422 for a missing file or another type, at most 6 unsent and 100 in total per chat (409 `ATTACHMENT_LIMIT_REACHED`), unsent images older than an hour are dropped, rate limited to 12 a minute |
| GET | `/chat/chat-attachments/{id}/content` | Owner | Owner or ADMIN of `chat-attachment`; the image bytes with `nosniff`, `Content-Security-Policy: sandbox` and a private cache header |
| DELETE | `/chat/chat-attachments/{id}` | Owner | Owner or ADMIN of `chat-attachment`; only an image not yet linked to a message, otherwise 409 |
| GET | `/internal/chats/{chatId}/context` | Service + acting user | Acting user owns `chat@param:chatId`; the latest `limit` (1 to 30) messages with their citations and attachment metadata (never bytes), `beforeMessageId` pages backwards |
| GET | `/internal/chat-attachments/{id}/content` | Service + acting user | Acting user owns the attachment through its chat; returns the image as base64 for the multimodal tutor |
| GET | `/internal/topic-sources` | Service + acting user | `lessonId` or `userStepId` (one required, otherwise 400); returns the topic, sub-topic and concept records the learner is studying, the only text a generated material may cite besides uploaded resources |
| PUT | `/internal/lessons/{lessonId}/introduction` | Service + acting user | Saves the introduction the tutor wrote with its citations for the acting user; idempotency key required, 20 to 20000 characters |
| POST | `/internal/user-steps/{id}/practice-quiz` | Service + acting user | Acting user owns `user-step`; creates a practice quiz proposed by the tutor, questions are validated and the answer key never leaves the API |

Removed 2026-10-12: `POST /tutor/message`. It answered with a template sentence instead of a tutor reply, wrote an episode and a decision trace for it and had no caller; the tutor is `/ai/v1/learning/chat`, which now records its own turns.

`POST /teacher/applications` now requires `expertiseTopicId` and answers 422 `MASTERY_THRESHOLD_NOT_MET` unless every concept of that topic is passed with a mean mastery of at least 0.85.

## Behaviour changed 2026-10-16 (no new access decision)

| Method | Path | Decision | Detail |
|---|---|---|---|
| POST, PATCH | `/articles`, `/articles/{id}`, `/classes`, `/classes/{id}` | Tenant scoped | Accept `conceptIds` (at most 5 active concept ids; strict DTO). The tags are written in the same transaction as the product, under the row lock of the owner check, as `PROPOSED` links; an unknown or retired concept answers 422. Only the author or a tenant manager of an editable (DRAFT or REJECTED) product can change them |
| GET | `/articles/{id}`, `/classes/{id}` | Tenant scoped | Return `conceptLinks` with their review status for the author |
| GET | `/admin/articles/{id}`, `/admin/classes/{id}` | Role | ADMIN; return `conceptLinks` so the reviewer sees the proposed tags |
| POST | `/admin/articles/{id}/approve`, `/admin/classes/{id}/approve` | Role | ADMIN; approving the product turns its `PROPOSED` links into `APPROVED` inside the same transaction and row lock; reject, suspend and archive leave them as they are |
| GET | `/marketplace/articles`, `/marketplace/articles/{id}`, `/marketplace/classes`, `/marketplace/classes/{id}` | Public | Return `concepts` (id and title) from `APPROVED` links only |
| GET | `/marketplace-discovery/recommendations` | Authenticated | Ranked by the caller's own needs (weak, next, due for review, ready) against `APPROVED` links; excludes products the caller owns, is enrolled in or authored; `limit` 1 to 30 (400 outside); a `userId` query is ignored. A product with no matching need is only listed as a labelled new arrival |
| POST | `/admin/optimization/prompts/propose-improvement` | Role | ADMIN; body `{ name }` only (strict, `name` from the closed contract list); refused with 409 when fewer than 30 turns of the current template are measured or three AI proposals are still drafts; sends the template, the gate metrics and at most six redacted replies (no learner question, no name) to `ai-api`, then saves the checked answer as a `DRAFT` through the registry with `origin: AI_PROPOSED` and the audit action `PROMPT_PROPOSED_BY_AI`; it cannot start a canary or activate |
| POST | `/admin/optimization/benchmarks` | Role | ADMIN; body `{ name, datasetName?, candidatePromptId?, repeats 1 to 5, judge }` (strict); queues one offline benchmark of the candidate (or the baseline against itself) on a frozen dataset; 409 while another run is queued or running, when the dataset is missing, unfrozen or no longer matches its digest, or the candidate is rejected, rolled back or archived; 422 when a template breaks the placeholder contract |
| GET | `/admin/optimization/benchmarks` | Role | ADMIN; the last 20 runs as summaries, without template bodies or samples |
| GET | `/admin/optimization/benchmarks/{id}` | Role | ADMIN; one run with its plan, progress, report and template hashes |
| GET | `/admin/optimization/benchmarks/{id}/cases/{caseId}` | Role | ADMIN; both arms of one case next to its expectation and rubric |
| POST | `/admin/optimization/benchmarks/{id}/decision` | Role | ADMIN; once, on a completed run, under a row lock; body `{ decision: ACCEPTED, REJECTED or DEFERRED, rationale 10 to 1000 characters }` (strict); the actor and the time come from the request, never the body |
| POST | `/admin/optimization/benchmarks/{id}/propose-improvement` | Role | ADMIN; no body; only a completed run on the development set whose baseline is still in use (409 otherwise, and always for a run on the judging benchmark); creates an AI proposed `DRAFT` |
| POST | `/ai/v1/prompt-proposals` (`ai-api`) | Service identity | Caller id `api` only, signed with `INTERNAL_API_SECRET`, acting administrator in the signature, `Idempotency-Key` required (a fresh key per request); a user bearer token is ignored; the answer is checked for the placeholder contract, the protected sentences and the size of the edit before it is returned |
| POST | `/ai/v1/benchmark/run-case` (`ai-api`) | Service identity | Caller id `api` only, signed with `INTERNAL_API_SECRET`, acting administrator in the signature, `Idempotency-Key` required (derived from run, arm, case and repeat, so a retried call is not run twice); a user bearer token is ignored; the template must satisfy the placeholder contract (422); the model call runs in a worker thread |

## Behaviour changed 2026-10-16, tags of content that is already waiting or live

| Method | Path | Decision | Detail |
|---|---|---|---|
| PUT | `/articles/{id}/concepts`, `/classes/{id}/concepts` | Tenant scoped | Body `{ conceptIds }` only (strict, at most 5 active concept ids; 422 for an unknown or retired concept). The author or a tenant manager of the product, in the tenant of `x-tenant-id`; another tenant answers 404. Allowed while the product is DRAFT, REJECTED, PENDING_REVIEW or PUBLISHED; SUSPENDED and ARCHIVED answer 409 `CONTENT_LOCKED`. Runs under the row lock of the product and writes the audit action `ARTICLE_CONCEPTS_UPDATED` or `CLASS_CONCEPTS_UPDATED`. A concept that is added becomes a `PROPOSED` link; a concept that is removed disappears at once (including an `APPROVED` one, because removing a claim needs no review). The published text, price and version are not touched |
| POST | `/admin/articles/{id}/approve-concepts`, `/admin/classes/{id}/approve-concepts` | Role | ADMIN; body `{ note? }`; PUBLISHED products only (409 `INVALID_STATE_TRANSITION` otherwise); turns every `PROPOSED` link into `APPROVED` in one transaction under the row lock; idempotent (`changed: false` and no audit row when nothing waits); audit `ARTICLE_CONCEPTS_APPROVED` or `CLASS_CONCEPTS_APPROVED` |
| POST | `/admin/articles/{id}/reject-concepts`, `/admin/classes/{id}/reject-concepts` | Role | ADMIN; body `{ reason }` (required); PUBLISHED products only; deletes the `PROPOSED` links and keeps the `APPROVED` ones; idempotent; audit `ARTICLE_CONCEPTS_REJECTED` or `CLASS_CONCEPTS_REJECTED` with the reason and the rejected concept ids |
| GET | `/admin/articles`, `/admin/classes` | Role | ADMIN; every row now has `pendingConceptTags`; the query `pendingTags=true` keeps only rows with a `PROPOSED` link (`false` or absent changes nothing) |

A product in PENDING_REVIEW keeps its tags as `PROPOSED` and they are approved by the product approval as before; the new routes exist for the products that are already PUBLISHED.

## Behaviour changed 2026-10-16, sandbox variants and the review reminder

| Method | Path | Decision | Detail |
|---|---|---|---|
| GET | `/sandbox/scenarios/{id}/variants/{seed}` | Authenticated | Acts as the caller. `seed` is a whole number from 1 to 999999 (400 otherwise). Answers 409 until the caller has solved the scenario. Returns the same transaction with other amounts, the three structural hints and the number of variants, never the answer key. Writes nothing |
| POST | `/sandbox/scenarios/{id}/variants/{seed}/check` | Authenticated | Same guard and same body as the normal check (1 to 12 lines, strict). Returns the diagnosis for the scaled key and, only when correct, the solution. Writes no check, no practice row, no learner event and no misconception: `countsAsEvidence` is `false` |
| POST | `/sandbox/scenarios/{id}/variants/{seed}/reveal` | Authenticated | Same guard. Returns the scaled solution without marking the base scenario as revealed |
| PUT | `/learner-model/me/review/reminders` | Authenticated | Body `{ enabled }` (strict boolean). Changes only the caller's own `reviewReminders` flag |
| GET | `/learner-model/me/review` | Authenticated | The answer now carries `reminders`, the caller's own flag |

The queue `review-reminders` (BullMQ, `0 18 * * *` Asia/Jakarta) has no route: it writes one `REVIEW` notification at most per learner and day, only for learners who have not turned the reminder off.

## Behaviour added 2026-10-16, the SQL playground, the tryout and paging

| Method | Path | Decision | Detail |
|---|---|---|---|
| GET | `/sandbox/scenarios` | Authenticated | New optional query `limit` (1 to 50) and `cursor` (0 to 100000). The answer carries `page: { total, limit, nextCursor }`; without `limit` it returns every scenario. `summary` and `recommended` do not depend on the page |
| GET | `/sandbox/sql` | Authenticated | Datasets (tables and columns), the exercises without answer, hints or reference SQL, and the caller's own progress row per exercise |
| POST | `/sandbox/sql/run` | Authenticated | Body `{ datasetId, sql }` (strict, 6000 characters at most). Runs on the separate `sandbox-db` through the guard; writes nothing. 40 runs and checks per minute per caller (429 after). 503 when the sandbox database is down, 429 when the run queue is full |
| POST | `/sandbox/sql/exercises/{id}/check` | Authenticated | Body `{ sql }` (strict). A refused statement writes nothing; a run, including one that fails, adds an attempt to the caller's own row; a correct run marks it solved once |
| POST | `/sandbox/sql/exercises/{id}/hint` | Authenticated | Opens the next hint only after one more attempt than hints already opened. Own row only |
| POST | `/sandbox/sql/exercises/{id}/reveal` | Authenticated | 409 until the caller has made one attempt; returns the reference SQL and the explanation and sets `revealed` on the caller's row |
| GET | `/sandbox/tryout` | Authenticated | Subtests, presets, the caller's running session and recent results; closes the caller's sessions that are past the deadline plus 15 seconds |
| GET | `/sandbox/tryout/history` | Authenticated | Query `band`, `subtest`, `sort`, `limit`, `cursor` (strict). Finished sessions of the caller only, at most the 200 most recent are read |
| POST | `/sandbox/tryout` | Authenticated | Body `{ examKey: 'utbk-snbt', subtests: [{ key, count }] }` (strict, 1 to 7 subtests, counts within what the bank can fill, 160 questions at most). The seed is chosen by the server. 6 per minute per caller; 409 while another session runs (partial unique index) |
| GET | `/sandbox/tryout/{id}` | Authenticated | Owner only (404 for another learner). Questions without key or explanation, saved answers, server time and remaining seconds |
| PUT | `/sandbox/tryout/{id}/answers` | Authenticated | Owner only. Body `{ answers: { q1: 0..4 or null } }`, merged under a row lock; 409 after the deadline plus 15 seconds. 120 per minute per caller |
| POST | `/sandbox/tryout/{id}/submit` | Authenticated | Owner only, idempotent: a second submit returns the stored result. Answers in the body count only within the grace period. Writes one learner event per concept with two or more questions when at least half were answered |
| GET | `/sandbox/tryout/{id}/result` | Authenticated | Owner only, 409 until submitted. Carries the key and the explanations |

No payload of these routes has a top level `message` or `data` key, because the response wrapper would take it; the specs assert this.

## Routes added 2026-10-17, gamify administration (ADR-026)

Every route is `@Roles(ADMIN)`, writes are strict Zod bodies that carry a `reason` of 3 to 500 characters, each change runs in one transaction under an advisory lock and writes an audit entry with the state before and after. None of them touches a `GamificationLedger` row.

| Method | Path | Decision | Detail |
|---|---|---|---|
| GET | `/admin/gamify/rules` | Role | ADMIN; the five reward rules of the catalog with their editable fields (label, unit, bounds), the version in force (or off), every version and its values; the built-in default is shown as version 1 while no row exists |
| POST | `/admin/gamify/rules/{code}/versions` | Role | ADMIN; body `{ baseVersion, values, reason }`; `values` must be exactly the fields of the rule inside their bounds (400 otherwise); creates the next version, puts it in force and retires the others; 409 when `baseVersion` is not the latest version, 400 when the values equal the version in force, 404 for a code outside the catalog; the first publication also writes the built-in default as a retired version 1; audit `GAMIFY_RULE_PUBLISHED` |
| POST | `/admin/gamify/rules/{code}/versions/{version}/activate` | Role | ADMIN; body `{ reason }`; puts an older (or newer) stored version back in force and retires the rest, which is a rollback; 409 when it is already the only one in force, 404 for a missing version; audit `GAMIFY_RULE_ACTIVATED` |
| POST | `/admin/gamify/rules/{code}/deactivate` | Role | ADMIN; body `{ reason }`; retires every version so the rule pays and earns nothing (the built-in default does not come back); 409 when it is already off; audit `GAMIFY_RULE_DEACTIVATED` |
| GET | `/admin/gamify/levels` | Role | ADMIN; the ladder in use (the built-in one while no row exists) with a `fingerprint` to edit against |
| POST | `/admin/gamify/levels/replace` | Role | ADMIN; body `{ baseFingerprint, levels, reason }`; 2 to 30 levels numbered from 1 without a gap, the first at 0 XP, XP strictly rising (400 otherwise); 409 when the fingerprint is stale, 400 when the ladder is unchanged; replaces all rows in one transaction; audit `GAMIFY_LEVELS_REPLACED` with both ladders |
| GET | `/admin/gamify/achievements` | Role | ADMIN; every achievement with its typed rule, state and the number of learners who unlocked it, plus the metrics and the icon names the form offers |
| POST | `/admin/gamify/achievements` | Role | ADMIN; body `{ code, title, description, iconName, rule: { metric, value }, sortOrder, reason }`; the code is lower-case words joined by hyphens, the icon one of the ten theme icons, the target bounded by the metric; the type is derived from the metric and the operator is always `>=`; 409 `UNIQUE_CONSTRAINT_FAILED` when the code is taken; audit `GAMIFY_ACHIEVEMENT_CREATED` |
| PATCH | `/admin/gamify/achievements/{code}` | Role | ADMIN; body with at least one of `title`, `description`, `iconName`, `sortOrder` and a `reason`; the rule, the code, the type and the state cannot be sent (400); 400 when nothing changes; audit `GAMIFY_ACHIEVEMENT_UPDATED` with the changed fields only |
| POST | `/admin/gamify/achievements/{code}/activate` | Role | ADMIN; body `{ reason }`; 409 when already active; audit `GAMIFY_ACHIEVEMENT_ACTIVATED` |
| POST | `/admin/gamify/achievements/{code}/deactivate` | Role | ADMIN; body `{ reason }`; the evaluator stops unlocking it, learners who already unlocked it keep their row; 409 when already retired; audit `GAMIFY_ACHIEVEMENT_DEACTIVATED` |

## Routes added 2026-10-17, per-user gamify theme (ADR-027)

The learner side of the theme. The administrator keeps only the default theme (`/gamify/themes`, `set-default`); nothing here changes it. Every route is `@AuthenticatedOnly()` and the service reads and writes only the row whose `userId` is the id of the session: no body or query field names a user, and a body that carries one is refused (400).

| Method | Path | Decision | Detail |
|---|---|---|---|
| GET | `/gamify/me/theme` | Authenticated | The caller's own theme as `{ custom, mood, intensity, theme }`; `custom: false` and `theme: null` when none is stored or the stored tokens no longer satisfy the schema |
| PUT | `/gamify/me/theme` | Authenticated | Body `{ mood, intensity }` (strict): 1 to 3 different moods from the closed list, intensity a whole number from 0 to 100. The server generates the palette, which always passes the contrast pairs, and upserts the caller's single row; the same body gives the same palette |
| POST | `/gamify/me/theme/preview` | Authenticated | Same body; returns the generated theme and writes nothing |
| DELETE | `/gamify/me/theme` | Authenticated | Deletes the caller's row, so the default theme applies again; the same answer whether or not a row existed |
