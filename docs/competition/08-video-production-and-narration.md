# Competition Video: Production Record and Narration Script

> **Status**: `in-progress` · **Owner**: `qa-lead` · **Last reviewed**: `2026-10-18`
>
> What the 3:35 motion video (rendered, waiting for voice-over and upload) shows, the English text the owner reads over it, the accounts and fixtures behind every screen, the music licence, and what is still waiting for the owner.

The video is built with the `xn-motion` tool from real captures of the Docker dev stack taken on 2026-10-18. It has no voice. A low music bed is mixed in so the owner can lay the English voice-over on top. [06](./06-five-minute-demo-script.md) stays the plan for a longer live recording; this document is the plan for the motion cut.

---

## 1. Scope

| Item | Value |
|---|---|
| Format | 1920 by 1080, 30 fps, 16:9, H.264 |
| Length | 6465 frames, 3:35.5 (limit of the organizer: 5:00) |
| Scenes | 24, each a real capture, a title, a statement, a feature card, a diagram or the closing card |
| Voice | None. Narration text is in section 4 |
| Music | One track, section 6 |
| Language on screen | English headlines and callouts; the app interface stays Indonesian (it is the product) |
| Address bar of each scene | `localhost` plus the demo account and screen name, so no scene passes for production |
| XN-Motion project | `reducera-competition-demo-b516f` (data under `~/.local/share/xn-motion/projects/`) |
| Files | `~/Videos/reducera-competition-demo.mp4` (48.5 MB, with music bed) and `~/Videos/reducera-competition-demo-no-audio.mp4` (39.8 MB, the same video stream copied without audio), both outside the repository at the owner's request; `videos/audio/Inspired-Kevin-MacLeod.mp3` stays in the repository |
| Final render | Done 2026-10-18. The owner approved storyboard `975bb0962a7f` through the XN-Motion CLI (`appr-ca8b56806357`, decided via `cli`). Job `job-6dd324c1d88c`: 6465 frames at 1920 by 1080, crf 18, concurrency 8, 1545.7 s. SHA-256 of the render `a26c008544badf5815422aeb4a8a4f74e95991ef226a3cd1b51d49bb434406c1` |
| Checks on the render | `media_validate` pass (h264, 30 fps, 6465 frames, 215.509 s, AAC 48 kHz stereo, whole file decodes); `qa_run` `automated_checks_passed` (22 passed, 2 licence warnings, 0 errors); frames of all 24 scenes viewed (section 8, V-08) |
| Music level in the render | About -28 dBFS RMS, fade-in over the first second, fade-out from 212.5 s to the end (-49 dBFS in the last second) |

The six themes the owner asked for map to scenes as follows.

| Theme | Scenes | What is on screen |
|---|---|---|
| Dynamic learning | 5, 6, 13 | learning-style form, live lesson generation, the tutor strategy that changed after evidence |
| Microlearning | 8, 9 | ten short steps for one lesson, five-question practice, due review |
| Gamification | 10, 11, 12, 14 | streak 1 to 2, XP 9 to 17, rewards paid only for graded work, rules stored as versioned data |
| Personalization | 5, 12, 15, 16 | learning style, next concept, a theme generated for one learner, a shelf matched to a weak concept |
| Self-improving (human-governed) | 20, 21 | AI draft proposals, frozen 56-case benchmark, human decision, rollback and kill switch |
| Circular economy | 16, 17, 18, 19, 22 | concept-matched class, honest fallback label, learner to creator application, moderation, impact metrics |

The circular economy is digital: knowledge reuse and creator value. No claim is made about physical waste or carbon ([01](./01-winning-positioning.md) section 1).

---

## 2. Scene table

Times are the visible window of each scene: from its start to the start of the next one. A scene crossfades into the next for 0.5 s.

