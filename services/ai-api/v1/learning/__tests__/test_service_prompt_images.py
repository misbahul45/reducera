import sys
import types
from unittest.mock import MagicMock, patch

import pytest

from config.agent_session import mint_session
from v1.learning.chat_images import IMAGE_ONLY_QUERY, ChatImage

SESSION = mint_session(acting_user_id="user-1")
IMAGE = ChatImage(name="neraca.png", mime="image/png", base64="QUJD")


def _module(name: str, **attributes) -> types.ModuleType:
    module = types.ModuleType(name)
    module.__dict__.update(attributes)
    return module


@pytest.fixture()
def collaborators():
    pipeline = MagicMock()
    pipeline.retrieve.return_value = []
    memory = MagicMock()
    memory.retrieve_as_string.return_value = ""
    web = MagicMock(return_value=[])
    fakes = {
        "config.embedding_pipeline": _module("config.embedding_pipeline", get_embedding_pipeline=lambda: pipeline),
        "utils.tools.memory": _module("utils.tools.memory", memory_manager=memory),
        "utils.tools.web_search": _module("utils.tools.web_search", tool_web_search_results=web),
    }
    with patch.dict(sys.modules, fakes), patch(
        "v1.learning.service.get_user_step", return_value={"title": "Siklus akuntansi"}
    ), patch("v1.learning.service.update_message_chat") as status, patch(
        "v1.learning.service.read_learner_snapshot", return_value=None
    ):
        yield pipeline, web, status


def _context(text: str) -> dict:
    return {
        "learnerName": "Sari",
        "messages": [{"id": "m-0", "role": "USER", "text": text, "attachments": [{"id": "att-1", "name": "neraca.png", "mime": "image/png", "size": 3}]}],
        "materials": [],
    }


def _build(query: str):
    from v1.learning.service import build_chat_prompt

    with patch("v1.learning.service.fetch_chat_context", return_value=_context("" if query == IMAGE_ONLY_QUERY else query)), patch(
        "v1.learning.service.load_images"
    ) as load:
        from v1.learning.chat_images import ImageBatch

        load.return_value = ImageBatch(images=(IMAGE,), asked=1)
        return build_chat_prompt(query, "m-1", "us-1", SESSION, chat_id="c-1"), load


def test_the_images_of_the_current_question_are_loaded_and_returned_with_the_prompt(collaborators):
    prompt, load = _build("apa ini?")

    assert [item["id"] for item in load.call_args.args[0]] == ["att-1"]
    assert prompt.images.images == (IMAGE,)


def test_a_question_with_words_still_searches_the_web_with_those_words(collaborators):
    pipeline, web, _ = collaborators

    _build("apa ini?")

    web.assert_called_once()
    assert web.call_args.args[0] == "apa ini?"
    assert pipeline.retrieve.call_args.kwargs["query"] == "apa ini?"


def test_an_image_only_question_searches_the_step_topic_and_never_the_web(collaborators):
    pipeline, web, _ = collaborators

    _build(IMAGE_ONLY_QUERY)

    web.assert_not_called()
    assert pipeline.retrieve.call_args.kwargs["query"] == "Siklus akuntansi"


def test_the_learner_sees_the_same_progress_steps_in_the_same_order(collaborators):
    from v1.learning.service import STATUS_COMPOSE, STATUS_MEMORY, STATUS_RETRIEVAL, STATUS_WEB

    _, _, status = collaborators

    _build("apa ini?")

    assert [call.args[2]["text"] for call in status.call_args_list] == [STATUS_RETRIEVAL, STATUS_WEB, STATUS_MEMORY, STATUS_COMPOSE]


def test_an_image_only_question_skips_only_the_web_step(collaborators):
    from v1.learning.service import STATUS_COMPOSE, STATUS_MEMORY, STATUS_RETRIEVAL

    _, _, status = collaborators

    _build(IMAGE_ONLY_QUERY)

    assert [call.args[2]["text"] for call in status.call_args_list] == [STATUS_RETRIEVAL, STATUS_MEMORY, STATUS_COMPOSE]
