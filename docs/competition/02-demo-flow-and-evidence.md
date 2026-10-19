# Demo Flow and Evidence

> **Status**: `in-progress` · **Owner**: `qa-lead` · **Last reviewed**: `2026-10-17`
>
> The accounts and fixtures behind the demo, the exact path with the screen labels, routes and rows it produces, and how each claim of [01](./01-winning-positioning.md) is proven.

Everything below ran on the Docker dev stack (`POSTGRES_PORT=5434 WEB_PORT=3001`, ten services healthy) through nginx at `http://localhost`. Times are UTC. Browser steps were run through the Playwright MCP on 2026-10-17 between 11:37 and 14:59 UTC. No screenshot or row id below comes from production, because no production exists.

---

## 1. Accounts and fixtures

Passwords are local throwaways kept outside the repository. Reset one with `api-tools pnpm seed:user` and the variables `SEED_USER_EMAIL`, `SEED_USER_NAME` and `SEED_USER_PASSWORD`.

| Account | Role | Used for | State on 2026-10-17 | Fixture |
|---|---|---|---|---|
| `demo.admin@reducera.local` | `ADMIN` | Moderation, prompt optimization page | n/a | Local admin created for the demo |
| `t1.creator@reducera.local` | `TEACHER` after approval | Author of the class "Akuntansi Dasar untuk Pemula" | 12 strong events on each of the 10 concepts of the course; eligibility mean 0.888, 10 of 10 passed; application `1bc7392a-4be6-499b-9793-4ee2c3f3acc0` approved; tenant `85969dea-bb89-45a2-a875-a5507ea9a889` | Mastery events are **demo fixtures** appended through `LearnerEventsService`; everything after them ran through the routes |
| `t1.learner@reducera.local` | `STUDENT` | Personalization: next need, review, strategy outcome, shelf | 8 strong events on `l1-t01-accounting-equation`, 2 weak on `l1-t02-debits-credits` (fixtures); then two graded quizzes on `l1-t02-debits-credits` through the product; mastery 0.5913 on 4 events | Part fixture, part real use |
| `t1.learner2@reducera.local` | `STUDENT` | Fallback shelf label; first-lesson path from a new enrollment | 2 weak events on `l1-t12-source-documents` (fixtures); enrolled in the course through the UI on 2026-10-17 14:54 | Part fixture |

Seeded content: the course "Akuntansi Dasar — Golden Graph" (topic `d552b0cf-6a50-495d-8470-9061b334f959`, 10 concepts, 13 approved curriculum links, slug `akuntansi-dasar-golden-graph`) and the published free class `bb6a6c14-968a-4c94-8f89-4ee799a8a973`, tagged `l1-t02-debits-credits` (tag `PROPOSED` by the author, `APPROVED` by the administrator). Seed commands: `api-tools pnpm seed:golden-graph`, `seed:concepts`, `seed:evaluation`.

The fixture script of T1 was a temporary file and was deleted. The mastery fixtures exist only as rows in the dev database, so the dev database must not be reset before the recording (section 7).

---

## 2. Dev-database snapshot (read-only, 2026-10-17 14:51 UTC)

| Table | Rows | Note |
|---|---|---|
| `User` | 10 | 3 are T1 fixtures |
| `Concept` | 83 | 10 belong to the demo course |
| `ConceptCurriculumLink` (`APPROVED`) | 13 | |
| `LearningEvent` | 134 | All 134 `ASSESSMENT_COMPLETED` events belong to the three fixture accounts |
| `ConceptMastery` | 13 | |
| `StrategyOutcome` | 2 | One per tutor prompt label: `tutor-chat-builtin-3`, `tutor-chat-builtin-4` |
| `ProductConceptLink` (`APPROVED`) | 1 | |
| `ClassEnrollment` | 1 | |
| `Order`, `CreatorEarning` | 0, 0 at 14:51 | At 14:54 a free-course enrollment created `Order` `e62516f6-660c-46e9-a9af-440f827b0844` (audit `ORDER_CREATED`, free). No paid order and no earning exist; the paid path is covered by scratch-database specs only (CP-06) |

The counts in the audit's evidence list (18 users, 17 events) were taken from an earlier state of the same database. Use this table for any number printed in the paper.

---

## 3. The demo path

Each step lists the screen, what the page text says on the stack, the API call behind it, and the row it leaves. Labels are quoted from the rendered page.