| # | Time | Scene | Screen and account | Claim | Words | Words per second |
|---|---|---|---|---|---|---|
| 1 | 0:00.0 to 0:06.5 | Hook | title card | none | 13 | 2.0 |
| 2 | 0:06.5 to 0:15.0 | Problem | statement card | none (framing, no data) | 19 | 2.2 |
| 3 | 0:15.0 to 0:28.5 | Six ideas | feature card | summary of CL-01 to CL-11 | 26 | 1.9 |
| 4 | 0:28.5 to 0:36.0 | Landing | `/`, public | none | 17 | 2.3 |
| 5 | 0:36.0 to 0:44.5 | Learning style | course dialog, Demo learner D | CL-08 | 18 | 2.1 |
| 6 | 0:44.5 to 0:53.0 | Lesson generation | live pipeline, Demo learner D | CL-08 | 18 | 2.1 |
| 7 | 0:53.0 to 1:03.5 | Introduction | numbered sources, Demo learner D | CL-08, CL-16 | 20 | 1.9 |
| 8 | 1:03.5 to 1:13.0 | Micro steps | learning path, Demo learner D | none (read from the screen) | 19 | 2.0 |
| 9 | 1:13.0 to 1:23.5 | Companion | CORE reply, Demo learner D | CL-08 | 23 | 2.2 |
| 10 | 1:23.5 to 1:29.0 | Quiz before | quiz question, Demo learner A | CL-02 | 11 | 2.0 |
| 11 | 1:29.0 to 1:38.5 | Result | quiz result, Demo learner A | CL-01, CL-02 | 21 | 2.2 |
| 12 | 1:38.5 to 1:48.0 | Dashboard | dashboard after, Demo learner A | CL-01 | 21 | 2.2 |
| 13 | 1:48.0 to 1:59.5 | Strategy | mastery page, Demo learner A | CL-03 | 23 | 2.0 |
| 14 | 1:59.5 to 2:07.0 | Reward rules | `/admin/gamify`, admin | none (rules are data) | 14 | 1.9 |
| 15 | 2:07.0 to 2:15.5 | Personal theme | dashboard, Demo learner D | none (feature of ADR-027) | 15 | 1.8 |
| 16 | 2:15.5 to 2:26.0 | Shelf | marketplace, Demo learner C | CL-05 | 24 | 2.3 |
| 17 | 2:26.0 to 2:32.5 | Fallback | marketplace, Demo learner D | CL-05 | 14 | 2.2 |
| 18 | 2:32.5 to 2:41.0 | Creator applications | `/admin/applications`, admin | CL-06 | 20 | 2.4 |
| 19 | 2:41.0 to 2:47.5 | Moderation | `/admin/moderation`, admin | CL-07 | 15 | 2.3 |
| 20 | 2:47.5 to 2:57.0 | Prompt governance | `/admin/optimization`, admin | CL-10 | 21 | 2.2 |
| 21 | 2:57.0 to 3:08.5 | Benchmark | run detail, admin | CL-09, CL-11 | 24 | 2.1 |
| 22 | 3:08.5 to 3:16.0 | Impact metrics | `/admin/metrics`, admin | CL-15 | 14 | 1.9 |
| 23 | 3:16.0 to 3:26.5 | Architecture | diagram | ownership rule of `AGENTS.md` | 23 | 2.2 |
| 24 | 3:26.5 to 3:35.5 | Close | closing card | none | 20 | 2.2 |

Total 453 words, 2.1 words per second, about 126 words per minute: a calm pace that leaves room for pauses at scene changes.

---

## 3. Delivery

| Point | Instruction |
|---|---|
| Tone | Professional and friendly: a colleague walking a judge through a product they are proud of, not an announcer |
| Pace | About 125 words per minute; breathe at each scene change; do not rush scenes 12, 13 and 16, which carry numbers |
| Numbers | Say them as written in section 4; do not round or add figures |
| Honesty lines | Read the lines marked **(limit)** in full: they are part of the pitch, not a footnote |
| Recording | 48 kHz, mono or stereo, one take per scene, target about -16 LUFS on the voice; the music bed sits near -27 LUFS |
| Names | "ReduCera" is read "reh-doo-CHEH-rah"; "CORE" is read as a word; "XP" as two letters |

