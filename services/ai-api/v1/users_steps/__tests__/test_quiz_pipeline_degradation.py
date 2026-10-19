from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from config.retrieval_governance import GovernanceError
from errors.types import RetrievalError
from v1.users_steps import generate_quiz_pipeline
from v1.users_steps.dto import GenerateQuestionPipeline

QUIZ_JSON = json.dumps(
    {
        "quiz": [
            {
                "question": "Klien bertanya tentang persamaan dasar akuntansi, apa jawabanmu?",
                "type": "scenario",
                "difficulty": "easy",
                "options": [],
                "answer": "Aset = Liabilitas + Ekuitas",
                "sources": [1],
            }
        ]
    }
)


def _state() -> GenerateQuestionPipeline:
    return GenerateQuestionPipeline(
        topic_id="topic-1",
        lesson_id="lesson-1",
        learning_style_id="style-1",
        session_id="session-1",
        acting_user_id="user-1",
        tenant_id="tenant-1",
        trace_id="trace-1",
        idempotency_key="key-1",
        context="=== TOPIC ===\nAkuntansi dasar",
    )


def _router():
    router = MagicMock()
    router.invoke.side_effect = [SimpleNamespace(text="Ringkasan materi akuntansi."), SimpleNamespace(text=QUIZ_JSON)]
    return router


def _run(pipeline):
    with (
        patch.object(generate_quiz_pipeline, "get_embedding_pipeline", return_value=pipeline),
        patch.object(generate_quiz_pipeline, "get_router", return_value=_router()),
    ):
        return generate_quiz_pipeline.analyze_text(_state())


def test_quiz_is_built_when_the_summary_cannot_be_stored():
    pipeline = MagicMock()
    pipeline.upsert_document.side_effect = RuntimeError("HF embedding request failed with 402")
    pipeline.retrieve.return_value = []

    result = _run(pipeline)

    assert len(result.quiz) == 1
    pipeline.retrieve.assert_called_once()


def test_quiz_is_built_when_retrieval_fails_as_well():
    pipeline = MagicMock()
    pipeline.upsert_document.side_effect = RuntimeError("HF embedding request failed with 402")
    pipeline.retrieve.side_effect = RetrievalError("retrieval failed")

    result = _run(pipeline)

    assert len(result.quiz) == 1


def test_a_governance_violation_is_not_swallowed():
    pipeline = MagicMock()
    pipeline.upsert_document.side_effect = GovernanceError("a document cannot be written without governance metadata")

    with pytest.raises(GovernanceError):
        _run(pipeline)


def test_the_quiz_prompt_never_teaches_the_model_to_name_the_step_inside_a_question():
    router = _router()
    pipeline = MagicMock()
    pipeline.retrieve.return_value = []

    with (
        patch.object(generate_quiz_pipeline, "get_embedding_pipeline", return_value=pipeline),
        patch.object(generate_quiz_pipeline, "get_router", return_value=router),
    ):
        generate_quiz_pipeline.analyze_text(_state())

    quiz_prompt = router.invoke.call_args_list[1].args[1]
    assert "(Materi Step" not in quiz_prompt
    assert "Jangan menyebut nomor step" in quiz_prompt


def _item(sources):
    return {"question": "Soal?", "type": "input", "difficulty": "easy", "options": [], "answer": "A", "sources": sources}


def _run_with(quiz_items, topic_sources=None):
    router = MagicMock()
    router.invoke.side_effect = [SimpleNamespace(text="Ringkasan."), SimpleNamespace(text=json.dumps({"quiz": quiz_items}))]
    pipeline = MagicMock()
    pipeline.retrieve.return_value = []
    patches = [
        patch.object(generate_quiz_pipeline, "get_embedding_pipeline", return_value=pipeline),
        patch.object(generate_quiz_pipeline, "get_router", return_value=router),
    ]
    if topic_sources is not None:
        patches.append(patch.object(generate_quiz_pipeline, "fetch_topic_sources", return_value=topic_sources))
    for item in patches:
        item.start()
    try:
        return generate_quiz_pipeline.analyze_text(_state()), router
    finally:
        for item in patches:
            item.stop()


def test_a_question_keeps_only_numbers_that_exist_and_the_quiz_lists_the_sources_it_used():
    result, _ = _run_with([_item([1, 9]), _item([7]), _item([])])

    assert [q.sources for q in result.quiz] == [[1]]
    assert [c["index"] for c in result.sources] == [1]
    assert result.sources[0]["kind"] == "TOPIC"


def test_the_prompt_shows_the_numbered_records_and_demands_a_source_per_question():
    _, router = _run_with([_item([1])])

    prompt = router.invoke.call_args_list[1].args[1]
    assert 'source="topic-database"' in prompt
    assert "Sumber wajib" in prompt and '"sources": [1]' in prompt


def test_without_any_record_of_the_topic_no_quiz_is_written_and_the_model_is_not_asked_for_it():
    result, router = _run_with([_item([1])], topic_sources={"scope": {}, "sources": []})

    assert result.quiz == [] and result.sources == []
    assert router.invoke.call_count == 1
