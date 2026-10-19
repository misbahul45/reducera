from __future__ import annotations

import logging
from typing import Any

from config.agent_session import AgentSession
from config.internal_client import InternalApiClient

logger = logging.getLogger(__name__)

MAX_SOURCES = 20


def fetch_topic_sources(
    session: AgentSession,
    *,
    lesson_id: str | None = None,
    user_step_id: str | None = None,
) -> dict[str, Any]:
    params = {key: value for key, value in (("lessonId", lesson_id), ("userStepId", user_step_id)) if value}
    if not params:
        return {"scope": {}, "sources": []}
    try:
        data = InternalApiClient(session).get("/internal/topic-sources", params=params)
    except Exception:
        logger.warning("[TOPIC_SOURCES] read failed, the answer is built without the topic records", exc_info=True)
        return {"scope": {}, "sources": []}
    if not isinstance(data, dict):
        return {"scope": {}, "sources": []}
    scope = data.get("scope") if isinstance(data.get("scope"), dict) else {}
    sources = [item for item in data.get("sources") or [] if isinstance(item, dict)][:MAX_SOURCES]
    return {"scope": scope, "sources": sources}


def scope_line(scope: dict[str, Any]) -> str:
    parts = [
        ("Topik", scope.get("topicTitle")),
        ("Sub-topik", scope.get("subTopicTitle")),
        ("Pelajaran", scope.get("lessonTitle")),
        ("Langkah", scope.get("stepTitle")),
    ]
    return "\n".join(f"{label}: {' '.join(str(value).split())[:160]}" for label, value in parts if value)


__all__ = ["fetch_topic_sources", "scope_line"]