---

## 4. Narration script (English)

Read each block inside its time window. Words in brackets are stage directions, not text.

**1 · 0:00 to 0:06**
ReduCera turns learner evidence into better teaching, and mastery into content for others.

**2 · 0:06 to 0:15**
Feedback comes late, and a student who masters a topic has no path to teach. ReduCera closes that loop.

**3 · 0:15 to 0:28** [one beat after each idea]
Six ideas drive it. Dynamic learning. Microlearning. Gamification that pays only for graded work. Personalization. Self-improvement that a human governs. And a circular economy of knowledge.

**4 · 0:28 to 0:36**
This is the real product on a local stack. Its promise: level up from understanding, not clicks.

**5 · 0:36 to 0:44**
A new learner enrols and tells the system how they study: four style scores and a short note.

**6 · 0:44 to 0:53**
Then the lesson is written live. The system reads the step, matches the style, and searches for sources.

**7 · 0:53 to 1:03**
Every statement carries a source number. Six sources are cited: one from the course database, and five found by meaning.

**8 · 1:03 to 1:13**
The lesson becomes a path of small steps: one short task each, unlocked in order. Practice is five questions.

**9 · 1:13 to 1:23**
When something is unclear, the learner asks CORE. The reply is built from the learner's state and strategy, both stored with the turn.

**10 · 1:23 to 1:29**
Now gamification. This learner starts at streak one and nine XP.

**11 · 1:29 to 1:38**
The server grades the quiz, and the answer key never reaches the browser. One hundred percent: streak two, plus eight XP.

**12 · 1:38 to 1:48**
Logins and chat never add XP. The dashboard shows seventeen XP, and Debits and Credits moved from fifty-nine to sixty-seven percent.

**13 · 1:48 to 1:59** **(limit)**
Mastery changed the strategy: from guided examples with shared work to guided questions and independent thinking. Observed on a demo account, not proof.

**14 · 1:59 to 2:07**
Reward rules are versioned data. Every edit is audited, and past rewards never change.

**15 · 2:07 to 2:15**
Personalization reaches the colours too: two moods generated a palette for this learner's account only.

**16 · 2:15 to 2:26** **(limit)**
Now the circular part. A creator tagged this class with Debits and Credits. This learner is weak there, thirty-seven percent, so it is recommended. [The history is seeded; the on-screen label says so.]

**17 · 2:26 to 2:32**
With no matching need, the same class is labelled a new arrival, not personalised.

**18 · 2:32 to 2:41**
Where do creators come from? A learner who passed every concept of a topic can apply, and an administrator approves.

**19 · 2:41 to 2:47**
Each class is moderated before it is published, and its concept tags are approved too.

**20 · 2:47 to 2:57**
Self-improvement, governed by humans. The AI can only draft a change; a person approves it. Rollback and a kill switch exist.

**21 · 2:57 to 3:08** **(limit)**
Drafts run on a frozen set of fifty-six cases, with intervals. The honest result: no difference proven yet, and the judge is not calibrated.

**22 · 3:08 to 3:16** **(limit)**
Impact is measured with sample sizes. Today the page honestly says: not enough evidence.

**23 · 3:16 to 3:26**
Under the hood, a strict split: only the API touches the database; the AI API owns models and vectors, called with signed requests.

**24 · 3:26 to 3:35** **(limit)**
Evidence in, better teaching out, knowledge back to the next learner. Demo accounts only; we state what is not proven.

---

## 5. Mixing the voice over the video

The music bed is already low, so the voice can go straight on top.

```bash
ffmpeg -i ~/Videos/reducera-competition-demo.mp4 -i narration.wav \
  -filter_complex "[0:a][1:a]amix=inputs=2:duration=first:normalize=0[a]" \
  -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 192k ~/Videos/reducera-competition-demo-narrated.mp4
```

