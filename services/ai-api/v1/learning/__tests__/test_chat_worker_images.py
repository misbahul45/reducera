from __future__ import annotations

from unittest.mock import MagicMock, patch

from langchain_core.messages import HumanMessage

from v1.learning.chat_images import ChatImage, ImageBatch
from v1.learning.service import ChatPrompt

PAYLOAD = {
    "chatId": "c-1",
    "userStepId": "us-1",
    "messageId": "m-1",
    "userId": "u-1",
    "query": "apa ini?",
    "session_id": "sess-1",
    "acting_user_id": "u-1",
    "tenant_id": "tenant-1",
    "trace_id": "trace-1",
    "idempotency_key": "k-1",
}
IMAGE = ChatImage(name="neraca.png", mime="image/png", base64="QUJD")


def run(scripted_llm, batch: ImageBatch):
    from v1.learning import workers

    prompt = ChatPrompt(text="PROMPT", images=batch)
    with patch.object(workers, "pipeline", MagicMock()), patch(
        "v1.learning.service.build_chat_prompt", return_value=prompt
    ), patch.object(workers, "update_message_chat") as update, patch.object(workers, "write_episode"), patch.object(
        workers, "write_decision_trace"
    ):
        workers.generating_new_content.run(dict(PAYLOAD))
    return update


def test_a_question_with_an_image_reaches_the_model_as_text_plus_image(scripted_llm):
    scripted_llm.reply("flash", "Itu neraca sederhana.")

    update = run(scripted_llm, ImageBatch(images=(IMAGE,), asked=1))

    (_, _, messages), = scripted_llm.calls
    content = messages[0].content
    assert isinstance(messages[0], HumanMessage)
    assert [part["type"] for part in content] == ["text", "image_url"]
    assert content[1]["image_url"]["url"] == "data:image/png;base64,QUJD"
    assert update.call_args.args[2]["text"] == "Itu neraca sederhana."


def test_when_the_model_cannot_use_images_the_answer_is_built_without_them_and_says_so(scripted_llm):
    scripted_llm.fail("flash", "vision unsupported").fail("thinking", "vision unsupported")
    scripted_llm.reply("flash", "Gambarnya belum bisa kubaca, ketik isinya ya.")

    update = run(scripted_llm, ImageBatch(images=(IMAGE,), asked=1))

    fallback = scripted_llm.calls[-1][2]
    assert isinstance(fallback[0].content, str)
    assert "Jangan berpura-pura melihatnya" in fallback[0].content
    assert update.call_args.args[2]["status"] == "COMPLETED"


def test_a_lost_image_is_announced_to_the_model(scripted_llm):
    scripted_llm.reply("flash", "Ketik isinya ya.")

    run(scripted_llm, ImageBatch(images=(), skipped=1, asked=1))

    (_, _, messages), = scripted_llm.calls
    assert "Jangan berpura-pura melihatnya" in messages[0].content


def test_a_plain_question_is_sent_as_plain_text(scripted_llm):
    scripted_llm.reply("flash", "Jawaban.")

    run(scripted_llm, ImageBatch())

    (_, _, messages), = scripted_llm.calls
    assert messages[0].content == "PROMPT"
