# Submission Checklist (.id DeveloperDay 2026)

> **Status**: `in-progress` · **Owner**: `team-lead` · **Last reviewed**: `2026-10-17`
>
> The official rules as read from the organizer's page, the `.id` domain condition and its gap, and the checklist from category and team to the final build, with an owner and a state on every line.

Markers follow the style guide: `[ ]` not started, `[~]` in progress, `[x]` complete, `[!]` blocked. The deadline on the page is **25 October 2026** (eight days after this review).

---

## 1. Official rules (read from `https://developerday.id/` on 2026-10-17)

| Topic | What the page says | Note |
|---|---|---|
| Registration and paper period | "14 Agustus – 25 Oktober 2026 (diperpanjang)"; "Pendaftaran dan Submit Paper diperpanjang hingga 25 Oktober 2026" | Re-read the page on 24 October for a further change |
| Team | "Setiap tim beranggotakan maksimal 3 orang termasuk ketua tim." | Three people including the leader |
| Category | "tim memilih 1 kategori utama dan 1 subkategori yang paling relevan"; a participant "boleh mendaftar di lebih dari 1 kategori" with a separate team registration per category | The Student track lists no subcategories on the page: ask the organizer |
| Fee | "Biaya pendaftaran sebesar IDR 100.000 per tim." | Per registration |
| `.id` domain | "Seluruh produk wajib menggunakan domain .id — baik sebagai situs utama, landing page, situs organisasi, maupun subdomain resmi." Heading: "Kewajiban domain .id: Syarat teknis yang menentukan keabsahan karya" | Section 2 |
| Maturity | Under "Kesiapan minimal saat batas akhir submission" the page lists Prototype, Minimum Viable Product (MVP), Working Product, Pilot Implementation, Early Market Implementation | The page does not say which level is the required minimum: ask |
| Accepted formats | Web Application, Mobile Application, Desktop Application, Artificial Intelligence System, Enterprise System, Software Platform, Platform Digital, Cloud-based System, Hardware / IoT, Embedded System | ReduCera is a web application and an AI system |
| Files per team | The registration form filled at developerday.id; team or participant profile; description of the digital solution; paper or proposal; demo video (recommended); application or prototype link | |
| Paper | English; PDF sent as a link; at most 15 pages; at most 20 MB; 13 sections in order: Title Slide (Innovation Name), Problem Statement, Target User & Market, Proposed Solution, Key Features & Tech Stack, Screenshots or Product Demo, Competitive Advantage, Current Status & Development Plan, Business Model, Impact Plan, Roadmap & Future Direction, Team Profile & Contact, Reference | [05](./05-paper-outline.md) |
| Video | Recommended; at most 5 minutes; YouTube unlisted or public; must contain the solution overview, the main features and a demonstration of the system | [06](./06-five-minute-demo-script.md) |
| Student track | "dinilai terpisah, sehingga tidak bersaing langsung dengan tim profesional"; "keikutsertaan terbuka lintas jenjang"; weights Uniqueness 15, Proof of Concept 15, Functionalities & Features 15, Quality 30, Presentation 25 | [01](./01-winning-positioning.md) section 3 |
| After the deadline | Paper selection (date to follow), 18 finalists, final on 10 to 11 November 2026 at SMESCO Indonesia, APICTA Award on 7 December 2026 | Dates can change |
| Contact | `info@developerday.id` | The page says the committee replies on working days |

---

## 2. The `.id` domain condition

The body of the accordion was not visible in the rendered text during the first audit. It is present in the page data and reads as quoted in section 1. This closes the question of whether a rule exists: it does, and it is stated as a condition on the validity of the work.

| Fact | State |
|---|---|
| Rule | Every product must use a `.id` domain as main site, landing page, organisation site or official subdomain |
| ReduCera today | The repository holds no `.id` hostname; the stack runs at `http://localhost` (CP-13) |
| Exact test used by the committee | Unknown. The text does not say whether a landing page that links to the product satisfies it, or whether the application itself must be served from the `.id` host |
| Production in the repository | `docker-compose.prod.yml` validates (`docker compose -f docker-compose.prod.yml config` exit 0); `infra/nginx/conf.d/01-ssl.conf.example` shows the TLS server block; no production host exists; no deployment was made |

Options for the owner (each needs a decision, a cost or a person outside this repository):

