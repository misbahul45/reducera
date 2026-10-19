# Five-Minute Demo Script

> **Status**: `in-progress` · **Owner**: `qa-lead` · **Last reviewed**: `2026-10-17`
>
> A time-coded script of 4:40 with on-screen actions, narration, the evidence behind each beat and a fallback for each risk. Screen labels and ids come from the runs recorded in [02](./02-demo-flow-and-evidence.md).

The official page asks for a video of at most five minutes on YouTube (public or unlisted) that shows the solution overview, the key features and a demonstration of the system. The script leaves 20 seconds of buffer.

**Not recording-ready yet.** The recording account does not exist as one account (02 section 7). Ids in the "Evidence" column are the ids of the verified runs; replace them with the ids of the recording run before publishing. Narration is in English, the interface is in Indonesian; add English subtitles for the on-screen Indonesian labels.

---

## 1. Timeline

| Time | Beat | Screen | Claims |
|---|---|---|---|
| 0:00 to 0:25 | Problem and promise | Title card, then the landing page `/` | none (framing) |
| 0:25 to 1:00 | Personalization | `/learn/profile/dashboard`, `/my-learning/mastery` | CL-01, CL-03, CL-04 |
| 1:00 to 1:50 | Lesson, sources and companion | Course path, lesson introduction, step page with CORE | CL-08 |
| 1:50 to 2:30 | Graded practice and evidence | Generated quiz, result, mastery page | CL-01, CL-02, CL-03 |
| 2:30 to 3:10 | Circular marketplace | `/marketplace`, class page | CL-05 |
| 3:10 to 3:50 | Creator path | Admin applications and moderation | CL-06, CL-07, CL-12 |
| 3:50 to 4:30 | Responsible prompt improvement | `/admin/optimization` | CL-09, CL-10, CL-11 |
| 4:30 to 4:40 | Close | `/admin/metrics`, then the title card | CL-15 |

Total about 4:42.

---

## 2. Beats

### 0:00 to 0:25 Problem and promise

- **On screen**: title card "ReduCera" with the one-sentence line; cut to the landing page with the `.id` host visible in the address bar (once deployed).
- **Narration (about 60 words)**: "Accounting students practise journals and ledgers with late feedback, and a student who masters a topic has no way to teach it. ReduCera closes that loop. It reads graded evidence, picks the next short activity, checks whether it helped, and connects mastered concepts to creator content for the next learner. Everything you see runs on demo accounts."
- **Evidence**: none. State no number.
- **Fallback**: none needed.

### 0:25 to 1:00 Personalization

- **Actions**: sign in as the recording learner; dashboard; click the mastery link "SEMUA"; stay on `/my-learning/mastery`; point at "Berikutnya", the strategy sentence, "Ulasan berikutnya" and the "Kami masih mengumpulkan bukti" box.
- **Narration (about 85 words)**: "This is the learner's home. The next concept is Debits and Credits, chosen from graded results, not from a fixed order. The mastery page gives the reason: mid-level mastery, so the tutor will teach with a guided example. A review is scheduled by a forgetting-curve rule. And where the system does not yet have enough evidence to pick the best strategy for this learner, it says so instead of guessing."
- **Evidence**: reason codes `MID_MASTERY`, `INSUFFICIENT_EVIDENCE`; `GET /learner-model/me/next`, `/me/review`, `/me/strategy`.
- **Fallback**: if the page is empty, the account lost its state: stop and restore the fixtures (02 section 7).

### 1:00 to 1:50 Lesson, sources and companion

- **Actions**: show a prepared lesson introduction (recorded earlier, shown without waiting): the stage "2 sumber dari materi course dan 5 cuplikan dari 1 pencarian ditemukan", the numbered references and the source labelled "cocok makna". Open the step page. In CORE type "Kenapa saldo normal akun kas itu debit? Aku masih sering terbalik." and send. Wait for the reply.
- **Narration (about 110 words)**: "A learner starts a course, says how they like to study, and the lesson introduction is written only from course sources. Every statement carries a source number, and some sources are found by meaning, using an embedding model that runs on our own CPU. In the companion, the learner asks a question. The reply is generated from the learner's state and the chosen strategy, and both are stored with the turn. Retrieval returns sources for the chat too, but the reply does not show citation markers yet, so I do not claim citations in chat."
- **Evidence**: `Episode` (strategy `GUIDED_EXAMPLE`, prompt `tutor-chat-builtin-4`); introduction sources are course records and retrieved chunks; the chat worker logs `[RETRIEVE] returned=10`.
- **Fallback**: if the model is slow (replies took 6.5 s in the T1 turn), keep the cursor still and cut the wait with a visible "time-lapse" label. If the gateway is down, play the recorded reply clip labelled "recorded 2026-10-17".
- **Do not show**: the old chat of step `4484935f-…` (it contains the invented praise of the previous prompt).

