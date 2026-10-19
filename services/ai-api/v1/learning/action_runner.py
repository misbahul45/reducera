from __future__ import annotations

import logging
from typing import Any

from config.agent_session import AgentSession
from config.internal_client import InternalApiClient
from config.llm_output import json_validator
from config.model_router import get_router
from config.prompt_segmentation import neutralize_fences
from v1.episodes.dto import EpisodeCreate
from v1.episodes.service import write_episode
from v1.domain.governance import retrieval_scope
from v1.learning.chat_context import current_material_text, fetch_chat_context
from v1.learning.hybrid import rank_hybrid
from v1.learning.sources import KIND_MATERIAL, KIND_TOPIC, Source, apply_citations, render_sources
from v1.learning.topic_sources import fetch_topic_sources
from v1.learning.material_rewrite import build_rewrite_prompt
from v1.learning.practice_quiz import GeneratedQuiz, build_quiz_prompt, parse_quiz
from v1.learning.reply import MessageWriter
from v1.learning.reply_actions import validate_action
from v1.learning.turn_record import episode_fields, micro_plan_of, strategy_of
from v1.tutor.learner_block import read_learner_snapshot, render_snapshot_block

logger = logging.getLogger(__name__)

RUNNABLE = ("QUIZ", "IMPROVE_MATERIAL")
AGENT = "tutor_action"
RETRIEVAL_TOP_K = 6
FAILED_TEXT = {
    "QUIZ": "Maaf, soal latihannya belum berhasil dibuat. Coba lagi sebentar lagi.",
    "IMPROVE_MATERIAL": "Maaf, materinya belum berhasil ditulis ulang. Coba lagi sebentar lagi.",
}
NO_SOURCES_TEXT = "Belum ada sumber topik di database untuk langkah ini, jadi aku tidak membuat soal yang tidak bisa dirujuk. Minta pengajar menambahkan materi topik, lalu coba lagi."
NO_MATERIAL_TEXT = "Aku belum menemukan materi untuk langkah ini, jadi belum ada yang bisa ditulis ulang."
STATUS = {
    "QUIZ": "Menyusun soal latihan untukmu…",
    "IMPROVE_MATERIAL": "Menulis ulang materinya…",
}
LABEL = {"QUIZ": "chat-action-quiz-1", "IMPROVE_MATERIAL": "chat-action-improve-1"}
INSTRUCTION_TEXT = {
    "SIMPLIFY": "lebih sederhana",
    "EXAMPLE": "dengan lebih banyak contoh",
    "DEEPEN": "lebih dalam",
    "SHORTEN": "lebih ringkas",
}


def _session(payload: dict) -> AgentSession:
    return AgentSession(
        session_id=payload["session_id"],
        acting_user_id=payload["acting_user_id"],
        tenant_id=payload["tenant_id"],
        trace_id=payload["trace_id"],
        idempotency_key=payload["idempotency_key"],
        issued_at_ms=0,
    )


class NoTopicSources(Exception):
    pass


def _retrieved_results(query: str, session: AgentSession, snapshot: dict[str, Any] | None) -> list[dict[str, Any]]:
    from config.embedding_pipeline import get_embedding_pipeline

    try:
        return list(get_embedding_pipeline().retrieve(query=query, scope=retrieval_scope(session.acting_user_id, snapshot), top_k=RETRIEVAL_TOP_K) or [])
    except Exception:
        logger.warning("[ACTION] retrieval failed, the action is built from the topic records only", exc_info=True)
        return []


def _sources_for(session: AgentSession, user_step_id: str, query: str, snapshot: dict[str, Any] | None) -> list[Source]:
    topic = fetch_topic_sources(session, user_step_id=user_step_id)
    return rank_hybrid(query, topic["sources"], _retrieved_results(query, session, snapshot), [], include_web=False)


def _record(session: AgentSession, action_type: str, routed: Any, snapshot: dict[str, Any] | None, excerpt: str) -> None:
    try:
        write_episode(
            EpisodeCreate(
                trace_id=session.trace_id,
                session_id=session.session_id,
                acting_user_id=session.acting_user_id,
                tenant_id=session.tenant_id,
                idempotency_key=session.idempotency_key,
                agent=AGENT,
                intent=action_type.lower(),
                user_id=session.acting_user_id,
                task=f"chat-action:{action_type}",
                response_excerpt=excerpt[:512],
                prompt_version=LABEL[action_type],
                status="completed",
                **episode_fields(routed, snapshot),
            ),
            session=session,
        )
    except Exception as exc:
        logger.error("[EPISODE] write failed: %s", exc)


def _step_title(user_step_id: str, session: AgentSession) -> str:
    from v1.learning.service import get_user_step

    try:
        return neutralize_fences(" ".join(str(get_user_step(user_step_id, session).get("title") or user_step_id).split())[:200])
    except Exception:
        logger.warning("[ACTION] user step could not be read", exc_info=True)
        return user_step_id


