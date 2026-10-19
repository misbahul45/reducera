from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import pytest

from v1.learning import action_runner
from v1.learning.hybrid import rank_hybrid

BASE = {
    "chatId": "c-1",
    "userStepId": "us-1",
    "messageId": "m-9",
    "session_id": "sess-1",
    "acting_user_id": "u-1",
    "tenant_id": "tenant-1",
    "trace_id": "trace-1",
    "idempotency_key": "k-1",
}
QUIZ = {**BASE, "action": {"type": "QUIZ", "count": 3, "focus": "jurnal"}}
IMPROVE = {**BASE, "action": {"type": "IMPROVE_MATERIAL", "instruction": "SIMPLIFY"}}
SNAPSHOT = {"strategy": {"strategy": "WORKED_EXAMPLE", "difficultyTarget": 0.5, "microlearning": {"chunkClass": "SHORT", "targetWords": 250, "exerciseCount": 3}}}
MATERIAL = {"materials": [{"text": "Materi jurnal umum. " * 30}]}


def question(i: int) -> dict:
    return {
        "question": f"Soal {i}: akun apa yang bertambah di sisi debit?",
        "options": ["Kas", "Utang usaha", "Modal", "Pendapatan"],
        "correctAnswer": "Kas",
        "distractors": {"Utang usaha": "normal_balance_confusion"},
        "sources": [1],
    }


SOURCES = rank_hybrid(
    "jurnal debit kredit",
    [{"refType": "CONCEPT", "refId": "c1", "title": "Konsep: Jurnal Umum", "text": "Jurnal mencatat transaksi dengan debit dan kredit."}],
)
QUIZ_JSON = json.dumps({"title": "Latihan jurnal", "questions": [question(1), question(2), question(3)]})
REWRITTEN = "## Materi Inti\n" + "Kas bertambah di sisi debit, seperti uang di dompet. " * 6


@pytest.fixture()
def world():
    api = MagicMock()
    api.post.return_value = {"quizId": "quiz-9"}
    write = MagicMock()
    with patch.object(action_runner, "InternalApiClient", return_value=api), patch.object(
        action_runner, "read_learner_snapshot", return_value=SNAPSHOT
    ), patch.object(action_runner, "render_snapshot_block", return_value="blok"), patch.object(
        action_runner, "fetch_chat_context", return_value=MATERIAL
    ), patch.object(action_runner, "_sources_for", return_value=SOURCES), patch.object(
        action_runner, "_step_title", return_value="Jurnal umum"
    ), patch.object(action_runner, "write_episode") as episode:
        yield api, write, episode


def messages(write: MagicMock) -> list[dict]:
    return [call.args[2] for call in write.call_args_list]


class TestQuiz:
    def test_it_stores_the_quiz_through_the_api_and_hands_the_learner_a_button(self, world, scripted_llm):
        api, write, episode = world
        scripted_llm.reply("flash", QUIZ_JSON)

        result = action_runner.run_chat_action(dict(QUIZ), write)

        assert result == {"message": "Success", "action": "QUIZ", "result": "quiz-9"}
        path = api.post.call_args.args[0]
        body = api.post.call_args.kwargs["json_body"]
        assert path == "/internal/user-steps/us-1/practice-quiz"
        assert body["title"] == "Latihan jurnal" and len(body["questions"]) == 3
        assert body["questions"][0]["distractors"] == {"Utang usaha": "normal_balance_confusion"}
        sent = messages(write)
        assert sent[0] == {"text": action_runner.STATUS["QUIZ"], "status": "PROCESSING"}
        assert sent[-1]["status"] == "COMPLETED"
        assert sent[-1]["actions"] == [{"type": "OPEN_QUIZ", "quizId": "quiz-9"}]
        assert "3 soal" in sent[-1]["text"]

    def test_the_turn_is_recorded_as_an_action_not_as_a_tutor_turn(self, world, scripted_llm):
        _, write, episode = world
        scripted_llm.reply("flash", QUIZ_JSON)

        action_runner.run_chat_action(dict(QUIZ), write)

        recorded = episode.call_args.args[0]
        assert recorded.agent == "tutor_action"
        assert recorded.prompt_version == "chat-action-quiz-1"
        assert recorded.task == "chat-action:QUIZ"

    def test_the_prompt_carries_the_material_the_count_and_the_closed_code_list(self, world, scripted_llm):
        _, write, _ = world
        scripted_llm.reply("flash", QUIZ_JSON)

        with patch.object(action_runner, "build_quiz_prompt", wraps=action_runner.build_quiz_prompt) as build:
            action_runner.run_chat_action(dict(QUIZ), write)

        kwargs = build.call_args.kwargs
        assert kwargs["count"] == 3 and kwargs["focus"] == "jurnal" and kwargs["difficulty"] == 0.5
        assert "Materi jurnal umum." in kwargs["material"]

    def test_a_model_that_cannot_make_a_quiz_leaves_the_learner_a_retry_and_writes_nothing_to_the_api(self, world, scripted_llm):
        api, write, _ = world
        scripted_llm.reply("flash", "maaf aku tidak bisa").reply("thinking", "tetap bukan json")

        result = action_runner.run_chat_action(dict(QUIZ), write)

        assert result == {"message": "failed", "action": "QUIZ"}
        api.post.assert_not_called()
        last = messages(write)[-1]
        assert last["status"] == "FAILED"
        assert last["actions"] == [QUIZ["action"]]

    def test_a_refusal_of_the_api_is_a_failure_the_learner_can_retry(self, world, scripted_llm):
        api, write, _ = world
        api.post.side_effect = RuntimeError("422")
        scripted_llm.reply("flash", QUIZ_JSON)

        result = action_runner.run_chat_action(dict(QUIZ), write)

        assert result["message"] == "failed"
        assert messages(write)[-1]["actions"] == [QUIZ["action"]]