| # | Screen | What is on the page | API and rows | Claim | Verified |
|---|---|---|---|---|---|
| S1 | `/learn/profile/dashboard` as `t1.learner` | "Halo, T1"; card "Debits and Credits: Kamu sedang di tengah konsep ini, lanjutkan latihannya."; "Penguasaan konsep" with The Accounting Equation 85% and Debits and Credits 53% (59% after S9) | `GET /learner-model/me/next`, `/me/mastery` | CL-01 | Browser, 2026-10-17 11:37 |
| S2 | `/my-learning/mastery` | "Berikutnya: Debits and Credits", "CORE akan mengajarkannya dengan Contoh terpandu", "Ulasan berikutnya: Debits and Credits, 2 hari lagi", and the honest state "Kami masih mengumpulkan bukti. Cara paling cocok muncul setelah tiga percobaan dengan hasil baik." | `GET /learner-model/me/review`, `/me/strategy`; reason codes `MID_MASTERY`, `INSUFFICIENT_EVIDENCE` in the episode metadata | CL-03, CL-04 | Browser, 11:40 |
| S3 | `/learn/topics` as `t1.learner2` | "MULAI GRATIS" opens `/my-learning/topics/akuntansi-dasar-golden-graph` with 10 sections, only the first unlocked; modal "Kenali gaya belajarmu" with "SIMPAN GAYA BELAJAR" | `UserTopic` created; learning-style profile saved | CL-08 | Browser, 14:54 |
| S4 | `/my-learning/steps?lessonId=64ffe6a7-4677-4b13-91c6-cc5dd3761199` | Pipeline stages "Membaca langkah pelajaran", "Mencocokkan gaya belajarmu", "Mencari sumber pendukung", "Menulis pengantar: Menulis hanya dari sumber di atas. Setiap pernyataan diberi nomor sumber"; then an introduction with numbered references and the list "Sumber pengantar". With embeddings down (14:57, `t1.learner2`) the retrieval stage read "2 sumber dari materi course ditemukan. Pencarian berdasarkan arti sedang tidak aktif" and the list held 2 course records. With local embeddings (16:06, `t4.learner`) it read "2 sumber dari materi course dan 5 cuplikan dari 1 pencarian ditemukan", the page said "7 sumber ditemukan" and the list "4 sumber dikutip, 1 dari database course", one source labelled "Materi ReduCera · cocok makna" | Celery worker generation; sources are course records and retrieved outline chunks (`Topic ID l1-t01-accounting-equation`) | CL-08, CL-16 | Browser, 14:57 and 16:06 |
| S5 | Dialog "Kuis jalur belajar" | 5 scenario questions (multiple choice and free text), each with "Soal ini disusun dari" and its sources; after "KIRIM JAWABAN": "Jalur belajarmu siap. 7 langkah sudah disusun sesuai jawabanmu." | `UserStep` rows: 7 for `t1.learner2`. The path quiz writes **no** `LearningEvent` (checked: still the 2 fixture events) | CL-08 | Browser, 14:58 |
| S6 | Step page `/my-learning/steps/:userTopicId/:userStepId` | Reader with numbered references; panel "CORE" with "Buat 5 soal latihan", "Sederhanakan materi", "Tambah contoh" | Generated material of the step | CL-08 | Browser, 14:59 (`443419f8-cf46-4e35-8741-e1bed6d32d5e`) |
| S7 | Same page as `t1.learner`, message "Kenapa saldo normal akun kas itu debit? Aku masih sering terbalik." | A reply without invented praise, ending with a question | `Episode` `89b7b3f9-1e0a-4e53-a04b-5a2b4973fd20`: `tutor-chat-builtin-4`, `GUIDED_EXAMPLE`, `MID_MASTERY`, `teaching-policy-v2`, `microlearning-v1` | CL-03, CL-08, CL-11 | Dev stack, 10:51 (reply) and browser read-back, 11:38 |
| S8 | "Buat 5 soal latihan" then link "Kerjakan soal latihan" | "Soal latihannya sudah siap: 5 soal pilihan ganda … Nilainya ikut masuk ke penguasaanmu"; quiz page `/my-learning/quizzes/af0602bc-1ee6-4faf-aa22-d8b7edac1303`, "Siap mengerjakan?" | `Episode` `3e76cc65-6ede-43f5-9bc5-71112352fa37`, prompt `chat-action-quiz-1`, strategy `PRACTICE` | CL-02 | Browser, 11:39 |
| S9 | Quiz, "KIRIM JAWABAN" | "Hasilmu 80%", "4 dari 5 soal benar.", "Hadiah +6 XP", per question "benar" or "belum tepat" and "Dasar soal ini" with `Sub-topik: Debit dan Kredit`, `Konsep: Debits and Credits` | Attempt `af74750b-3bea-49c9-851a-679f4cd092b5`; `LearningEvent` `b1afd555-18c6-4013-a7a1-10dbf52e6aa8` (stream sequence 12, key `assessment:af74750b-…:l1-t02-debits-credits`, score 0.8); `ConceptMastery` 0.5346 to 0.5913 (4 events); `StrategyOutcome` `b71ca91a-3722-49d6-8d21-6d29608ef166` (`GUIDED_EXAMPLE`, `tutor-chat-builtin-4`, success) | CL-01, CL-02, CL-03 | Browser, 11:40 |
| S10 | `/my-learning/mastery` after the quiz | "Debits and Credits 59%", "Contoh terpandu 100%, 2 dari 2 percobaan menaikkan penguasaanmu", still "tiga percobaan" for the personal best strategy | Reads the projection; `rebuild` equals it (`demo-path.int.spec.ts`) | CL-01, CL-03 | Browser, 11:40 |
| S11 | `/marketplace` as `t1.learner` | "Disarankan untukmu": "Akuntansi Dasar untuk Pemula … Membahas "Debits and Credits", penguasaanmu baru 53%. Levelnya sedikit berbeda dari levelmu sekarang." (53% at the time of the read, before S9) | `GET /marketplace-discovery/recommendations`, `personalized: true`; request `b1fff460-47c9-489b-9cf5-7a5509593bd6` | CL-05 | Browser, 11:37 |
| S12 | Same page as `t1.learner2` | Same class labelled "Terbaru di marketplace.", `personalized: false` | request `f2df1038-3535-41d7-a339-44755cc9a794` | CL-05 | API, T1 run |
| S13 | `/marketplace/classes/bb6a6c14-968a-4c94-8f89-4ee799a8a973` | "Konsep yang dibahas: Debits and Credits"; "DAFTAR GRATIS" becomes "Kamu sudah terdaftar" and "Tonton rekaman" | `ClassEnrollment` `4927c7d5-0b5a-4653-a439-63aa3bd1c366` (`ACTIVE`), `Entitlement` | CL-05 | Browser, 11:37, zero console errors |
| S14 | Creator gate and moderation | Application approved, class created, submitted, approved | Request `7946b312-0222-40a8-8f01-545284914683` (approval); audit `TENANT_CREATED`, `USER_ROLE_CHANGED`, `CLASS_CREATED`, `CLASS_SUBMITTED`, `CLASS_APPROVED`; `POST /admin/classes/:id/approve` | CL-06, CL-07 | API, T1 run; browser 15:07: `/admin/applications` (filter "Disetujui" lists T1 Creator, "DISETUJUI"), `/admin/moderation` (switch "Kelas", status "Terbit" lists the class, "TERBIT"), `/admin/audit` lists `CLASS_CREATED`, `CLASS_SESSION_ADDED`, `CLASS_SUBMITTED`, `CLASS_APPROVED`, `TENANT_CREATED`, `CLASS_ENROLLED` |
| S15 | `/admin/optimization` as `demo.admin` | Table "Versi prompt tutor" (`tutor-chat-builtin-4` as the built-in, drafts `@1` `@3` `@4` "DITOLAK", `@2` "DRAF"); panel "Benchmark offline"; run list with "MENUNGGU KEPUTUSAN"; run detail with "Hasil per dimensi" and "Kriteria gerbang dari benchmark" | `GET /admin/optimization/benchmarks`, `/:id` | CL-09, CL-10, CL-11 | Browser, 11:41 |
| S16 | `/admin/metrics` as `demo.admin` | Five cards in a fixed order: "Perubahan penguasaan setelah kegiatan bernilai", "Hasil ulasan terjadwal", "Pemakaian ulang pengetahuan", "Konversi pelajar ke kreator", "Bukti perbaikan prompt", each "BELUM CUKUP BUKTI" with the organic evidence against its minimum (for example "Kejadian penilaian organik 0 dari 30"), a dashed block "Akun demo (fixture), bukan hasil" (134 rows from 3 accounts, mean +0,032, 97,0% above zero), and a closed section "Rumus, sumber, dan batasan"; the window select offers 30, 90 and 365 days | `GET /admin/metrics/circularity`; learner 403, anonymous 401, bad window 422 | CL-15 | Browser at 375, 768 and 1280 px, light and dark, reduced motion, zero console errors, 16:03 |

