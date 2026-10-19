# Accounting sandbox: research and design basis

> Status: research for RC-24 (2026-10-12). Owner decision needed only where marked **Decision**.
> Scope: the learner-facing journal practice area (`/sandbox`, `services/api/src/v1/sandbox`). It is not the commerce ledger (`docs/architecture/accounting-sandbox.md` section 3 keeps the two apart).

## 1. What exists today and what is wrong with it

Audit of the code on 2026-10-12.

| Area | Today | Problem |
|---|---|---|
| Content | `golden-scenarios.json`, 7 scenarios, English, US dollars ("Buy inventory for $100 cash") | The product is Indonesian and the UI labels the amount "Rp"; seven items cannot cover four levels or the new trade-company topic |
| Input | Free text for the debit and credit account, one debit and one credit per row, equal amounts | Typing errors look like conceptual errors; a compound entry (two debits, one credit, for example goodwill) cannot be expressed |
| Checking | Balance test plus the overlap of strings `account:side:amount` with the answer key | A learner who swaps debit and credit, mistypes an amount or picks a similar account gets the same bare score and no explanation |
| Feedback | "Jurnal belum seimbang" and a percentage | No error type, no reason, no next step; nothing is said about why |
| Help | None | No hint, no worked example, no way to see the answer after trying |
| Persistence | None. `SandboxAttempt` exists in the schema but the validate path never writes it (progress tracker, "Open gaps" item 1) | Nothing to resume, nothing to learn from, no evidence for mastery or rewards |
| Learner model | Not connected | A solved journal is the best evidence the platform could collect about `journal_entry`, and it is dropped |
| Money | JavaScript floats with `1e-6` tolerance | Contradicts `AGENTS.md` (money is exact) and the sandbox architecture note |
| Scenario answer key | Stripped from the list route (good, tested in `scenario-answer-key.spec.ts`) | Must stay true for every new route |

## 2. Evidence review

Quality is graded honestly: peer reviewed (P), practitioner or vendor (V), secondhand summary (S).

### 2.1 Tutoring on the accounting cycle

