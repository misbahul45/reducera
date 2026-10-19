from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace

from config.agent_session import mint_session
from errors.types import RetrievalError
from v1.users_steps.service import build_learning_introduction_llm
from v1.users_steps.streaming import FinalEvent, SourcesEvent, StageEvent, chunk_text


class _Chunk:
    def __init__(self, text):
        self.text = text


class _LLM:
    def stream(self, prompt):
        return iter([_Chunk("Halo "), _Chunk("dunia")])


def _pipeline(retrieve):
    return SimpleNamespace(llm=_LLM(), retrieve=retrieve)


def _steps():
    return [
        SimpleNamespace(title="Apa itu akuntansi", description="d"),
        SimpleNamespace(title="Siklus akuntansi", description="d"),
    ]


def _run(pipeline, session, learning_style=None):
    async def consume():
        return [chunk async for chunk in build_learning_introduction_llm(_steps(), pipeline, learning_style, session)]

    return asyncio.run(consume())


def _stages(chunks):
    return [chunk for chunk in chunks if isinstance(chunk, StageEvent)]


def test_stages_arrive_in_pipeline_order_before_the_first_word():
    chunks = _run(_pipeline(lambda **kw: [{"text": "a"}, {"text": "b"}]), mint_session(acting_user_id="u-1"))

    assert [stage.key for stage in _stages(chunks)] == ["context", "profile", "retrieval", "writing"]
    assert isinstance(chunks[3], SourcesEvent)
    assert isinstance(chunks[4], StageEvent) and chunks[4].key == "writing"
    assert [chunk_text(chunk) for chunk in chunks[5:-1]] == ["Halo ", "dunia"]
    assert isinstance(chunks[-1], FinalEvent) and chunks[-1].text == "Halo dunia"


def test_context_stage_reports_the_real_step_count_and_titles():
    stage = _stages(_run(_pipeline(lambda **kw: []), mint_session(acting_user_id="u-1")))[0]

    assert stage.state == "done"
    assert stage.data == {"steps": 2, "titles": ["Apa itu akuntansi", "Siklus akuntansi"]}


def test_profile_stage_names_the_style_it_found_or_says_it_was_skipped():
    with_style = _stages(
        _run(_pipeline(lambda **kw: []), mint_session(acting_user_id="u-1"), SimpleNamespace(dominant_style="suka membaca catatan"))
    )[1]
    without_style = _stages(_run(_pipeline(lambda **kw: []), mint_session(acting_user_id="u-1")))[1]

    assert (with_style.state, with_style.data) == ("done", {"style": "reading_writing"})
    assert (without_style.state, without_style.data) == ("skipped", {"style": None})


def test_retrieval_stage_counts_the_sources_that_were_really_found():
    retrieval = _stages(_run(_pipeline(lambda **kw: [{"text": "a"}, {"text": "b"}]), mint_session(acting_user_id="u-1")))[2]

    assert retrieval.state == "done"
    assert retrieval.data == {"queries": 2, "sources": 4, "topic": 0, "failed": 0}


def test_retrieval_stage_says_failed_when_every_lookup_failed():
    def broken(**kw):
        raise RetrievalError("retrieval failed")

    retrieval = _stages(_run(_pipeline(broken), mint_session(acting_user_id="u-1")))[2]

    assert retrieval.state == "failed"
    assert retrieval.data == {"queries": 2, "sources": 0, "topic": 0, "failed": 2}


def test_retrieval_stage_is_skipped_without_a_session():
    retrieval = _stages(_run(_pipeline(lambda **kw: [{"text": "a"}]), None))[2]

    assert retrieval.state == "skipped"
    assert retrieval.data == {"queries": 0, "sources": 0, "topic": 0, "failed": 0}


def test_stage_event_serialises_to_plain_json_and_is_never_text():
    stage = StageEvent("context", "done", {"titles": ["Pengantar Akuntansi — Dasar"]})

    assert json.loads(stage.to_json()) == {"key": "context", "state": "done", "data": {"titles": ["Pengantar Akuntansi — Dasar"]}}
    assert chunk_text(stage) is None