Run `a61685cb-fee7-4944-8118-ca7a26b75c91` on the detail page shows six dimensions, each "BEDA BELUM TERBUKTI", gate criteria "LOLOS" (correctness, citation), "GAGAL" (safety, one case TC-46), "DATA KURANG" (pedagogy judge) and "BELUM TERUKUR" (judge calibration), and the decision form "Setujui hasil ini", "Tolak hasil ini", "Tunda". Numbers and limits are in [03](./03-evaluation-report.md).

---

## 4. How each claim is proven

| Claim | Executable proof | Live proof | Reproduce |
|---|---|---|---|
| CL-01 | `quiz-evidence.int.spec.ts`, `demo-path.int.spec.ts` (rebuild equals projection) | S9, S10 | `api-tools pnpm jest src/v1/__tests__/demo-path.int.spec.ts` |
| CL-02 | `answers.security.spec.ts`, answer-key specs, `demo-path.int.spec.ts` (duplicate submit rejected, idempotent replay) | S8, S9; T1: second submit of attempt `f89afa0c-ca33-4af7-b3e4-923609ff1dca` answered 409 (request `984cb1cd-…`) | same |
| CL-03 | `strategy-outcome.int.spec.ts` | S9; T1 row `1af3c5f8-838b-4c9c-9718-d6d970ae22a9` (`tutor-chat-builtin-3`, delta +0.135) | SQL below |
| CL-04 | review specs | S2, S10; T1: due `RELEARN` with retrievability 0.329 before, upcoming in 1.6 days after | `GET /learner-model/me/review` |
| CL-05 | `marketplace-discovery.service.spec.ts`, `demo-path.int.spec.ts` | S11, S12, S13 | same |
| CL-06, CL-07 | `applications.security.spec.ts`, class moderation specs, `demo-path.int.spec.ts` | S14 | same |
| CL-08 | `v1/learning/__tests__` (pytest) | S4, S6, S7 (reply); chat worker log `[RETRIEVE] ... returned=10` | `ai-tools pytest -q v1/learning` |
| CL-09 to CL-11 | `v1/benchmark/__tests__`, `benchmark-run.int.spec.ts`, `acceptance-gate.spec.ts`, `prompt-registry.int.spec.ts` | S15 | [03](./03-evaluation-report.md) section 9 |