- Johnson, Phillips and Chase (2009), *Journal of Accounting Education* 27(1), 30-39 (P). A tutor that gives feedback on the problem-solving process and not only the final answer was compared with textbook homework on journalizing: the tutor group gained about 27 percentage points, the textbook group about 8. Sources: [ResearchGate abstract](https://www.researchgate.net/publication/314589782_An_Intelligent_Tutoring_System_for_the_Accounting_Cycle_Enhancing_Textbook_Homework_with_Artificial_Intelligence), [IDEAS record](https://ideas.repec.org/a/eee/joaced/v27y2009i1p30-39.html). The tutor corrects at subgoal boundaries (analyse the effect on the accounting equation, then journalize) and steps in after three inaccurate attempts.
- Hahn, Fairchild and Dowis (2013), *Issues in Accounting Education* (P, abstract only). In an introductory course neither an online homework manager nor a tutoring system showed a learning advantage. Reading: the effect is design dependent, so we must measure it and not assume it.
- A field experiment reported in the same literature (P, secondhand through search): students journalized better at first when they considered accounting equation effects explicitly, but the benefit faded within a week. Reading: the equation analysis is a scaffold to teach and then fade, not a permanent crutch.
- Diagnosis in tutors. A review of 40 tutors compares how they diagnose errors and lists "type of error" and "common errors (buggy rules)" as separate aspects; the review names two accounting tutors, Assistment and Quantum Accounting, as classifying error types. Source: [The Diagnosing Behaviour of Intelligent Tutoring Systems](https://webspace.science.uu.nl/~jeuri101/homepage/Publications/DiagnosingBehaviour.pdf) (P).
- Two patents on a goal-based accounting tutor (V, not evidence of effect) describe three feedback shapes: redirect for global errors, focus for errors clustered in one area, polish for surface errors. We borrow the vocabulary only.

### 2.2 What learners get wrong in journal entries

Evidence here is practitioner level (V); no peer reviewed error census was found.

- The debit and credit swap is named as one of the most frequent introductory errors, and it appears even when the learner knows the rule per account type, because the rule must be applied to several account types in one transaction. [K12 tutoring note](https://tutoring.k12.com/resources/tutoring-help/business/accounting/common-accounting-mistakes-students-make-and-how-feedback-helps/), [Studiosity](https://www.studiosity.com/blog/common-accounting-mistakes-and-how-to-avoid-them).
- Account confusion (cash against receivable, similar expense titles), incomplete analysis of a transaction that touches several accounts, and transposed digits.
- Learners copy a modelled example well and fail when the wording changes. This is the worked-example transfer problem of section 2.3.
- A GCSE examiner report notes weak command of double-entry principles and of clearing a suspense account. [Pearson report](https://qualifications.pearson.com/content/dam/pdf/International-GCSE/Accounting/2023/Exam-materials/4wac1-01-pef-20250821.pdf).

Design consequence: classify what the learner did into a small closed set (reversed side, wrong amount, transposed digits, wrong account of the right class, wrong class, missing line, extra line, unbalanced), because each has a different explanation and each feeds the misconception model.

### 2.3 Worked examples, fading and help

- Adaptive fading of worked examples inside a tutor beat both a plain tutor and a fixed fading schedule on delayed transfer, and fading by the learner's performance beat a predefined schedule. [Salden et al.](https://faculty.engineering.asu.edu/mre/wp-content/uploads/sites/31/2020/02/Stat_Adapt_Fad_JEE06.pdf), [Cognitive Tutor study](https://researchportal.hw.ac.uk/en/publications/are-worked-examples-and-tutored-problem-solving-synergistic-forms/) (P). A study on fading guidance in financial services training points the same way: [Wollongong](https://ro.uow.edu.au/edupapers/129) (P).
- Help is misused. In a geometry Cognitive Tutor unit, learners abused the hint facility on 36 percent of actions (14 percent when rapid successive requests count once), with the bottom-out hint as the usual target; it is associated with poorer learning. [LearnLab help abuse](https://learnlab.org/research/wiki/index.php/Help_abuse) (S, quoted from a search summary; the page itself could not be fetched, so the figures need checking against Aleven et al. 2006 before anyone cites them in public). A 2026 LAK paper makes the same point: well designed hints do not guarantee productive use. [Revisiting the hint button](https://www.cs.cmu.edu/afs/cs.cmu.edu/Web/People/bmclaren/pubs/AnEtAl-RevisitingTheHintButton-LAK2026.pdf) (P).
- Formative feedback should be nonevaluative, supportive, timely and specific; elaborated feedback (why, and what next) beats bare verification, but too much detail can overwhelm novices. [Shute 2008](https://myweb.fsu.edu/vshute/pdf/shute%202008_b.pdf) (P). Timing guidance in the secondary summaries is mixed and was not verified against the paper.

Design consequence: a hint ladder that starts with the analysis (what grows, what shrinks), then the kind of accounts, then the account titles, with the answer reachable only after an attempt, a floor of time between hints, and no mastery credit for assisted solutions. Worked examples appear first for a concept and fade when the learner solves unaided.

### 2.4 Practice scheduling

- Spaced and interleaved practice slow initial learning and improve retention and the ability to tell problem types apart. [MIT teaching note](https://openlearning.mit.edu/mit-faculty/research-based-learning-findings/spaced-and-interleaved-practice) (V). No study of accounting simulations with these methods was found; a hydraulics course found students liked retrieval practice and test grades did not move (P, 2024). Treat the benefit as plausible and unproven for this domain.

Design consequence: offer a mixed set ("Latihan campur") and recommend the next scenario by weakest recent concept, but do not claim an outcome until the platform's own StrategyOutcome data says so.

### 2.5 Bookkeeping engineering

- Money as integers in the smallest unit, converted only at the edges; reject, do not round, amounts with more decimals than the currency allows. [Finance 101](https://dev.to/timiadesoji/finance-101-part-1-money-as-data-1e2d), [ledgerkit](https://github.com/themusashimaru/ledgerkit) (V).
- Immutable journal: posted entries are never edited; a correction is a reversal that references the original, followed by the right entry. [Modern Treasury](https://moderntreasury.com/journal/enforcing-immutability-in-your-double-entry-ledger), [Fowler, Reversal Adjustment](https://martinfowler.com/eaaDev/ReversalAdjustment.html) (V).
- Rupiah has no minor unit in practice, so whole rupiah as `Int` is exact.

### 2.6 Indonesian conventions

- Account codes by first digit: 1 aset, 2 kewajiban, 3 ekuitas, 4 pendapatan, 5 beban; the example chart uses 101 Kas, 103 Piutang usaha, 201 Utang usaha, 204 Utang gaji, 301 Modal, 302 Prive, 401 Pendapatan usaha, 501 Beban gaji; leaving gaps lets accounts be inserted. [Jurnal.id](https://www.jurnal.id/id/blog/mempelajari-klasifikasi-sistem-kode-akuntansi-chart-of-account) (V). The SAK EMKM chart of accounts itself was not found in open sources, so the sandbox chart is a teaching chart, not a claim of standard conformity.
- Trade-company accounts in Indonesian teaching material: Persediaan Barang Dagang, Pembelian, Retur Pembelian, Potongan Pembelian, Beban Angkut Pembelian, Penjualan, Retur Penjualan, Potongan Penjualan, Harga Pokok Penjualan.

## 3. Design principles

| # | Principle | Source | Feature |
|---|---|---|---|
| P1 | Give feedback on the process, not only the sum | 2.1 | Per-line diagnosis, error type, reason |
| P2 | Teach the equation analysis, then fade it | 2.1, 2.3 | "Dampak pada persamaan akuntansi" panel, shown for unsolved scenarios of a concept and hidden after unaided solves |
| P3 | Classify errors in a closed set | 2.2 | `ErrorCode` enum feeds analytics and misconception patterns |
| P4 | Never leak the key before the learner has tried | 1 | Answer key stays server side; feedback names the problem, not the fix, until the hint level allows it |
| P5 | Hints escalate and cost something | 2.3 | Ladder of three hints plus reveal; 4 s floor between hints; assisted solves earn no mastery |
| P6 | Reveal only after an attempt | 2.3 | `reveal` needs one check or the last hint |
| P7 | Make typing errors impossible | 2.2 | Account chosen from a chart, amounts as whole rupiah, codes not free text |
| P8 | Mix practice | 2.4 | Mixed mode and next-scenario recommendation |
| P9 | Exact money, immutable history | 2.5 | Integer rupiah, append-only `SandboxCheck`, no edits |
| P10 | Practice must reach the learner model | 2.1 | First unaided solve appends `ASSESSMENT_COMPLETED` evidence for the scenario's concept |

## 4. Decisions taken in this tranche

1. **Deterministic engine, no model in the loop.** The engine decides balanced, correct and the error codes. A language model may later propose scenarios or phrase explanations, but a scenario is only usable when the engine can solve it from its own key. (Matches `docs/architecture/accounting-sandbox.md` section 2.)
2. **Content is data.** Chart and scenarios are JSON under `services/api/prisma/seed-data`, validated by a test (balanced key, known accounts, known concepts). Authors cannot ship an unbalanced key.
3. **Evidence only for unaided first solves.** Failed checks never lower mastery (low stakes, productive failure); they are stored for misconception analysis. Re-solving a solved scenario does not add evidence (no farming).
4. **Learner progress is two tables**: `SandboxPractice` (one row per learner and scenario) and `SandboxCheck` (append only). The legacy `SandboxAttempt` family stays untouched; it models a future multi-transaction company simulation.
5. **No AI credits, no new provider.**

**Decision for the owner (not blocking):** the sandbox chart is a teaching chart. If a university customer wants SAK EMKM conformity, a reviewed chart should replace `sandbox-chart-of-accounts.json`; nothing else changes.

## 5. Not in this tranche

Multi-transaction company simulation with ledger and trial balance across a period (the legacy `SandboxPeriod` models), teacher-authored scenarios, model-proposed scenarios behind the engine gate, spaced scheduling driven by `StrategyOutcome`, an effect study (A/B of hints and fading).