`ffmpeg` here is a media tool outside the repository toolchain, like XN-Motion itself, so it runs on the host; no project command (`pnpm`, `node`, `python`) is involved. For a version without music, use `~/Videos/reducera-competition-demo-no-audio.mp4` as the first input and map the narration directly (`-map 0:v -map 1:a`).

If the voice runs longer than a scene, shorten a sentence rather than speed up; the on-screen text and callouts are timed to the scenes.

Upload notes for YouTube (public or unlisted, at most 5:00): put the music credit of section 6 in the description, paste the plain text of section 4 as the transcript for caption sync in YouTube Studio, and open the link from a signed-out browser before submitting ([07](./07-submission-checklist.md) section 7).

---

## 6. Music and licence

| Item | Value |
|---|---|
| Track | "Inspired" by Kevin MacLeod |
| Source | `https://incompetech.com/music/royalty-free/mp3-royaltyfree/Inspired.mp3`, downloaded 2026-10-18 |
| Catalog entry | ISRC `USUAN1600022`, 4:46, 120 bpm, feel "Bright, Relaxed, Calming, Uplifting", guitar, synths, percussion |
| Why this track | Even dynamics (loudness range 2.0 LU, integrated -12.8 LUFS), a steady pulse and no vocals, so a voice sits clearly over it; the mood is professional and warm |
| Level in the video | 20 percent of full scale, with a 1 s fade in and a 3 s fade out |
| Licence | Creative Commons Attribution 4.0 (CC BY 4.0). The Incompetech FAQ states that all music is offered under it and gives the credit format below. Attribution is required |
| Local copy | `videos/audio/Inspired-Kevin-MacLeod.mp3` (9.2 MB) so the owner can remix |

Credit line for the YouTube description and the paper:

```text
Music: "Inspired" Kevin MacLeod (incompetech.com)
Licensed under Creative Commons: By Attribution 4.0 License
https://creativecommons.org/licenses/by/4.0/
```

Songs from YouTube were not used: the video is uploaded to YouTube, and a commercial song there can trigger a copyright claim on the entry. If the owner wants a specific song, supply the file and its licence and the track can be swapped in the storyboard (`audio` list) without touching the scenes. Other tracks of the same catalog that fit: "On My Way" (4:13, friendly, vibraphone), "Crinoline Dreams" (4:06, piano and strings), "Life of Riley" (3:55, ukulele, lighter).

---

## 7. Accounts and fixtures

Every screen is a capture of the Docker dev stack, `http://localhost`, on 2026-10-18 between 03:30 and 04:20 local time. The throwaway password lives only in the session scratchpad; reset with `api-tools pnpm seed:user` and the variables `SEED_USER_EMAIL`, `SEED_USER_NAME` and `SEED_USER_PASSWORD`.

| Account | Name on screen | Role | State used in the video | Real or seeded |
|---|---|---|---|---|
| `t1.learner@reducera.local` | Demo Learner A | `STUDENT` | Mastery history on two concepts from the T1 run; one new graded quiz taken for the video (5 of 5): streak 1 to 2, XP 9 to 17, Debits and Credits 59% to 67%, strategy "Contoh terpandu" 3 of 3 | History seeded (T1 fixtures); the quiz and the rewards are real |
| `demo.learner@reducera.local` | Demo Learner C | `STUDENT` | Eight strong events on `l1-t01-accounting-equation` and two weak on `l1-t02-debits-credits`, appended through `LearnerEventsService`; shelf shows the class at 37%; enrolled in the class live | History seeded; recommendation and enrolment are real |
| `demo.learner2@reducera.local` | Demo Learner D | `STUDENT` | New enrolment in "Akuntansi Dasar — Golden Graph": learning style, live lesson generation, ten micro steps, one CORE question, one generated quiz, personal theme (moods Tenang and Analitis) | All real; no mastery history |
| `demo.admin@reducera.local` | Demo Admin | `ADMIN` | Applications, moderation, audit, optimization, benchmark, metrics, gamification rules | Real pages; creator and class rows come from T1 |
| `t1.learner2@reducera.local` | Demo Learner B | `STUDENT` | Renamed, password reset, not used on screen | n/a |