| Option | What it takes | Risk |
|---|---|---|
| A. Product on a `.id` domain | Register a `.id` domain, point DNS to a host that runs the prod compose with TLS, set the public URLs, run `api-migrate`, seed demo data | Cost and time; production deployment needs the owner's explicit approval (rule of the owner's master prompt, section D.4) |
| B. `.id` landing page plus product elsewhere | A `.id` landing page that describes and links the product | May not satisfy "produk wajib menggunakan domain .id"; ask first |
| C. Official subdomain of an organisation that already owns a `.id` domain | Permission from that organisation (for example a university domain) | Needs a third party within eight days |

Action list:

- [ ] Ask `info@developerday.id` for the exact pass condition and for the minimum maturity level, and whether the Student track has subcategories. Keep the reply as evidence. Owner: team lead.
- [!] Decide A, B or C. Owner: team lead. Blocks the paper link, the video address bar and the product link.
- [ ] If A: environment values to change are `PUBLIC_API_URL`, `PUBLIC_AI_URL`, `PUBLIC_WEB_URL`, `NUXT_PUBLIC_API_URL`, `NUXT_PUBLIC_AI_URL`, `NUXT_PUBLIC_SITE_URL`, `ADMIN_URL`, `CORS_EXTRA_ORIGINS`; certificates under `infra/nginx`; secrets only in the git-ignored root `.env` of the host; the model directory `models/bge-m3` (2.3 GB) copied to the host (or fetched with `scripts/prefetch_embedding_model.py`) and `EMBEDDING_PROVIDER=local` with `LOCAL_EMBEDDING_PRELOAD=true` in that `.env` ([ADR-030](../decisions/ADR-030-local-embedding-provider.md)).
- [ ] Evidence of compliance to keep: `curl -I https://<host>/` output, a screenshot of the address bar, DNS record. Never the `.env`.

---

## 3. Category, eligibility and team

| Item | Needed | State | Owner |
|---|---|---|---|
| Category and subcategory | Student, or Inclusions & Community Services → Education, with one subcategory | `[!]` decision open ([01](./01-winning-positioning.md) section 3) | Team lead |
| Eligibility for Student | Every member is a student or the team otherwise qualifies; the page says the track is open across levels | `[ ]` only the team knows | Team lead |
| Team members | Up to three names, roles, institutions, e-mails | `[ ]` not in the repository; do not infer | Team lead |
| Registration in the portal | Account, team name unique in the event, category, subcategory | `[ ]` | Team lead |
| Fee | IDR 100,000 per team registration | `[ ]` | Team lead |
| Second registration in another category | Separate team registration and a second fee, allowed by the page | `[ ]` optional | Team lead |

---

## 4. Deliverables

| Deliverable | State | Where |
|---|---|---|
| Registration form and team profile | `[ ]` | developerday.id |
| Description of the digital solution | `[~]` | Section 4 of [05](./05-paper-outline.md) and the one-sentence pitch of [01](./01-winning-positioning.md) |
| Paper PDF (13 sections, 15 pages, 20 MB, public link) | `[~]` outline and budget done, text not written | [05](./05-paper-outline.md) |
| Demo video (YouTube, at most 5:00) | `[~]` motion cut of 3:35 with a music bed and no voice built from real captures on 2026-10-18; storyboard approved and rendered to `~/Videos/reducera-competition-demo.mp4` (and `-no-audio.mp4`, outside the repository); waits for the owner's watch-through, the screenshot licence confirmation, voice-over and upload | [08](./08-video-production-and-narration.md), [06](./06-five-minute-demo-script.md), [02](./02-demo-flow-and-evidence.md) section 7 |
| Application or prototype link | `[!]` needs a host (section 2) | |
| Reproduction notes for judges (optional) | `[~]` | [02](./02-demo-flow-and-evidence.md), [03](./03-evaluation-report.md) section 10 |

---

## 5. Claims audit before anything is published

Every sentence of the paper and the video maps to a claim in [01](./01-winning-positioning.md) section 4. A claim may appear as implemented only when its state is `VERIFIED_E2E` or `VERIFIED_COMPONENT`; otherwise it is worded as planned, pending or blocked.

- [ ] No learner count, retention lift, conversion, revenue, market size or cost saving appears (none is measured).
- [ ] No fixture number is presented as a result; fixtures are labelled.
- [ ] The benchmark is reported with intervals, the safety `FAIL` on TC-46 and the missing calibration.
- [ ] Chat citations are not claimed (chat replies carry no citation markers yet); lesson-introduction citations and the local embedding provider are described as they are.
- [ ] AI credits are not claimed; the circularity panel is not claimed as a feature.
- [ ] The `.id` compliance sentence is written only when a `.id` host serves the product.
- [ ] No password, token, private log or real learner content in the PDF, the video or the repository docs.

