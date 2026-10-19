# ADR-022: Let the AI propose a prompt edit from measured evidence, and keep every decision with a person

- Status: built on 2026-10-16 at the owner's request to continue the self-improving LLM work; the limits below (30 measured turns, 3 open proposals, similarity and length bounds) are proposals that wait for the owner (decision D-29)
- Date: 2026-10-16

## Context

`docs/plans/self-improving-llm.md` has six layers. The registry, the canary, the gate, the human approval and the kill switch (layers 3 and 5, ADR-019) were built, but nothing in the system ever wrote a candidate: every `PromptVersion` came from an administrator typing a template. Layer 4, the optimizer, needs a frozen benchmark (layer 2) and human labels that do not exist yet, so a full offline loop (DSPy, MIPRO, GEPA) cannot run honestly today.

## Decision

1. An administrator can ask for one improvement of a prompt (`POST /admin/optimization/prompts/propose-improvement`, body `{ name }` only, ADMIN only). The request is refused with 409 when fewer than 30 turns of the current template are measured, or when three AI proposals of that prompt still wait as drafts.
2. `api` gathers the evidence and sends it to `ai-api` (`POST /ai/v1/prompt-proposals`, signed as service `api` with the acting administrator, ADR-013): the current template (the active version, or the builtin file), the measured metrics of that label (the same numbers the gate uses), the strategies whose turns did not raise mastery, and at most six replies that were followed by no gain. The learner's question is never sent, the learner's name parts, e-mail addresses and links are replaced before the reply leaves `api`, and each reply is cut to 500 characters. The AI service holds no database access, as before.
3. `ai-api` asks the thinking model for one careful edit (task `prompt_proposal`) and checks the answer itself: placeholders follow the contract, the protected sentences of the template are still there word for word (the data-not-instructions rule, the no-invented-sources rule, the refusal rule, the closed action grammar, the strategy secrecy rule), the template changed, its length stays between 0.7 and 1.4 times the original and at least 60 percent of its lines are unchanged, so it stays an edit and not a rewrite. `api` repeats the placeholder and protected sentence checks (`proposalProblems`); a parity test keeps the two lists identical.
4. A proposal that passes becomes an ordinary `DRAFT` through `PromptRegistryService.propose`, the only writer (the ownership gate still holds). It carries its parent, a rationale and the list of changes written by the model, the evidence it was based on, and `origin: AI_PROPOSED`; the audit action is `PROMPT_PROPOSED_BY_AI`. The web page shows the origin, the changes and a line diff against the parent (or the builtin template).
5. Nothing else changes: a draft needs a person to start the canary, the hourly sweep and the gate measure it on real learners, only a person can activate it, and the kill switch is untouched. The model is never given a way to activate, start a canary or write anything but a draft.

## Consequences

- The loop of the plan now has a source of candidates and a human gate on every one, at the price of one thinking-model call per request (an administrator pressing a button, no schedule).
- A candidate is judged online, by the canary and the gate, not offline. Until the frozen benchmark and the judge exist (O-02), the gate still reports correctness, pedagogy and hallucination rate as `NOT_MEASURED`, and the approval still has to acknowledge that.
- The proposer sees only what the platform measures, so it can only target what is measured (answers that did not help, ungrounded answers); it cannot discover a failure nobody measures.
- Not done: a scheduled proposer, a DSPy optimizer, the judge and the frozen benchmark of 50 scenarios, a per-sample human label, and the measured effect of an accepted proposal (needs one full loop, AC-SI-02).
