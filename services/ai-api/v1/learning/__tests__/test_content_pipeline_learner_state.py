from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import patch

import pytest

from errors.types import AuthError, CrossServiceError
from v1.domain.adapter import ConceptCatalog
from v1.learning import content_pipeline
from v1.tutor import learner_block as block_module
from v1.learning.__tests__.test_content_pipeline_routing import make_state

REGISTRY = {
    "concepts": [
        {"id": "c1", "title": "Accounting Equation", "level": 1, "sortOrder": 1, "prerequisiteIds": []},
        {"id": "c2", "title": "Journal Entries", "level": 1, "sortOrder": 2, "prerequisiteIds": ["c1"]},
    ],
    "aliases": {"PYTHON_DOMAIN": {"journal_entry": ["c2"]}},
}

LEARNER_STATE = {
    "userId": "u-1",
    "concepts": [
        {
            "conceptId": "c2",
            "title": "Journal Entries",
            "level": 1,
            "mastery": {"score": 0.62, "confidence": 0.05, "evidenceCount": 1, "lastEventAt": None},
            "prerequisites": [{"conceptId": "c1", "title": "Accounting Equation", "score": 0.82, "evidenceCount": 5, "passed": True}],
            "prerequisiteMasteryMet": True,
        }
    ],
    "next": {"conceptId": "c3", "level": 1, "reasonCodes": ["PREREQUISITES_MET"], "concept": {"id": "c3", "title": "Ledger", "level": 1}},
}


@pytest.fixture
def pipeline_io():
    with patch.object(content_pipeline, "update_message_chat"), patch.object(
        content_pipeline, "retrieve_material_results", return_value=[]
    ), patch.object(content_pipeline, "fetch_topic_sources", return_value={"scope": {}, "sources": []}), patch.object(
        content_pipeline, "_render_tutor_system_policy", return_value="policy"
    ), patch.object(content_pipeline, "tool_memory_upsert"), patch.object(
        content_pipeline, "tool_semantic_search", return_value=[]
    ), patch.object(content_pipeline, "query_content_history", return_value=[]):
        yield


@pytest.fixture
def catalog():
    with patch.object(block_module, "get_concept_catalog", return_value=ConceptCatalog()) as getter:
        yield getter.return_value


def prompt_of(scripted_llm) -> str:
    return str(scripted_llm.calls[-1][2])


def learner_block(prompt: str) -> str:
    start = prompt.index('<learner_state trust="derived">')
    return prompt[start : prompt.index("</learner_state>", start)]


def test_the_learner_state_of_the_lesson_reaches_the_prompt_next_to_the_learning_style(scripted_llm, pipeline_io, catalog, internal_wire):
    internal_wire.respond(200, {"data": REGISTRY})
    scripted_llm.reply("thinking", "## Materi")

    with patch.object(block_module, "fetch_learner_state", return_value=LEARNER_STATE) as fetch:
        content_pipeline.generate_material(make_state())

    block = learner_block(prompt_of(scripted_llm).replace("\\n", "\n"))
    assert "Learning Style: visual" in block
    assert 'concept c2 "Journal Entries" domain_ids=[journal_entry]: score=0.62' in block
    assert 'next_concept=c3 "Ledger" level=1 reasons=[PREREQUISITES_MET]' in block
    assert fetch.call_args.kwargs == {"lesson_id": "l-1", "intent": "NEW_LEARNING"}
    assert fetch.call_args.args[0].acting_user_id == "u-1"


@pytest.mark.parametrize("failure", [CrossServiceError("down"), AuthError("no"), ValueError("bad shape")])
def test_a_failed_learner_state_read_does_not_stop_the_lesson(scripted_llm, pipeline_io, catalog, internal_wire, failure):
    internal_wire.respond(200, {"data": REGISTRY})
    scripted_llm.reply("thinking", "## Materi")

    with patch.object(block_module, "fetch_learner_state", side_effect=failure):
        state = content_pipeline.generate_material(make_state())

    assert state.generate["data"] == "## Materi"
    block = learner_block(prompt_of(scripted_llm).replace("\\n", "\n"))
    assert "Learning Style: visual" in block
    assert "next_concept" not in block and "mastery_scale" not in block


