# ADR-023: Put the sandbox practice API on the web and let a solved scenario come back with other numbers

- Status: built on 2026-10-16 at the owner's request ("coba sandbox nya improvisasi", "dynamic learning"); the list of factors and the rule that variants carry no evidence are proposals that wait for the owner (decision D-30)
- Date: 2026-10-16

## Context

The sandbox API (`/sandbox/scenarios`, `check`, `hint`, `reveal`, `signals`) was already adaptive: it keeps progress per learner, opens hints one at a time, diagnoses each journal line, writes learner evidence once, records misconceptions and recommends the next scenario from mastery. The web did not use any of it. `pages/sandbox` called `POST /sandbox/journal/validate`, a route that no longer exists, read the catalog as a plain list although the API answers `{ summary, scenarios, recommended }`, and the scenario page answered a 500 on a server render. A learner could not see a hint, a verdict per line, a recommendation or a bit of progress.

A solved scenario also ended the practice: the key was fixed, so a second try only tested memory of the numbers.

## Decision

1. The web sandbox is rebuilt on the real API: a catalog with progress per level, the recommendation with its reason, the habits that the signals report, filters kept in the address, and a scenario page with an account picker grouped by class, a side choice per row, rupiah typed with dots, a live debit and credit total, the diagnosis of every line, hints one at a time with a visible wait, an explicit confirmation before the answer is shown, and the scaffold the API chose (full, partial or independent) with the numbers behind it.
2. A scenario that the learner solved can be practised again with other numbers (`/sandbox/variasi/{id}?v={seed}`). The numbers are not invented: every amount in the story, in the explanation and in the key is multiplied by one factor from a fixed list (1/2, 4/5, 6/5, 3/2, 2, 5/2, 3, 4), and a factor is used for a scenario only when every amount stays a whole number of rupiah. The text keeps its percentages, months and years. The seed picks the factor in a fixed order, so the same seed always gives the same story.
3. Content must stay scalable: a story or an explanation that writes an amount without dots as thousand separators is refused when the content loads, and a test checks for every scenario and factor that the key stays balanced, that every amount in the text is scaled by the same factor and that each scenario has at least four variants.
4. A variant is free practice. It writes nothing: no check row, no practice row, no learner event, no misconception, no reward. It opens only after the base scenario is solved (otherwise the structure of the answer would leak without the cost of a hint), and showing its answer does not mark the base scenario as revealed.
5. The wait between two hints is shown on the button (4 seconds, the same figure as the API) so a learner is not answered with a 429.

## Consequences

- The evidence still comes only from the first unaided solve of the base scenario. A variant helps retention but cannot farm points or change mastery.
- A scenario has between 4 and 8 variants today. More variety needs more factors or authored variants; it should not need a model, because a model could write a key that is wrong.
- `lastLines` of the base scenario are restored on a reload. The account of a restored row is set through the `selected` attribute of each option, because the `value` attribute of a server rendered select is not read when the page is hydrated.
- Not done: variants of the names and businesses in the stories, variants that count as evidence of retention (that needs the protocol of D-19), and an LLM that writes new scenarios (it would need the judge of O-02 to check the key).