---

## 6. Build, gates and state of the working tree

Run every command through the `tools` profile (`export POSTGRES_PORT=5434 WEB_PORT=3001`). Results below were recorded on 2026-10-17 and must be repeated after the last change.

| Gate | Command | Last result |
|---|---|---|
| Ownership rules | `repo-tools bash scripts/check-ownership-rules.sh` | `PASS` |
| Theme sync | `repo-tools bash infra/scripts/check-theme-sync.sh` | OK (baseline audit) |
| Compose env | `repo-tools python scripts/check-compose-env.py` | exit 0 |
| Compose config | `docker compose config`; `docker compose -f docker-compose.prod.yml config` | both exit 0 |
| API typecheck | `api-tools pnpm exec tsc --noEmit` | exit 0 |
| API tests | `api-tools pnpm jest --silent` on `reducera_ls_scratch` | 254 suites passed, 1 skipped; 3558 tests passed, 5 skipped |
| AI API tests | `ai-tools pytest -q` | 1206 passed |
| Web tests | `web-tools pnpm test` | 79 files, 1010 tests passed |
| Web build | `web-tools pnpm build`, then `docker compose build web`, `up -d --no-deps --force-recreate web` | built and served (RC-33) |
| Schema drift | `api-tools pnpm prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` | empty on the scratch database |
| Stack | `docker compose ps`; `curl http://localhost/nginx-health`; `curl http://localhost/api/v1/docs` | ten services healthy; 200; 200 |
| Secret and config scan | none run yet | `[ ]` run before publishing the repository or the PDF |
| Demo run-through | S1 to S15 of [02](./02-demo-flow-and-evidence.md) | partly run (section 8 of 02); `[ ]` full run on the recording account |

State of the working tree: five days of work are uncommitted (CP-14). Only the owner stages and commits.

- [!] Commit the working tree and tag the commit that the video shows. Owner: team lead.
- [ ] Keep a copy of the dev database before any reset (`docs/operations/runbook/db-restore.md`).

---

## 7. Schedule to the deadline

| Date | Work | Gate |
|---|---|---|
| 17 to 18 Oct | Decide category, team and `.id` option; send the question to the organizer | Decisions written down |
| 19 to 21 Oct | Prepare the recording account (02 section 7); T4 panel is built, check it after the last change; index lesson-bound material if chat citations are wanted; collect at least 20 human labels for the judge | Account ready; labels counted |
| 22 to 23 Oct | Repeat all gates; run S1 to S15 on the final host; record and edit the video; export the PDF | All gates green; video under 5:00 |
| 24 Oct | Final claims audit; upload video; publish paper link; open both from a signed-out browser | Section 5 all checked |
| 25 Oct | Submit in the portal early in the day; no feature work | Confirmation saved |

Freeze rule: from 24 October only fixes of submission blockers.

---

## 8. Decisions that only the owner can make

| # | Decision | Needed for |
|---|---|---|
| 1 | Category and subcategory; whether the team qualifies as students | Registration |
| 2 | Team members and contacts | Registration, paper section 12 |
| 3 | `.id` option A, B or C, and the budget for it | Product link, video, validity |
| 4 | Permission to deploy a public instance | Option A |
| 5 | Commit and tag of the working tree | Reproducibility, CP-14 |
| 6 | Keep the local embedding provider (`EMBEDDING_PROVIDER=local`, 2.3 GB model directory on the host) or buy Hugging Face credit | Retrieval on the competition host |
| 7 | Human labels for the benchmark judge; the gate margin; review of both datasets and of TC-46 | Evaluation claims |
| 8 | Whether to build the metrics panel (T4) before the deadline | Impact plan |
| 9 | Language of the video narration | Video |

---

## Evidence citations

- All rules in section 1: `https://developerday.id/`, page text and embedded page data, fetched 2026-10-17
- `.id` rule text: embedded page data under the accordion "Kewajiban domain .id"
- Gate results: sections "Baseline gates" and T1 of [`00-current-state-audit.md`](./00-current-state-audit.md), RC-34 in `docs/progress-tracker.md`
- Compose and nginx: `docker-compose.prod.yml`, `infra/nginx/conf.d/01-ssl.conf.example`, `.env.example:21-23`, `:42-43`, `:110-114`
- Deployment approval rule: the owner's master prompt for this work (section D.4: no production deployment without explicit human approval); production compose rules in `AGENTS.md` lines 55-56