### 1:50 to 2:30 Graded practice and evidence

- **Actions**: click "Buat 5 soal latihan"; click "Kerjakan soal latihan"; "Mulai kuis"; answer five questions; "Kirim jawaban"; show "Hasilmu", "Hadiah" and one "Dasar soal ini" block; open `/my-learning/mastery` and point at the concept percentage and "2 dari 2 percobaan menaikkan penguasaanmu" (the number changes with the run).
- **Narration (about 95 words)**: "The companion can generate five practice questions. The server grades the answers; the answer key never reaches the browser, and a duplicate submission is rejected. The result is appended as an event, the concept estimate moves from fifty-three to fifty-nine percent, and the system records that this teaching strategy was followed by a gain. That is an observed change on a demo account, not proof that the strategy works." Replace the two percentages with the recording run values.
- **Evidence**: attempt `af74750b-3bea-49c9-851a-679f4cd092b5`, `LearningEvent` `b1afd555-18c6-4013-a7a1-10dbf52e6aa8`, `StrategyOutcome` `b71ca91a-3722-49d6-8d21-6d29608ef166` (mastery 0.5346 to 0.5913).
- **Fallback**: if quiz generation fails, use a quiz generated earlier (the link stays valid). The "Latihan" panel updates after a reload, so use the link in the chat reply.
- **Overlay text**: "Demo fixture accounts. Observed change, no control group."

### 2:30 to 3:10 Circular marketplace

- **Actions**: `/marketplace`; point at "Disarankan untukmu" and the sentence with the concept and mastery; open the class page; point at "Konsep yang dibahas"; click "Daftar gratis". Then a 8-second clip of the second learner's shelf ("Terbaru di marketplace.").
- **Narration (about 85 words)**: "Now the circular part. A creator tagged this class with the concept Debits and Credits, and an administrator approved the tag. Because this learner is working on that concept, the class appears as recommended for you, with the reason and the learner's mastery. Another learner with no matching need sees the same class labelled as a new arrival, not as personalised. The learner joins the free class in one click."
- **Evidence**: recommendation request `b1fff460-47c9-489b-9cf5-7a5509593bd6` (`personalized: true`), fallback request `f2df1038-3535-41d7-a339-44755cc9a794` (`personalized: false`), enrollment `4927c7d5-0b5a-4653-a439-63aa3bd1c366`.
- **Fallback**: if the shelf is empty, the tag was reset; check `ProductConceptLink` is `APPROVED` and the class `PUBLISHED`.

### 3:10 to 3:50 Creator path

- **Actions** (walked in a browser on 2026-10-17 15:07): `/admin/applications`, set the status select to "Disetujui" (the page opens on "Menunggu" and shows an empty state): the row "T1 Creator, Akuntansi dasar, DISETUJUI". `/admin/moderation`, press "Kelas", set status "Terbit": the row "Akuntansi Dasar untuk Pemula, T1 Creator, Gratis, TERBIT". `/admin/audit`: rows `CLASS_CREATED`, `CLASS_SUBMITTED`, `CLASS_APPROVED`, `TENANT_CREATED`, `CLASS_ENROLLED`; the action filter also offers "Teacher application approved" and "Peran pengguna diubah".
- **Narration (about 85 words)**: "Where does the creator come from? Only a learner who has passed every concept of a topic with a mean mastery of at least point eight five can apply. An administrator approves the application and then the class, and each step is written to an audit log. Paid orders, creator earnings and payouts are implemented and covered by integration tests, but this demo has no paid sale, so we do not show earnings."
- **Evidence**: application `1bc7392a-4be6-499b-9793-4ee2c3f3acc0`, tenant `85969dea-bb89-45a2-a875-a5507ea9a889`, class `bb6a6c14-968a-4c94-8f89-4ee799a8a973`.
- **Fallback**: if an admin page fails, show the same rows with the SQL of 02 section 4 in a terminal window, labelled as such.
- **Overlay text**: "Mastery of the creator fixture was written as a demo fixture."

### 3:50 to 4:30 Responsible prompt improvement

