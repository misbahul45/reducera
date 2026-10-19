from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Callable, Iterable

from config.agent_session import AgentSession
from v1.learning.reply_actions import extract_actions
from v1.learning.sources import Source, apply_citations

logger = logging.getLogger(__name__)

ACTION_ONLY_TEXT = "Ini yang bisa aku bantu langsung:"


@dataclass(frozen=True)
class FinalReply:
    text: str
    citations: list[dict[str, Any]] = field(default_factory=list)
    actions: list[dict[str, Any]] = field(default_factory=list)


def finalize_reply(raw: str, sources: Iterable[Source]) -> FinalReply:
    text, actions = extract_actions(raw or "")
    text, citations = apply_citations(text, sources)
    text = text.strip()
    if not text:
        text = ACTION_ONLY_TEXT if actions else (raw or "").strip()
    return FinalReply(text=text, citations=citations, actions=actions)


MessageWriter = Callable[[str, AgentSession, dict[str, Any]], Any]


def store_reply(message_id: str, session: AgentSession, reply: FinalReply, write: MessageWriter) -> None:
    body: dict[str, Any] = {"text": reply.text, "status": "COMPLETED", "citations": reply.citations, "actions": reply.actions}
    try:
        write(message_id, session, body)
    except Exception:
        logger.warning("[CHAT] citations or actions were refused, the reply is stored as text only", exc_info=True)
        write(message_id, session, {"text": reply.text, "status": "COMPLETED"})


__all__ = ["ACTION_ONLY_TEXT", "FinalReply", "MessageWriter", "finalize_reply", "store_reply"]