class TestImprove:
    def test_it_saves_the_new_version_as_content_and_points_to_it(self, world, scripted_llm):
        api, write, episode = world
        scripted_llm.reply("thinking", REWRITTEN)

        result = action_runner.run_chat_action(dict(IMPROVE), write)

        assert result["message"] == "Success"
        path = api.post.call_args.args[0]
        body = api.post.call_args.kwargs["json_body"]
        assert path == "/internal/contents"
        assert body["chatId"] == "c-1" and body["chatMessageId"] == "m-9"
        assert body["data"] == REWRITTEN.strip()
        assert body["metadata"]["rewrite"] == "SIMPLIFY"
        last = messages(write)[-1]
        assert last["actions"] == [{"type": "OPEN_MATERIAL"}] and "lebih sederhana" in last["text"]
        assert episode.call_args.args[0].prompt_version == "chat-action-improve-1"

    def test_the_prompt_uses_the_word_target_of_the_micro_learning_plan(self, world, scripted_llm):
        _, write, _ = world
        scripted_llm.reply("thinking", REWRITTEN)

        with patch.object(action_runner, "build_rewrite_prompt", wraps=action_runner.build_rewrite_prompt) as build:
            action_runner.run_chat_action(dict(IMPROVE), write)

        assert build.call_args.kwargs["plan"]["targetWords"] == 250

    def test_without_material_nothing_is_rewritten(self, world, scripted_llm):
        api, write, _ = world
        with patch.object(action_runner, "fetch_chat_context", return_value={"materials": []}):
            result = action_runner.run_chat_action(dict(IMPROVE), write)

        assert result["message"] == "Success"
        api.post.assert_not_called()
        assert messages(write)[-1]["text"] == action_runner.NO_MATERIAL_TEXT

    def test_a_rewrite_that_is_too_short_is_not_saved(self, world, scripted_llm):
        api, write, _ = world
        scripted_llm.reply("thinking", "ok")

        result = action_runner.run_chat_action(dict(IMPROVE), write)

        assert result["message"] == "failed"
        api.post.assert_not_called()


class TestRejected:
    @pytest.mark.parametrize("action", [{"type": "NOTE", "title": "t", "body": "b"}, {"type": "DELETE_ACCOUNT"}, None, {"type": "QUIZ", "count": 50}])
    def test_an_action_the_server_does_not_run_is_refused_without_any_model_call(self, world, scripted_llm, action):
        api, write, _ = world

        result = action_runner.run_chat_action({**BASE, "action": action}, write)

        assert result == {"message": "rejected"}
        api.post.assert_not_called()
        assert messages(write)[-1]["status"] == "FAILED"


class TestCitedActions:
    def test_each_question_names_the_topic_record_it_is_based_on_and_the_api_gets_it(self, world, scripted_llm):
        api, write, _ = world
        scripted_llm.reply("flash", QUIZ_JSON)

        action_runner.run_chat_action(dict(QUIZ), write)

        questions = api.post.call_args.kwargs["json_body"]["questions"]
        assert all(q["sources"] and q["sources"][0]["kind"] == "TOPIC" and q["sources"][0]["refType"] == "CONCEPT" for q in questions)
        assert questions[0]["sources"][0]["title"] == "Konsep: Jurnal Umum"

    def test_a_question_that_names_no_real_source_is_dropped_and_too_few_left_fails_the_quiz(self, world, scripted_llm):
        api, write, _ = world
        invented = {**question(1), "sources": [9]}
        none = {**question(2), "sources": []}
        scripted_llm.reply("flash", json.dumps({"title": "Latihan", "questions": [invented, none, question(3)]})).reply(
            "thinking", json.dumps({"title": "Latihan", "questions": [invented, none, question(3)]})
        )

        result = action_runner.run_chat_action(dict(QUIZ), write)

        assert result["message"] == "failed"
        api.post.assert_not_called()

    def test_without_any_source_no_quiz_is_made_and_no_model_is_asked(self, world, scripted_llm):
        api, write, _ = world
        with patch.object(action_runner, "_sources_for", return_value=[]), patch.object(action_runner, "get_router") as router:
            result = action_runner.run_chat_action(dict(QUIZ), write)

        assert result == {"message": "no-sources", "action": "QUIZ"}
        router.assert_not_called()
        api.post.assert_not_called()
        last = messages(write)[-1]
        assert last["status"] == "FAILED" and last["actions"] == [] and last["text"] == action_runner.NO_SOURCES_TEXT

    def test_the_rewritten_material_keeps_only_citations_of_real_sources(self, world, scripted_llm):
        api, write, _ = world
        scripted_llm.reply("thinking", "## Materi Inti\n" + "Jurnal mencatat transaksi dengan debit dan kredit [1]. Ini dari sumber lain [7]. " * 4)

        action_runner.run_chat_action(dict(IMPROVE), write)

        body = api.post.call_args.kwargs["json_body"]
        assert [c["index"] for c in body["citations"]] == [1]
        assert "[7]" not in body["data"]
        assert body["metadata"]["grounded"] is True and body["metadata"]["sourceCount"] == 1

    def test_a_rewrite_without_any_source_is_stored_but_marked_ungrounded(self, world, scripted_llm):
        api, write, _ = world
        scripted_llm.reply("thinking", REWRITTEN)

        with patch.object(action_runner, "_sources_for", return_value=[]):
            action_runner.run_chat_action(dict(IMPROVE), write)

        body = api.post.call_args.kwargs["json_body"]
        assert body["citations"] == [] and body["metadata"]["grounded"] is False
