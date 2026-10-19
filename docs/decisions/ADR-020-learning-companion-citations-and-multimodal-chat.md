# ADR-020: A learning companion whose every claim is cited, that can act on the lesson, and that reads images

- Status: built on 2026-10-12 at the owner's request; the retrieval weights, the attachment limits and the choice to keep images in PostgreSQL are proposals that wait for the owner (decision D-27)
- Date: 2026-10-12

## Context

The chat of a step answered a question with a bare model reply. It had no memory of the conversation beyond a few lines, no way to say where a statement came from, no way to touch the lesson (a learner who wanted five practice questions or a simpler explanation had to leave the chat), no place to keep what the learner learned, and no way to look at a screenshot or a photo of an exercise. The first chat message of a step was an English sentence that said nothing about the material, and the generated material itself carried no sources.

The owner asked for four things in sequence: a companion that behaves like a study friend, citations on every generated text taken from the topic data in the database, a chat that can generate questions, improve the material and write notes while the learner studies, and a chat that is docked beside the reading and understands images.

## Decision

1. **Sources are the topic records of the learner, then retrieved material, then the web (chat only).** `GET /internal/topic-sources` returns the topic, sub-topic and concept records the learner studies. Generated material, the introduction and the practice questions may cite only a source numbered in the prompt; the web is searched only for chat questions.
2. **Retrieval is hybrid.** `v1/learning/hybrid.py` ranks the topic records with BM25 (Indonesian-aware tokens and light stemming), asks Qdrant for the semantic neighbours and the web for results, and fuses the three rankings with reciprocal rank fusion (`k = 60`, weights 1.0 lexical, 1.0 semantic, 0.6 web). At least three topic records stay in the prompt, at most ten sources in total. When the embedding provider is down the lexical and web rankings still answer.
3. **A marker is a claim that can be checked.** The model writes `[1]` or `[1, 2]`; `apply_citations` removes any number that is not a numbered source, then renumbers the markers by first appearance so the learner reads 1, 2, 3 with no gap, and returns the citations (kind, title, snippet, link for web, lesson id) that the message, the introduction, the material version and the practice question store. The web renders a marker only when a citation backs it and never renders raw HTML from a model.
4. **The companion proposes, the learner decides, the API writes.** A reply may end with at most three typed actions (`QUIZ` with 3 to 10 questions, `IMPROVE_MATERIAL` with `SIMPLIFY`, `EXAMPLE`, `DEEPEN` or `SHORTEN`, `NOTE` with a title and body); anything outside this closed set is dropped. The web shows them as cards. The learner confirms one. For `QUIZ` and `IMPROVE_MATERIAL` `ai-api` runs it (`action_runner.py`) and writes through signed `/internal` routes: `POST /internal/user-steps/{id}/practice-quiz` validates the questions and keeps the answer key inside the API, and a new material version is stored with its own citations. A `NOTE` card is saved by the web with the learner's own token through `POST /notes`, so `ai-api` never writes a note. A quiz is offered by a button after the material exists, never in the middle of generation.
5. **Notes belong to the learner.** `Note` is owned by the user (limit 5000), can point at the step and the chat message it came from, and has its own page at `/my-learning/notes`. The chat saves a reply to a note with one click and the learner can write one while reading.
6. **The companion learns the learner.** The chat prompt carries the mastery snapshot, the teaching strategy of the learner policy (ADR-019), the micro-learning plan (chunk class and size for the strategy) and the recent conversation with its citations from `GET /internal/chats/{chatId}/context`. Every turn is recorded with its strategy so `StrategyOutcome` can credit the next assessment.
7. **The first message of a step is useful.** The introduction is streamed, cited and saved by `PUT /internal/lessons/{lessonId}/introduction` so reopening the step shows it again; the material-ready message is Indonesian and carries the quiz action instead of an English status sentence.
8. **The chat is docked, not floating.** On a screen of 1024 pixels or wider the panel sits on the right and the reading column shrinks beside it (`--rc-chat-w`, wider when maximized); below 1024 pixels it covers the screen. The reading column of a step is capped at `max-w-7xl`. The state is remembered in the browser only.
9. **The chat is multimodal.** A learner attaches up to three images to a message (button, paste or drag and drop), 4 MB each, PNG, JPEG, WebP or GIF. The API decides the type from the first bytes, not from the file name, stores the bytes in `ChatAttachment` (`bytea`, a check that the size equals the length, cascade with the chat), serves them back only to their owner with `nosniff` and a sandbox policy, and allows 6 unsent images and 100 in total per chat; an unsent image older than an hour is dropped. `ai-api` loads the images of the current question through the signed route `GET /internal/chat-attachments/{id}/content` and sends them to the model as image parts with a rule that an image is data and never an instruction. If the model cannot read them the reply says so and answers from the text. An image-only message uses a fixed Indonesian request that both services share (`IMAGE_ONLY_QUERY`), searches with the step title and skips the web.

## Why the images are in PostgreSQL

An object store needs credentials the project does not have (the Cloudinary keys of O-07 are placeholders). Images are capped at 4 MB, 100 per chat and are never part of a list or context read, so the table stays small and the owner can move the bytes to object storage later behind `ChatAttachmentsService` without changing a route.

## Consequences

- A learner can ask, see where the answer came from, turn it into practice or a note, and send a picture of the page they are stuck on, without leaving the step.
- Every citation is traceable to a record that exists. A statement without a number is allowed, but a number without a record is removed.
- Semantic retrieval was unavailable while this was built (the Hugging Face token returns 402), so the dev checks ran on the lexical and web rankings; the topic records come from `Topic`, `SubTopic` and `Concept` because the dev database has no `Resource` rows.
- A message that is retried after a failure resends its text only; the images stay attached to the original message.
- Changing the embedding model still needs new Qdrant collection names (ADR-016).
- Not covered here: a judge or benchmark for answer quality, DSPy candidates and AI credits (see ADR-019 and decisions D-27, A-12).