- **Actions**: `/admin/optimization`; show the table "Versi prompt tutor"; scroll to "Benchmark offline"; open the run `tutor-chat@4 melawan tutor-chat-builtin-3` (benchmark dataset, 2x); show "Hasil per dimensi", then "Kriteria gerbang dari benchmark", then the decision form "Keputusan kamu" without submitting.
- **Narration (about 100 words)**: "Finally, how the tutor's prompt changes. A candidate is only a draft. We compare it with the current prompt on a frozen set of fifty-six cases, with deterministic checks and a separate judge, per dimension, with intervals. The benchmark found a real defect: the old prompt copied its own example sentence as invented praise in seven percent of replies, and the new wording did so in none of two hundred thirty-two. On quality, no difference is proven yet, and the judge is not calibrated against human labels. A person decides; canary, rollback and kill switch stay available."
- **Evidence**: run `a61685cb-fee7-4944-8118-ca7a26b75c91`; copy rate 41 of 560 against 0 of 232 ([03](./03-evaluation-report.md) section 6); correctness +1.8 points [-3.6, +7.1], citation +3.6 [-1.8, +9.8], safety gate `FAIL` on TC-46.
- **Fallback**: if the page is slow, the data comes from the database; reload once. Never press "Setujui hasil ini", "Tolak hasil ini" or "Tunda" on camera: a decision belongs to the owner.
- **Overlay text**: "No human labels yet: judge not calibrated."

### 4:30 to 4:40 Close

- **On screen**: `/admin/metrics` for about 6 seconds (five cards, each "Belum cukup bukti" with its minimum and the dashed block "Akun demo (fixture), bukan hasil"), then the title card.
- **Narration (about 30 words)**: "Impact is measured with sample sizes, and today it honestly says: not enough evidence. From learner evidence to better teaching, from mastery to creator, and back to the next learner."
- **Evidence**: `GET /admin/metrics/circularity`, definition `circularity-v1`; no value on the page is a result. If a pilot with real learners has run by then, replace the first sentence with its `n`; otherwise say nothing about a pilot.

---

## 3. Recording setup

| Item | Setting |
|---|---|
| Capture | 1920 by 1080, browser zoom 100 percent, light theme, address bar visible, no bookmarks bar, devtools closed |
| Accounts | One learner account prepared as in 02 section 7; one admin account; a second learner for the 8-second fallback clip |
| Data | Do not reset the dev database after preparing the account. Re-read the rows of 02 section 4 after the take |
| Waits | Cut waits longer than 2 seconds with a visible "time-lapse" label; never speed up an interaction or edit a number |
| Sound | One take of narration per beat; subtitles in English for Indonesian labels |
| Privacy | No password, token, autofill popup or real person's e-mail on screen; the browser must not auto-fill credentials (it did in the test profile on 2026-10-17) |
| Upload | YouTube unlisted or public; open the link from a signed-out browser before submitting |

## 4. Pre-flight checklist

- [ ] `docker compose ps` shows all services healthy; `curl http://localhost/nginx-health` answers 200.
- [ ] `ai-api`, `celery-worker` and `celery-chat-worker` were recreated together after the last change.
- [ ] The gateway answers (one companion reply under 10 seconds).
- [ ] Shelf is `personalized: true` for the learner; class is `PUBLISHED`; tag `APPROVED`.
- [ ] The prompt shown in the admin table is `tutor-chat-builtin-4`.
- [ ] A fresh companion question is used; the old chats are not opened.
- [ ] Admin pages of beat 3:10 still show the rows above after the last change (set the status filters before the take).
- [ ] Total length under 5:00 on the exported file.

## 5. Statements the video must not make

| Statement | Reason |
|---|---|
| "Citations in chat are verified" | Retrieval works, but chat replies carry no citation markers and retrieval quality is not measured (CL-16) |
| "The strategy improves learning" | One fixture learner, no control group (CL-14) |
| "The prompt is better" | No dimension is proven different (03) |
| "Creators earn money" | 0 earnings on dev; the paid path is covered by specs only (CL-12) |
| "AI credits" | Not implemented (CL-13) |
| "Pilot results", "users", "retention" | None exist |

---

## Evidence citations

- Labels and ids: [02](./02-demo-flow-and-evidence.md) sections 3 and 4
- Benchmark figures: [03](./03-evaluation-report.md) sections 5 and 6
- Format limits: `https://developerday.id/`, fetched 2026-10-17