The temporary seed scripts under `services/api/prisma/tmp-*` were deleted after use. Names of A, B, C and D were changed from "T1 Learner", "T1 Learner Dua", "Demo Learner" and "Demo Learner 2" to make the screens readable.

Dev residue left by this work: three password resets and one admin reset; ten mastery events for C; an `Order` and a class enrolment for D and C; a saved theme for D; ten generated `UserStep` rows and one chat plus one quiz for D; one quiz attempt, one `LearningEvent` and one `StrategyOutcome` for A. None of it is used as a result in the paper ([04](./04-impact-and-circularity-metrics.md) counts `@reducera.local` accounts apart).

---

## 8. Findings from the capture session

| ID | Sev | Finding | Effect on the video | Status |
|---|---|---|---|---|
| V-01 | Medium | A practice quiz on the first lesson "Apa itu akuntansi" scored 100% for Demo Learner D and wrote no evidence: XP stayed 0, no streak, no mastery row. The lesson has no `APPROVED` concept link (CP-08 family) | Gamification is shown on Demo Learner A, whose lesson is concept-linked | Open, content |
| V-02 | Low | The first path-quiz generation for D failed closed ("10 question(s) without a real source were dropped"); the in-app retry worked | None; scene 6 shows the pipeline, not the retry | Noted |
| V-03 | Medium | A learner who is enrolled in a class no longer sees it on "Disarankan untukmu", so `t1.learner` shows an empty shelf and step S11 of [02](./02-demo-flow-and-evidence.md) no longer reproduces for that account | The shelf is shown on Demo Learner C, who was not enrolled | Open, docs |
| V-04 | Low | `readme.md` still says "SMK Akuntansi students" while [ADR-012](../decisions/ADR-012-launch-segment.md) fixes university students first | Tagline of the README was not used | Open, docs |
| V-05 | Low | The learning-path page clips two step labels ("Cocokkan 5 istilah akuntan... (ka flash)", "engkapi kuis 5 pertanyaan") | Scene 8 stops at the first steps | Open, web |
| V-06 | Low | `XN-Motion` records every feature that was added through the brief as `marketing_claim` with `userConfirmed: true` ("Provided by the user"). The statements come from the claims table of [01](./01-winning-positioning.md), not from the owner's words | The ledger of the production report must be read with this note; the owner confirms the statements by approving the storyboard | Open, owner |
| V-07 | Low | The app's own music files `apps/web/public/sounds/*.mp3` carry no licence note anywhere in the repository | Not used in the video | Open, owner |
| V-08 | Low | Seen on the rendered frames: the closing headline "Evidence in. Better teaching out." breaks so that "out." stands alone on the second line; the headline of scene 22 and the top row of the table in scene 21 are partly cut by the top edge of the capture window while it scrolls | Cosmetic. Changing it means a new storyboard, a new approval and a new 26-minute render, so it was left | Open, owner decides |
| V-09 | Low | The XN-Motion production report lists 8 of the 14 brief features as "Left out" (mastery, server-side grading, scheduled review, source-grounded lessons, companion, mastery-gated creators, frozen benchmark, impact metrics) because only six are linked to scene 3. Scenes 6 to 13 and 18 to 22 do show them | The ledger understates what the video shows; the claim wording follows section 9, not the report | Noted |
| V-10 | Low | A final render must cover the whole video, and the server stops a render after 30 minutes (`XN_MOTION_RENDER_TIMEOUT_MS`). This render finished in 25.8 minutes at concurrency 8, on a machine with 8 cores | A second render of the same video on a busier machine can time out | Noted |

Checks run before the capture: ownership script `PASS`, ten services healthy (`docker compose ps`), `http://localhost/nginx-health` 200.