def _run_quiz(payload: dict, session: AgentSession, action: dict[str, Any], write: MessageWriter) -> str:
    chat_id, step_id, message_id = payload["chatId"], payload["userStepId"], payload["messageId"]
    snapshot = read_learner_snapshot(session, user_step_id=step_id, intent="PRACTICE")
    context = fetch_chat_context(chat_id, message_id, session)
    title = _step_title(step_id, session)
    focus = action.get("focus")
    sources = _sources_for(session, step_id, focus or title, snapshot)
    if not sources:
        raise NoTopicSources()
    prompt = build_quiz_prompt(
        step_title=title,
        material=current_material_text(context),
        retrieved=render_sources(sources, (KIND_TOPIC, KIND_MATERIAL)),
        count=action["count"],
        focus=focus,
        learner_block=render_snapshot_block(session, snapshot),
        difficulty=(strategy_of(snapshot) or {}).get("difficultyTarget"),
    )
    routed = get_router().invoke(
        "quiz_generation",
        prompt,
        query=title,
        context_chars=len(prompt),
        subject=session.acting_user_id,
        validator=json_validator(GeneratedQuiz),
    )
    quiz = parse_quiz(routed.text, message_id, action["count"], sources)
    created = InternalApiClient(session).post(f"/internal/user-steps/{step_id}/practice-quiz", json_body=quiz)
    quiz_id = (created or {}).get("quizId")
    if not quiz_id:
        raise ValueError("the api did not return the id of the quiz")
    count = len(quiz["questions"])
    write(
        message_id,
        session,
        {
            "text": f"Soal latihannya sudah siap: {count} soal pilihan ganda tentang {title}. Nilainya ikut masuk ke penguasaanmu, jadi kerjakan dengan tenang ya.",
            "status": "COMPLETED",
            "citations": [],
            "actions": [{"type": "OPEN_QUIZ", "quizId": quiz_id}],
        },
    )
    _record(session, "QUIZ", routed, snapshot, quiz["title"])
    return quiz_id


def _run_improve(payload: dict, session: AgentSession, action: dict[str, Any], write: MessageWriter) -> str | None:
    chat_id, step_id, message_id = payload["chatId"], payload["userStepId"], payload["messageId"]
    context = fetch_chat_context(chat_id, message_id, session)
    material = current_material_text(context)
    if not material.strip():
        write(message_id, session, {"text": NO_MATERIAL_TEXT, "status": "COMPLETED", "citations": [], "actions": []})
        return None

    snapshot = read_learner_snapshot(session, user_step_id=step_id, intent="NEW_LEARNING")
    title = _step_title(step_id, session)
    sources = _sources_for(session, step_id, action.get("focus") or title, snapshot)
    prompt = build_rewrite_prompt(
        step_title=title,
        material=material,
        retrieved=render_sources(sources, (KIND_TOPIC, KIND_MATERIAL)),
        instruction=action["instruction"],
        focus=action.get("focus"),
        plan=micro_plan_of(snapshot),
        learner_block=render_snapshot_block(session, snapshot),
    )
    routed = get_router().invoke(
        "lesson_content",
        prompt,
        query=title,
        context_chars=len(prompt),
        subject=session.acting_user_id,
    )
    rewritten, citations = apply_citations(routed.text.strip(), sources)
    rewritten = rewritten.strip()
    if len(rewritten) < 80:
        raise ValueError("the rewritten material is too short to use")

    InternalApiClient(session).post(
        "/internal/contents",
        json_body={
            "chatId": chat_id,
            "chatMessageId": message_id,
            "data": rewritten,
            "citations": citations,
            "metadata": {
                "userStepId": step_id,
                "userId": session.acting_user_id,
                "rewrite": action["instruction"],
                "grounded": bool(citations),
                "sourceCount": len(sources),
            },
        },
    )
    write(
        message_id,
        session,
        {
            "text": f"Materinya sudah aku tulis ulang jadi {INSTRUCTION_TEXT[action['instruction']]}. Versi terbaru ada di bagian Materi, versi lamanya tetap bisa kamu buka.",
            "status": "COMPLETED",
            "citations": [],
            "actions": [{"type": "OPEN_MATERIAL"}],
        },
    )
    _record(session, "IMPROVE_MATERIAL", routed, snapshot, rewritten)
    return message_id


def run_chat_action(payload: dict, write: MessageWriter) -> dict[str, Any]:
    session = _session(payload)
    action = validate_action(payload.get("action"))
    message_id = payload["messageId"]
    if action is None or action["type"] not in RUNNABLE:
        write(message_id, session, {"text": "Aksi ini tidak bisa dijalankan.", "status": "FAILED", "citations": [], "actions": []})
        return {"message": "rejected"}

    kind = action["type"]
    write(message_id, session, {"text": STATUS[kind], "status": "PROCESSING"})
    try:
        result = _run_quiz(payload, session, action, write) if kind == "QUIZ" else _run_improve(payload, session, action, write)
    except NoTopicSources:
        write(message_id, session, {"text": NO_SOURCES_TEXT, "status": "FAILED", "citations": [], "actions": []})
        return {"message": "no-sources", "action": kind}
    except Exception as exc:
        logger.error("[ACTION] %s failed: %s", kind, exc, exc_info=True)
        write(message_id, session, {"text": FAILED_TEXT[kind], "status": "FAILED", "citations": [], "actions": [action]})
        return {"message": "failed", "action": kind}
    return {"message": "Success", "action": kind, "result": result}


__all__ = ["RUNNABLE", "run_chat_action"]