def test_a_malformed_learner_state_is_left_out_instead_of_breaking_the_lesson(scripted_llm, pipeline_io, catalog, internal_wire):
    internal_wire.respond(200, {"data": REGISTRY})
    scripted_llm.reply("thinking", "## Materi")

    with patch.object(block_module, "fetch_learner_state", return_value={"concepts": [{"mastery": "oops"}], "next": 5}):
        state = content_pipeline.generate_material(make_state())

    assert state.generate["data"] == "## Materi"
    assert "mastery_scale" not in learner_block(prompt_of(scripted_llm).replace("\\n", "\n"))


def test_an_unreachable_registry_only_costs_the_domain_ids(scripted_llm, pipeline_io, catalog, internal_wire):
    internal_wire.respond(503, {"message": "down"})
    scripted_llm.reply("thinking", "## Materi")

    with patch.object(block_module, "fetch_learner_state", return_value=LEARNER_STATE):
        content_pipeline.generate_material(make_state())

    block = learner_block(prompt_of(scripted_llm).replace("\\n", "\n"))
    assert 'concept c2 "Journal Entries": score=0.62' in block
    assert "domain_ids" not in block


def test_the_learner_state_is_not_read_without_a_lesson(scripted_llm, pipeline_io, catalog, internal_wire):
    scripted_llm.reply("thinking", "## Materi")
    state = make_state()
    state.lesson_id = ""

    with patch.object(block_module, "fetch_learner_state") as fetch:
        content_pipeline.generate_material(state)

    fetch.assert_not_called()


def _with_plan(chunk_class: str, words: int, exercises: int) -> dict:
    strategy = {
        "conceptId": "c2",
        "strategy": "WORKED_EXAMPLE",
        "policyVersion": "teaching-policy-v2",
        "reasonCodes": ["LOW_MASTERY"],
        "microlearning": {"chunkClass": chunk_class, "targetWords": words, "exerciseCount": exercises, "policyVersion": "microlearning-v1"},
    }
    return {**LEARNER_STATE, "strategy": strategy}


def test_the_micro_learning_plan_sets_the_length_and_the_exercises_of_the_material(scripted_llm, pipeline_io, catalog, internal_wire):
    internal_wire.respond(200, {"data": REGISTRY})
    scripted_llm.reply("thinking", "## Materi")

    with patch.object(block_module, "fetch_learner_state", return_value=_with_plan("SHORT", 250, 3)):
        content_pipeline.generate_material(make_state())

    prompt = prompt_of(scripted_llm).replace("\\n", "\n")
    assert "Panjang sekitar 250 kata" in prompt
    assert "Latihan Singkat (3 soal)" in prompt
    assert "300 sampai 700" not in prompt


def test_without_a_plan_the_lesson_keeps_the_default_micro_size(scripted_llm, pipeline_io, catalog, internal_wire):
    internal_wire.respond(200, {"data": REGISTRY})
    scripted_llm.reply("thinking", "## Materi")

    with patch.object(block_module, "fetch_learner_state", side_effect=CrossServiceError("down")):
        content_pipeline.generate_material(make_state())

    prompt = prompt_of(scripted_llm).replace("\\n", "\n")
    assert "Panjang sekitar 400 kata" in prompt
    assert "Latihan Singkat (4 soal)" in prompt


def test_a_plan_with_nonsense_numbers_falls_back_to_the_default(scripted_llm, pipeline_io, catalog, internal_wire):
    internal_wire.respond(200, {"data": REGISTRY})
    scripted_llm.reply("thinking", "## Materi")

    with patch.object(block_module, "fetch_learner_state", return_value=_with_plan("SHORT", 99999, 0)):
        content_pipeline.generate_material(make_state())

    prompt = prompt_of(scripted_llm).replace("\\n", "\n")
    assert "Panjang sekitar 400 kata" in prompt
    assert "Latihan Singkat (4 soal)" in prompt


