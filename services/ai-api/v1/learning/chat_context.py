from __future__ import annotations

import logging
import re
from typing import Any

from config.agent_session import AgentSession
from config.internal_client import InternalApiClient
from config.prompt_segmentation import neutralize_fences, segment_retrieved, segment_tool_output
from v1.learning.chat_images import IMAGE_ONLY_QUERY, attachments_of, image_marker

logger = logging.getLogger(__name__)

HISTORY_LIMIT = 12
HISTORY_CHARS = 4500
MESSAGE_CHARS = 600
NAME_CHARS = 30
LEARNER_LABEL = "Pelajar"
COMPANION_LABEL = "CORE"
EMPTY_HISTORY = "[Ini awal percakapan]"
EMPTY_MATERIAL = "[Belum ada materi untuk langkah ini]"

_NAME_CHARS = re.compile(r"[^\w'\-]|\d|_", re.UNICODE)


def fetch_chat_context(chat_id: str, message_id: str, session: AgentSession) -> dict[str, Any] | None:
    if not chat_id:
        return None
    params: dict[str, Any] = {"limit": HISTORY_LIMIT}
    if message_id:
        params["beforeMessageId"] = message_id
    try:
        data = InternalApiClient(session).get(f"/internal/chats/{chat_id}/context", params=params)
    except Exception:
        logger.warning("[CHAT_CONTEXT] read failed, the reply is built without the conversation", exc_info=True)
        return None
    return data if isinstance(data, dict) else None


def learner_name(context: dict[str, Any] | None) -> str:
    raw = str((context or {}).get("learnerName") or "").strip().split(" ")[0]
    return _NAME_CHARS.sub("", raw)[:NAME_CHARS]


def _history_lines(context: dict[str, Any] | None, query: str) -> list[str]:
    messages = [
        m
        for m in (context or {}).get("messages") or []
        if isinstance(m, dict) and (isinstance(m.get("text"), str) or attachments_of(m))
    ]
    if messages and messages[-1].get("role") == "USER":
        text = (messages[-1].get("text") or "").strip()
        asked = (query or "").strip()
        if text == asked or (text == "" and asked == IMAGE_ONLY_QUERY):
            messages = messages[:-1]

    lines: list[str] = []
    used = 0
    for message in reversed(messages):
        label = COMPANION_LABEL if message.get("role") == "ASSISTANT" else LEARNER_LABEL
        text = neutralize_fences(" ".join((message.get("text") or "").split())[:MESSAGE_CHARS])
        marker = image_marker(attachments_of(message))
        line = f"{label}: {' '.join(part for part in (marker, text) if part)}"
        if used + len(line) > HISTORY_CHARS:
            break
        lines.append(line)
        used += len(line) + 1
    return list(reversed(lines))


def render_conversation(context: dict[str, Any] | None, query: str) -> str:
    lines = _history_lines(context, query)
    if not lines:
        return EMPTY_HISTORY
    return segment_tool_output("conversation", "\n".join(lines), trust="learner-derived", max_chars=HISTORY_CHARS + 500)


def render_material(context: dict[str, Any] | None) -> str:
    chunks = [
        {"id": f"material-{index}", "text": item["text"]}
        for index, item in enumerate((context or {}).get("materials") or [], start=1)
        if isinstance(item, dict) and isinstance(item.get("text"), str)
    ]
    rendered = segment_retrieved(chunks, source="current-step", trust="derived", max_chars_per_chunk=3000)
    return rendered or EMPTY_MATERIAL


def current_material_text(context: dict[str, Any] | None) -> str:
    items = [m["text"] for m in (context or {}).get("materials") or [] if isinstance(m, dict) and isinstance(m.get("text"), str)]
    return items[-1] if items else ""


__all__ = [
    "current_material_text",
    "fetch_chat_context",
    "learner_name",
    "render_conversation",
    "render_material",
]