Read-only SQL for the learner rows (replace the e-mail):

```sql
select "conceptId", "streamSeq", payload->>'score' as score, "occurredAt", "idempotencyKey"
from "LearningEvent" where "userId" = (select id from "User" where email = 't1.learner@reducera.local')
order by "streamSeq" desc limit 4;

select id, strategy, "promptVersion", round("scoreBefore"::numeric, 4) as before,
       round("scoreAfter"::numeric, 4) as after, success
from "StrategyOutcome" order by "createdAt";
```

---

## 5. Observed numbers of the runs

| Quantity | Value | Source |
|---|---|---|
| Mastery of `l1-t02-debits-credits`, first fixture state | 0.3995 after 2 weak events | T1 |
| After the first graded quiz (score 100) | 0.5346, 3 events | T1, `LearningEvent` `5037e699-3c8b-4f2d-877d-3e80e8a8d654` |
| After the second graded quiz (4 of 5, score 0.8) | 0.5913, 4 events | S9 |
| Companion reply time | 6.5 s (T1 turn) | T1 |
| Strategy outcomes | 2 rows, both `GUIDED_EXAMPLE`, both success; no control arm | S9, T1 |

Both quizzes belong to a fixture learner. They show that the pipeline records and recomputes. They are not evidence that the strategy works (CL-14).

---

## 6. Known gaps and rough edges