TOPIC_RECORDS = {
    "scope": {"lessonTitle": "Apa itu akuntansi"},
    "sources": [
        {"refType": "CONCEPT", "refId": "c1", "title": "Konsep: Persamaan Akuntansi", "text": "Aset sama dengan liabilitas ditambah ekuitas."},
        {"refType": "TOPIC", "refId": "t1", "title": "Topik: Akuntansi Dasar", "text": "Urutan referensi pembelajaran akuntansi."},
    ],
}


def test_the_material_is_written_from_the_records_of_the_topic_and_cites_only_what_exists(scripted_llm, pipeline_io, catalog, internal_wire):
    internal_wire.respond(200, {"data": REGISTRY})
    scripted_llm.reply("thinking", "## Materi\nAset sama dengan liabilitas plus ekuitas [1]. Itu rumus dasar [8].")

    with patch.object(block_module, "fetch_learner_state", return_value=LEARNER_STATE), patch.object(
        content_pipeline, "fetch_topic_sources", return_value=TOPIC_RECORDS
    ):
        state = content_pipeline.generate_material(make_state())

    prompt = prompt_of(scripted_llm).replace("\\n", "\n")
    assert 'source="topic-database"' in prompt
    assert "Konsep: Persamaan Akuntansi" in prompt
    assert "[2]" not in state.generate["data"] and "[8]" not in state.generate["data"]
    assert "[1]" in state.generate["data"]
    citations = state.generate["citations"]
    assert [c["index"] for c in citations] == [1]
    assert citations[0]["kind"] == "TOPIC"
    assert (citations[0]["refType"], citations[0]["refId"]) in {("CONCEPT", "c1"), ("TOPIC", "t1")}
    assert state.generate["metadata"]["grounded"] is True
    assert state.generate["metadata"]["sourceCount"] == 2


def test_the_prompt_tells_the_model_to_cite_by_document_number_and_not_to_invent(scripted_llm, pipeline_io, catalog, internal_wire):
    internal_wire.respond(200, {"data": REGISTRY})
    scripted_llm.reply("thinking", "## Materi")

    with patch.object(block_module, "fetch_learner_state", return_value=LEARNER_STATE), patch.object(
        content_pipeline, "fetch_topic_sources", return_value=TOPIC_RECORDS
    ):
        content_pipeline.generate_material(make_state())

    prompt = prompt_of(scripted_llm).replace("\\n", "\n")
    assert "penanda sumber" in prompt and "jangan membuat id" in prompt
    assert "belum tercakup di sumber topik" in prompt


def test_without_any_record_the_material_says_so_and_is_marked_ungrounded(scripted_llm, pipeline_io, catalog, internal_wire):
    internal_wire.respond(200, {"data": REGISTRY})
    scripted_llm.reply("thinking", "## Materi tanpa penanda [3]")

    with patch.object(block_module, "fetch_learner_state", return_value=LEARNER_STATE):
        state = content_pipeline.generate_material(make_state())

    assert "Tidak ada sumber topik di database" in prompt_of(scripted_llm).replace("\\n", "\n")
    assert state.generate["citations"] == []
    assert "[3]" not in state.generate["data"]
    assert state.generate["metadata"]["grounded"] is False
    assert state.generate["metadata"]["sourceCount"] == 0


def test_the_material_never_goes_to_the_web(scripted_llm, pipeline_io, catalog, internal_wire):
    internal_wire.respond(200, {"data": REGISTRY})
    scripted_llm.reply("thinking", "## Materi")

    assert not hasattr(content_pipeline, "retrieve_material_web")
    assert not hasattr(content_pipeline, "tool_web_search")