---

## 9. Claims audit

Every sentence of the narration maps to a claim of [01](./01-winning-positioning.md) with state `VERIFIED_E2E` or `VERIFIED_COMPONENT`, or is framing without a number. Statements the video must not make stay the list of [06](./06-five-minute-demo-script.md) section 5.

| Check | Result |
|---|---|
| No learner count, retention, conversion, revenue or market size | Pass |
| Fixture numbers labelled | Pass: callouts "seeded history" and "Creator mastery was seeded"; address bars name the demo account |
| "Observed change, no control group" kept for CL-03 | Pass: scene 13 and the closing card |
| Benchmark reported with intervals, missing calibration and no proven difference | Pass: scene 21 headline and narration |
| Chat citations not claimed | Pass: scene 9 claims state and strategy only; scene 7 claims numbered sources of the lesson introduction |
| Paid creator earnings and AI credits not claimed | Pass: not mentioned |
| `.id` domain sentence | Not written: no `.id` host serves the product ([07](./07-submission-checklist.md) section 2); the address bar says `localhost` |
| Words kept out ("first", "fully autonomous", "scientifically proven") | Pass; "self-improvement" always appears with "governed by humans" |

---

## 10. Open items for the owner

| # | Item | Why |
|---|---|---|
| 1 | Watch the whole render once (`~/Videos/reducera-competition-demo.mp4`) | The storyboard is approved; the production report still lists human visual review as required, and only still frames of every scene were viewed so far |
| 2 | Confirm that the screen captures are the team's own ("owned") | The asset ledger shows `unknown` until the owner says so; the report marks the video "not ready to publish" for this reason alone |
| 3 | Confirm the 14 feature statements of the brief (V-06) | They were written from [01](./01-winning-positioning.md), not by the owner |
| 4 | Accept the music track and its attribution, or supply another file and licence | CC BY 4.0 requires the credit line |
| 5 | Decide whether to commit `videos/audio/` (a 9.2 MB MP3); the MP4s now live in `~/Videos/` | Git writes are the owner's; large binaries may belong in an external store |
| 6 | Record the voice, mix, upload, and re-run the pre-flight list of [06](./06-five-minute-demo-script.md) section 4 | The video is not the submission; the paper link and the `.id` question stay open |

---

## Evidence citations

- Claim states and wording limits: [`01-winning-positioning.md`](./01-winning-positioning.md) sections 4 and 6; [`06-five-minute-demo-script.md`](./06-five-minute-demo-script.md) section 5
- Screens and rows: live captures `.playwright-mcp/vid-*.png` (git-ignored) of 2026-10-18; asset ledger in the XN-Motion project (`assets/` and `assets.json`)
- Streak and XP rules shown on screen: pages `/learn/streaks` ("Login atau mengobrol tidak menambah streak") and `/admin/gamify` ("tidak mengubah hadiah yang sudah dibayar"); [ADR-026](../decisions/ADR-026-gamify-rules-administered-as-data.md), [ADR-028](../decisions/ADR-028-reward-and-streak-decisions-accepted.md)
- Per-learner theme: [ADR-027](../decisions/ADR-027-per-user-generated-theme.md); local embedding provider: [ADR-030](../decisions/ADR-030-local-embedding-provider.md)
- Benchmark run on screen: run "tutor-chat@4 melawan tutor-chat-builtin-3", benchmark set `sha256 9879bbc505ed`, started 2026-10-17 17:40; numbers in [03](./03-evaluation-report.md)
- Ownership split: `scripts/check-ownership-rules.sh` (PASS on 2026-10-18), `AGENTS.md` section "Service ownership"
- Music licence: `https://incompetech.com/music/royalty-free/faq.html`, read 2026-10-18; catalog `https://incompetech.com/music/royalty-free/pieces.json`, entry "Inspired"
- Competition rules: `https://developerday.id/`, fetched 2026-10-17 (video at most 5 minutes, YouTube)