| Item | Effect on the demo | Handling |
|---|---|---|
| Chat replies carry no citation markers although retrieval returns 10 chunks (Episode `retrievedChunks` is `{"citations": []}`) | The indexed outline chunks have no lesson id, which the citation list requires, and the model did not cite | Show the lesson introduction (S4) as the citation example; never claim retrieval quality; index lesson-bound material to change it |
| Hugging Face embeddings answer HTTP 402 (CP-10) | None while `EMBEDDING_PROVIDER=local` ([ADR-030](../decisions/ADR-030-local-embedding-provider.md)); the model directory `./models/bge-m3` must exist on the host | Keep the provider setting and the directory with the recording stack |
| The fixture steps `4484935f-fde2-401b-9046-7ab78dc4bccb` and `26d4ccb9-07b8-4727-93a6-40f829043960` have no generated material ("Materi untuk langkah ini sedang disiapkan") | Looks unfinished on video | Do not record on them (section 7) |
| The chat of step `4484935f-…` still shows a reply of the old prompt: "Tadi kamu sudah benar menaruh kas di debit, jangan ragu lagi!" | Shows the defect that CL-11 fixed | Do not record on it |
| The "Latihan" panel says "Belum ada soal latihan" until the page is reloaded after "Buat 5 soal latihan" | A viewer may think generation failed | Use the link in the chat reply, or reload |
| Practice items are generated by the model and not reviewed; item 4 of the S9 quiz ("Transaksi apa yang akan menyebabkan saldo akun 'Beban Gaji' bertambah di sisi debit?") has two defensible options | Quiz item quality is not measured by the benchmark | State it in the paper's limitations |
| The path quiz is harder than the first lesson (a trial-balance adjustment after "Apa itu akuntansi") and writes no mastery evidence | A learner may feel misplaced | Describe it as steering, not as mastery evidence |
| `t1.learner` has a `UserTopic` inserted as `IN_PROGRESS`, so the learning-style form (opened for `NOT_STARTED`) is unreachable for it | Its steps cannot get generated material | Use a recording account created through the UI |
| Gate rule text in the admin table is English inside an Indonesian page | Cosmetic | Known, left as is |

---

## 7. Recording readiness

The recording is **not ready**: the two verified accounts split the story. `t1.learner` has the mastery history that makes the shelf personalized but no generated material; `t1.learner2` has generated material but no history on `l1-t02-debits-credits`.

Recipe for the recording account (open work, owner or next session):

1. Create the account through the register page, enrol in the course (S3), save the learning style, open the lesson "Debit dan Kredit" so that material and the step path are generated (S4 to S6).
2. Append the mastery history on `l1-t01-accounting-equation` and `l1-t02-debits-credits` with the same method as T1 (`LearnerEventsService`, labelled demo fixtures). A committed seed script would make this repeatable and is the recommended next change.
3. Check that the class `bb6a6c14-…` is still `PUBLISHED` with the tag `APPROVED` and that the shelf says `personalized: true` for the account.
4. Ask a new question in the companion with the current prompt and run the generated quiz once. Do not use the chats listed in section 6.
5. Record once without cuts, then re-read the rows of section 4 for that run and write their ids into [06](./06-five-minute-demo-script.md).

---

## 8. Not verified in this session

- Light and dark themes and 375 and 768 px widths for the steps S3 to S6 and S15 (T1 covered S1, S2, S11, S13 and the lesson page; S15 was verified at 1280 px in RC-33).
- Paid purchase, creator earning and payout on the dev stack (CP-06).
- Any run with a real learner.

---

## Evidence citations

- Row ids: dev database, read-only queries on 2026-10-17 (section 2); `LearningEvent`, `ConceptMastery`, `StrategyOutcome`, `Episode`, `ClassEnrollment`. Every row id in docs 01 to 07 was checked against the database on 2026-10-17 and exists
- Request ids (`7946b312-…`, `b1fff460-…`, `f2df1038-…`, `984cb1cd-…`) come from response headers noted during the T1 run. They are not stored in the database and the API log of that period was discarded when the container was recreated, so they cannot be re-checked now; the rows those requests produced can
- T1 record: [`00-current-state-audit.md`](./00-current-state-audit.md#t1-one-demo-path-proven-live-and-under-a-regression-spec)
- Regression spec: `services/api/src/v1/__tests__/demo-path.int.spec.ts`
- Mastery rule: `services/api/src/v1/learner-model/mastery/mastery-v1.ts`; review rule: `.../review/review-schedule.ts`
- Screens: `apps/web/app/pages/marketplace`, `.../my-learning`, `.../admin/optimization.vue`
- Screenshots: `.playwright-mcp/t1-*.png`, `.playwright-mcp/t5-dashboard-1280-light.png` (git-ignored)
