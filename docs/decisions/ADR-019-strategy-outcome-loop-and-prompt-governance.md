# ADR-019: Close the personalization loop with strategy outcomes and govern prompt versions with a human gate

- Status: built on 2026-10-12 at the owner's request to audit and continue; the gate thresholds, the 24 hour attribution window and the band-compatible strategy sets are proposals that wait for the owner (decision D-27)
- Date: 2026-10-12

## Context

The audit of 2026-10-12 found that the personalization loop of the plan (learner state, policy, tutor, evidence, learning) was broken at four joints and that the self-improving layers of `docs/plans/self-improving-llm.md` existed only as unregistered code:

- the tutor reply of the chat was never stored: the worker wrote `Successfully generate continue material for <first 50 characters>` into the message, so a learner never saw the answer;
- `LearnerPolicyService.teachingStrategy` was called only by an `api` module (`tutor`) that no client used and that answered with a template sentence; the tutor prompt carried mastery but no strategy, although its system text said the strategy was chosen by the policy;
- the personal policy never learned: its loader always returned an empty policy, its persist step only logged, and nothing called its update;
- episodes held `unknown-v0` for model, prompt and policy, no tokens, no latency, and the decision trace said `PHASE_1_FOUNDATION` for every call, so nothing could be measured;
- `PromptOptimizationService` wrote status values that do not exist in the `PromptStatus` enum (`CANARY`, `PUBLISHED`), promoted without a human check, and `EvaluationService` invented scores from the length of the answer.

## Decision

1. The chat worker stores the whole reply. Both workers record model, token usage, latency, prompt label, routing policy version, citations and the teaching strategy on the episode, and the real reason codes and the strategy on the decision trace.
2. `GET /internal/learner-state` returns the teaching strategy for the first concept of the request and an `intent` (closed set, default `DOUBT` for chat, `NEW_LEARNING` for lesson material). The prompt of `ai-api` carries it as `teaching_strategy` plus a fixed playbook line per strategy; a value outside the closed set is dropped.
3. `StrategyOutcome` is an append-only table written only by `StrategyOutcomeService`, inside the grading transaction: the next assessment on a concept is credited to the latest tutor turn of the same learner, of the last 24 hours, whose strategy was chosen for that concept and that has no outcome yet. Success means the concept score went up. One tutor turn gets at most one outcome (unique `episodeId`), one assessment event at most one (unique `eventKey`).
4. The policy uses the evidence: a strategy with at least three outcomes and a 70 percent success rate replaces the default of a doubt or of new learning, but only inside the strategies that fit the mastery band (`teaching-policy-v2`). Remediation for open misconceptions or a missing prerequisite is never overridden.
5. Prompt versions live in `PromptVersion` behind `PromptRegistryService`, the only writer. The state table (`prompt-state.ts`) forces DRAFT, then EXPERIMENTAL (a canary for 1 to 50 percent of learners, stable per learner), then VALIDATED (the gate passed), then ACTIVE (only a human `approve` with a reason and an acknowledgement of the criteria nobody measures). The database allows one ACTIVE and one canary per prompt and a frozen `EvaluationDataset` cannot change.
6. The acceptance gate compares the canary with the active (or builtin) prompt on what the platform measures: learning outcome rate, share of grounded answers, p95 latency, tokens per answer, and a minimum sample. Correctness, pedagogy and hallucination rate are reported as `NOT_MEASURED`; they need a judge or human labels, and no number is invented for them. A regression on a sufficient sample rolls the canary back by itself; the kill switch rolls the active version back and restores the previous one.
7. `ai-api` resolves the template per learner through `GET /internal/prompts/resolve`, validates the placeholder contract again, caches for one minute and falls back to the builtin template on any failure. The builtin template is `services/api/prisma/seed-data/prompt-templates/tutor-chat.txt` and a test keeps the copy in `ai-api` identical.
8. The `api` modules `tutor` (template replies, junk episodes) and `policy` (personal policy that never persisted) and the `evaluation` service (invented scores) are removed.
9. A repeatable job (`0 * * * *`, Asia/Jakarta, queue `prompt-evaluation`) evaluates every running canary with the same gate as the admin route. It may roll a regression back or mark a pass `VALIDATED`; it never activates a version, and it writes no run or audit row while a canary still lacks data. Its audit rows carry no actor. The cadence is a proposal under D-27.
10. Creator applications require `expertiseTopicId` and the server refuses with 422 `MASTERY_THRESHOLD_NOT_MET` unless the topic passes the eligibility rule of ADR-017.

## Consequences

- A learner sees the tutor answer, and every answer leaves a record that can be measured and replayed.
- The strategy a learner receives changes with what worked for them; the learner can read why on the mastery page.
- A prompt can be improved without a deploy, but never without a person approving it, and a bad one is stopped by data or by one click.
- The automatic candidate generation (DSPy, layer 4) and the judge-based benchmark (layer 2) are still open; the registry accepts candidates from any source.
- Legacy applicants without a topic can no longer be submitted through the API; the seeded teachers were created directly and are unaffected.
- Design details: `docs/audit/2026-10-12-system-audit.md`.