def test_the_introduction_is_a_micro_text_not_a_lesson():
    prompts = []

    class _CapturingLLM:
        def stream(self, prompt):
            prompts.append(prompt)
            return iter([_Chunk("Halo")])

    _run(SimpleNamespace(llm=_CapturingLLM(), retrieve=lambda **kw: []), mint_session(acting_user_id="u-1"))

    prompt = prompts[0]
    assert "120 sampai 180 kata" in prompt
    assert "jangan mengajarkan isi langkah" in prompt
    assert "komprehensif" not in prompt
    assert "Hook → Context" not in prompt


TOPIC_RECORDS = {
    "scope": {},
    "sources": [
        {"refType": "CONCEPT", "refId": "c1", "title": "Konsep: Apa itu akuntansi", "text": "Akuntansi adalah proses mencatat dan melaporkan transaksi keuangan."},
        {"refType": "TOPIC", "refId": "t1", "title": "Topik: Akuntansi Dasar", "text": "Urutan referensi pembelajaran akuntansi."},
    ],
}


class _CitingLLM:
    def stream(self, prompt):
        _CitingLLM.prompt = prompt
        return iter([_Chunk("Akuntansi mencatat transaksi [1]. "), _Chunk("Ini tidak ada [9].")])


def _run_with_topic(pipeline, session, lesson_id="lesson-1"):
    from unittest.mock import patch

    async def consume():
        return [
            chunk
            async for chunk in build_learning_introduction_llm(_steps(), pipeline, None, session, lesson_id=lesson_id)
        ]

    with patch("v1.users_steps.service.fetch_topic_sources", return_value=TOPIC_RECORDS):
        return asyncio.run(consume())


def test_the_numbered_records_of_the_topic_are_announced_before_the_first_word_and_shown_to_the_model():
    chunks = _run_with_topic(SimpleNamespace(llm=_CitingLLM(), retrieve=lambda **kw: []), mint_session(acting_user_id="u-1"))

    announced = next(chunk for chunk in chunks if isinstance(chunk, SourcesEvent))
    assert [c["kind"] for c in announced.citations] == ["TOPIC", "TOPIC"]
    assert chunks.index(announced) < next(i for i, c in enumerate(chunks) if chunk_text(c) is not None)
    assert 'source="topic-database"' in _CitingLLM.prompt and "Konsep: Apa itu akuntansi" in _CitingLLM.prompt
    assert "penanda sumber" in _CitingLLM.prompt


def test_the_final_text_keeps_only_markers_of_real_sources_and_names_them():
    chunks = _run_with_topic(SimpleNamespace(llm=_CitingLLM(), retrieve=lambda **kw: []), mint_session(acting_user_id="u-1"))

    final = chunks[-1]
    assert isinstance(final, FinalEvent)
    assert "[1]" in final.text and "[9]" not in final.text
    assert [c["index"] for c in final.citations] == [1]
    assert final.citations[0]["refType"] in {"CONCEPT", "TOPIC"} and final.citations[0]["refId"]


def test_the_stage_of_retrieval_counts_the_records_of_the_topic():
    chunks = _run_with_topic(SimpleNamespace(llm=_CitingLLM(), retrieve=lambda **kw: []), mint_session(acting_user_id="u-1"))

    retrieval = [c for c in chunks if isinstance(c, StageEvent) and c.key == "retrieval"][0]
    assert retrieval.data["topic"] == 2


def test_without_a_lesson_no_record_is_asked_for():
    from unittest.mock import patch

    with patch("v1.users_steps.service.fetch_topic_sources") as fetch:
        _run(_pipeline(lambda **kw: []), mint_session(acting_user_id="u-1"))

    fetch.assert_not_called()


def test_a_chunk_whose_text_is_a_method_is_written_out_as_text_like_the_real_model_sends_it():
    class _MethodChunk:
        def __init__(self, value):
            self._value = value

        def text(self):
            return self._value

    class _LLM:
        def stream(self, prompt):
            return iter([_MethodChunk("Halo "), _MethodChunk("dunia [1]")])

    chunks = _run_with_topic(SimpleNamespace(llm=_LLM(), retrieve=lambda **kw: []), mint_session(acting_user_id="u-1"))

    written = [chunk for chunk in chunks if isinstance(chunk, str)]
    assert written == ["Halo ", "dunia [1]"]
    assert isinstance(chunks[-1], FinalEvent) and chunks[-1].text == "Halo dunia [1]"
    assert [c["index"] for c in chunks[-1].citations] == [1]
