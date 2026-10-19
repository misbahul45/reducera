from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

from config.agent_session import AgentSession
from config.internal_client import InternalApiClient
from config.prompt_registry import render_template, resolve_template
from errors.types import CrossServiceError, RetrievalError
from v1.domain.governance import retrieval_scope
from v1.learning.chat_context import fetch_chat_context, learner_name, render_conversation, render_material
from v1.learning.chat_images import IMAGE_ONLY_QUERY, ImageBatch, current_attachments, load_images
from v1.learning.citations import citations_of
from v1.learning.chat_template import BUILTIN_CHAT_TEMPLATE
from v1.learning.dto import CitationDto
from v1.learning.hybrid import rank_hybrid
from v1.learning.sources import KIND_MATERIAL, KIND_TOPIC, KIND_WEB, Source, render_sources
from v1.learning.topic_sources import fetch_topic_sources
from v1.tutor.learner_block import read_learner_snapshot, render_snapshot_block


logger = logging.getLogger(__name__)

CHAT_PROMPT_NAME = "tutor-chat"
CHAT_PROMPT_VERSION = "tutor-chat-builtin-4"
LESSON_PROMPT_VERSION = "lesson-content-builtin-1"


@dataclass(frozen=True)
class ChatPrompt:
    text: str
    citations: list[CitationDto] = field(default_factory=list)
    snapshot: dict[str, Any] | None = None
    label: str = CHAT_PROMPT_VERSION
    arm: str = "builtin"
    sources: list[Source] = field(default_factory=list)
    scope: dict[str, Any] = field(default_factory=dict)
    images: ImageBatch = field(default_factory=ImageBatch)


def update_message_chat(message_id: str, session: AgentSession, payload: dict) -> Any:
    return InternalApiClient(session).patch(f"/internal/chat-messages/{message_id}", json_body=payload)


def query_content_history(chat_id: str, query: str, session: AgentSession) -> list[dict]:
    data = InternalApiClient(session).get(
        "/internal/contents/similarity",
        params={"chatId": chat_id, "query": query},
    )
    return data or []


def get_lesson(lesson_id: str, session: AgentSession) -> dict:
    return InternalApiClient(session).get(f"/internal/lessons/{lesson_id}")


def get_user_step(user_step_id: str, session: AgentSession) -> dict:
    return InternalApiClient(session).get(f"/internal/user-steps/{user_step_id}")


def create_content_material(payload: dict, session: AgentSession) -> Any:
    return InternalApiClient(session).post("/internal/contents", json_body=payload)


STATUS_RETRIEVAL = "Mencari materi yang pas buat kamu…"
STATUS_WEB = "Mengecek sumber tambahan di web…"
STATUS_MEMORY = "Mengingat apa yang sudah kita bahas…"
STATUS_COMPOSE = "Menyusun jawaban…"
NO_RAG = "[No RAG materials available]"
NO_WEB = "[No web results available]"
WEB_RESULT_LIMIT = 6


def build_chat_prompt(
    query: str,
    message_id: str,
    user_step_id: str,
    session: AgentSession,
    chat_id: str | None = None,
) -> ChatPrompt:
    from config.embedding_pipeline import get_embedding_pipeline
    from config.prompt_segmentation import (
        neutralize_fences,
        segment_tool_output,
        segment_user_input,
    )
    from utils.tools.memory import memory_manager
    from utils.tools.web_search import tool_web_search_results
    from v1.domain import load_default_taxonomy
    from v1.domain.context import render_domain_context

    pipeline = get_embedding_pipeline()
    snapshot = read_learner_snapshot(session, user_step_id=user_step_id, intent="DOUBT")

    update_message_chat(message_id, session, {"text": STATUS_RETRIEVAL, "status": "PROCESSING"})
    try:
        user_step = get_user_step(user_step_id, session)
        user_step_title = user_step.get("title", user_step_id)
    except CrossServiceError as exc:
        logger.warning("[PROMPT] user_step fetch failed: %s", exc.message)
        user_step_title = user_step_id
    user_step_title = neutralize_fences(" ".join(str(user_step_title).split())[:200])

    context = fetch_chat_context(chat_id or "", message_id, session)
    attachments = current_attachments(context, query)
    image_only = bool(attachments) and (query or "").strip() == IMAGE_ONLY_QUERY
    search_query = user_step_title if image_only else query
    images = load_images(attachments, session)

    try:
        rag_results = pipeline.retrieve(query=search_query, scope=retrieval_scope(session.acting_user_id, snapshot), top_k=10)
    except RetrievalError as exc:
        logger.warning("[PROMPT] retrieval failed, the answer is built without materials: %s", exc.message)
        rag_results = []
    citations = citations_of(rag_results or [])

    if image_only:
        web_results = []
    else:
        update_message_chat(message_id, session, {"text": STATUS_WEB, "status": "PROCESSING"})
        web_results = tool_web_search_results(query, limit=WEB_RESULT_LIMIT)

    update_message_chat(message_id, session, {"text": STATUS_MEMORY, "status": "PROCESSING"})
    memory = segment_tool_output(
        "learner_memory",
        memory_manager.retrieve_as_string(
            user_id=session.acting_user_id,
            top_k=10,
            memory_type="learning_path",
        ),
        trust="learner-derived",
    )

    update_message_chat(message_id, session, {"text": STATUS_COMPOSE, "status": "PROCESSING"})

    topic = fetch_topic_sources(session, user_step_id=user_step_id)
    sources = rank_hybrid(search_query, topic["sources"], rag_results or [], web_results or [], include_web=not image_only)
    domain_block = render_domain_context(load_default_taxonomy())
    learner_block = render_snapshot_block(session, snapshot)
    learner_section = (
        f'<learner_state trust="derived">\n{learner_block}\n</learner_state>\n\n' if learner_block else ""
    )

    template = resolve_template(session, CHAT_PROMPT_NAME)
    prompt = render_template(
        template.body if template else BUILTIN_CHAT_TEMPLATE,
        {
            "user_step_title": user_step_title,
            "learner_name": learner_name(context),
            "domain_block": domain_block,
            "learner_section": learner_section,
            "conversation": render_conversation(context, query),
            "current_material": render_material(context),
            "user_input": segment_user_input(query),
            "rag": render_sources(sources, (KIND_TOPIC, KIND_MATERIAL)) or NO_RAG,
            "web": render_sources(sources, KIND_WEB) or NO_WEB,
            "memory": memory,
        },
    )
    return ChatPrompt(
        text=prompt,
        citations=citations,
        snapshot=snapshot,
        label=template.label if template else CHAT_PROMPT_VERSION,
        arm=template.arm if template else "builtin",
        sources=sources,
        scope=topic["scope"],
        images=images,
    )


def get_propmpt_material(
    query: str,
    message_id: str,
    user_step_id: str,
    session: AgentSession,
) -> str:
    return build_chat_prompt(query, message_id, user_step_id, session).text


__all__ = [
    "STATUS_COMPOSE",
    "STATUS_MEMORY",
    "STATUS_RETRIEVAL",
    "STATUS_WEB",
    "CHAT_PROMPT_NAME",
    "CHAT_PROMPT_VERSION",
    "LESSON_PROMPT_VERSION",
    "ChatPrompt",
    "build_chat_prompt",
    "update_message_chat",
    "query_content_history",
    "get_lesson",
    "get_user_step",
    "create_content_material",
    "get_propmpt_material",
]