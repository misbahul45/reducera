from __future__ import annotations

import sys
import types
from unittest.mock import MagicMock, patch

import pytest

from config.agent_session import mint_session
from config.prompt_registry import ResolvedTemplate
from v1.learning.chat_template import BUILTIN_CHAT_TEMPLATE
from v1.learning.service import CHAT_PROMPT_VERSION

SESSION = mint_session(acting_user_id="user-1")

CANDIDATE = (
    "CANDIDATE PROMPT. " + "Teach with care. " * 15
    + 'Goal "{{user_step_title}}". {{domain_block}} {{learner_section}} {{user_input}} Sources: {{rag}} {{web}} {{memory}} {{conversation}} {{current_material}}'
)


def _module(name: str, **attributes) -> types.ModuleType:
    module = types.ModuleType(name)
    module.__dict__.update(attributes)
    return module


@pytest.fixture()
def collaborators():
    pipeline = MagicMock()
    pipeline.retrieve.return_value = []
    memory = MagicMock()
    memory.retrieve_as_string.return_value = "ingatan"
    fakes = {
        "config.embedding_pipeline": _module("config.embedding_pipeline", get_embedding_pipeline=lambda: pipeline),
        "utils.tools.memory": _module("utils.tools.memory", memory_manager=memory),
        "utils.tools.web_search": _module("utils.tools.web_search", tool_web_search_results=MagicMock(return_value=[{"title": "Judul web", "url": "https://contoh.id/neraca", "snippet": "hasil web"}])),
    }
    with patch.dict(sys.modules, fakes), patch("v1.learning.service.get_user_step", return_value={"title": "Neraca"}), patch(
        "v1.learning.service.update_message_chat"
    ), patch("v1.learning.service.read_learner_snapshot", return_value=None), patch(
        "v1.learning.service.render_snapshot_block", return_value=""
    ):
        yield


def _build():
    from v1.learning import service

    return service.build_chat_prompt("apa itu neraca?", "m-1", "us-1", SESSION)


def test_without_a_registry_version_the_builtin_template_is_rendered_and_labelled_builtin(collaborators):
    prompt = _build()

    assert prompt.label == CHAT_PROMPT_VERSION
    assert prompt.arm == "builtin"
    assert 'while they work on: "Neraca"' in prompt.text
    assert "{{" not in prompt.text
    assert "[No RAG materials available]" in prompt.text
    assert "hasil web" in prompt.text and "ingatan" in prompt.text


def test_a_registry_version_replaces_the_builtin_template_and_is_named_in_the_prompt_version(collaborators):
    resolved = ResolvedTemplate(label="tutor-chat@4", body=CANDIDATE, arm="canary")

    with patch("v1.learning.service.resolve_template", return_value=resolved) as lookup:
        prompt = _build()

    assert lookup.call_args.args[1] == "tutor-chat"
    assert prompt.label == "tutor-chat@4"
    assert prompt.arm == "canary"
    assert prompt.text.startswith("CANDIDATE PROMPT.")
    assert 'Goal "Neraca".' in prompt.text
    assert "You are CORE" not in prompt.text


def test_learner_input_with_placeholder_syntax_is_not_expanded(collaborators):
    from v1.learning import service

    with patch("v1.learning.service.get_user_step", return_value={"title": "{{memory}}"}):
        prompt = service.build_chat_prompt("{{rag}}", "m-1", "us-1", SESSION)

    assert prompt.text.count("ingatan") == 1
    assert prompt.text.count("hasil web") == 1


def test_the_builtin_text_is_the_study_buddy_prompt():
    assert BUILTIN_CHAT_TEMPLATE.startswith("You are CORE, the study buddy")
    assert "**Staying on track**" in BUILTIN_CHAT_TEMPLATE
    assert "**Teaching strategy**" in BUILTIN_CHAT_TEMPLATE
    assert "**Truthfulness and sources**" in BUILTIN_CHAT_TEMPLATE
    assert "<actions>" in BUILTIN_CHAT_TEMPLATE


def test_the_builtin_text_has_no_example_sentence_for_the_model_to_copy_as_invented_history():
    assert "menaruh kas di debit" not in BUILTIN_CHAT_TEMPLATE
    assert "Never praise or mention anything that is not written there" in BUILTIN_CHAT_TEMPLATE
    assert CHAT_PROMPT_VERSION == "tutor-chat-builtin-4"


TOPIC_RECORDS = {
    "scope": {"lessonTitle": "Apa itu akuntansi"},
    "sources": [
        {"refType": "CONCEPT", "refId": "c1", "title": "Konsep: Persamaan Akuntansi", "text": "Aset sama dengan liabilitas ditambah ekuitas."},
        {"refType": "TOPIC", "refId": "t1", "title": "Topik: Akuntansi Dasar", "text": "Urutan referensi pembelajaran akuntansi."},
    ],
}


def test_the_records_of_the_topic_are_numbered_documents_the_model_can_cite(collaborators):
    with patch("v1.learning.service.fetch_topic_sources", return_value=TOPIC_RECORDS):
        prompt = _build()

    assert 'source="topic-database"' in prompt.text
    assert "Konsep: Persamaan Akuntansi" in prompt.text
    assert [s.kind for s in prompt.sources][:2] == ["TOPIC", "TOPIC"]
    assert prompt.sources[0].ref_type == "CONCEPT"
    assert any(s.kind == "WEB" for s in prompt.sources)


def test_the_web_stays_in_its_own_block_and_the_topic_records_in_the_materials_block(collaborators):
    with patch("v1.learning.service.fetch_topic_sources", return_value=TOPIC_RECORDS):
        prompt = _build()

    materials, web = prompt.text.split("Web Search Results:")
    assert "Konsep: Persamaan Akuntansi" in materials
    assert "hasil web" in web and "Konsep: Persamaan Akuntansi" not in web


def test_without_records_and_materials_the_prompt_says_so_instead_of_inventing_sources(collaborators):
    prompt = _build()

    assert "[No RAG materials available]" in prompt.text
    assert [s.kind for s in prompt.sources] == ["WEB"]
