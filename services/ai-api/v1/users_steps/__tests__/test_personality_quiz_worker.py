from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from config.agent_session import mint_session
from v1.users_steps import workers

USER = "c6c571d7-40ae-4998-9699-4803d04a0c57"
LESSON = "5787aef0-0df5-4395-a372-92c3b5dfec09"
TOPIC = "f43bfce7-b141-4351-9723-989d972c35f0"
STYLE = "496acf8a-3491-4f04-bb9a-7f9c66ff30be"


def _payload():
    session = mint_session(acting_user_id=USER, trace_id="trace-1", idempotency_key="key-1")
    return {
        "userId": USER,
        "lessonId": LESSON,
        "topicId": TOPIC,
        "learningStyleId": STYLE,
        **session.to_dict(),
    }


def _question():
    return SimpleNamespace(question="Apa itu aset?", type="input", difficulty="easy", options=[], answer="Harta", sources=[1])


CITATIONS = [{"index": 1, "kind": "TOPIC", "title": "Konsep: Persamaan Akuntansi", "refType": "CONCEPT", "refId": "c1"}]


def _run(payload, result=None, unlock=None):
    graph = MagicMock()
    graph.invoke.return_value = result if result is not None else {"quiz": [_question()], "sources": CITATIONS}
    create = MagicMock()
    with (
        patch.object(workers, "graph", graph),
        patch.object(workers, "create_personality_quiz", create),
        patch.object(workers, "write_episode"),
        patch.object(workers, "write_decision_trace"),
        patch.object(workers, "release_lock", unlock or MagicMock()),
    ):
        questions = workers.generate_personality_quiz.run(payload)
    return graph, create, questions


def test_graph_receives_field_named_state_so_langgraph_can_read_the_ids():
    graph, _, _ = _run(_payload())

    state = graph.invoke.call_args.args[0]

    assert state["topic_id"] == TOPIC
    assert state["lesson_id"] == LESSON
    assert state["learning_style_id"] == STYLE
    assert state["acting_user_id"] == USER
    assert "topicId" not in state


def test_quiz_is_saved_for_the_lesson_of_the_request():
    _, create, questions = _run(_payload())

    saved = create.call_args.kwargs["payload"]

    assert saved["lessonId"] == LESSON
    assert saved["userId"] == USER
    assert saved["questions"][0]["question"] == "Apa itu aset?"
    assert len(questions) == 1


def test_the_questions_and_the_quiz_carry_the_sources_they_rest_on():
    _, create, _ = _run(_payload())

    saved = create.call_args.kwargs["payload"]
    assert saved["questions"][0]["sources"] == [1]
    assert saved["sources"] == CITATIONS


def test_a_quiz_without_any_question_that_has_a_real_source_is_not_created_at_all():
    _, create, questions = _run(_payload(), {"quiz": [], "sources": []})

    create.assert_not_called()
    assert questions == []


def test_the_lock_on_the_quiz_is_freed_once_the_quiz_exists_so_it_never_blocks_a_later_request():
    unlock = MagicMock()

    _run(_payload(), unlock=unlock)

    unlock.assert_called_once_with("quiz", USER, LESSON)


def test_the_lock_is_also_freed_when_no_quiz_could_be_made_so_the_learner_can_try_again():
    unlock = MagicMock()

    _run(_payload(), {"quiz": [], "sources": []}, unlock=unlock)

    unlock.assert_called_once_with("quiz", USER, LESSON)


def test_the_lock_is_freed_when_the_last_attempt_fails_and_kept_while_a_retry_is_still_coming():
    task = workers.generate_personality_quiz
    graph = MagicMock()
    graph.invoke.side_effect = RuntimeError("model down")

    for retries, expected_calls in ((0, 0), (task.max_retries, 1)):
        unlock = MagicMock()
        task.push_request(retries=retries)
        try:
            with patch.object(workers, "graph", graph), patch.object(workers, "release_lock", unlock):
                try:
                    task.run(_payload())
                except RuntimeError:
                    pass
        finally:
            task.pop_request()
        assert unlock.call_count == expected_calls
