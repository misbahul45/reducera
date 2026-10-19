from __future__ import annotations

import logging

from celery.exceptions import Reject

from config.agent_session import AgentSession, session_payload_is_safe
from config.celery import celery_app
from config.embedding_pipeline import get_embedding_pipeline
from config.model_router import get_router
from errors.types import CrossServiceError, LLMError
from v1.decision_traces.dto import DecisionTraceCreate
from v1.decision_traces.service import sha256_hex, write_decision_trace
from v1.episodes.dto import EpisodeCreate
from v1.episodes.service import write_episode
from v1.learning.action_runner import run_chat_action
from v1.learning.chat_images import image_prompt, text_prompt
from v1.learning.content_pipeline import generate_content_material_pipeline
from v1.learning.dto import GenerateContentMaterialPipeline
from v1.learning.citations import episode_citations
from v1.learning.reply import finalize_reply, store_reply
from v1.learning.service import (
    LESSON_PROMPT_VERSION,
    create_content_material,
    update_message_chat,
)
from v1.learning.turn_record import episode_fields, reason_codes_of, selected_action_of, trace_fields, trace_outputs


logger = logging.getLogger(__name__)
pipeline = get_embedding_pipeline()


def _reject_if_unsafe(payload: dict) -> None:
    if not session_payload_is_safe(payload):
        logger.error("[CELERY] refusing to dispatch task with bearer-shaped fields")
        raise Reject("bearer-shaped fields in celery payload", requeue=False)


CHAT_PAYLOAD_FIELDS = ("chatId", "userStepId", "messageId", "query")
CHAT_FAILURE_TEXT = "AI tidak dapat menghasilkan jawaban saat ini. Silakan coba lagi."


def _require_fields(payload: dict, fields: tuple[str, ...]) -> None:
    missing = [name for name in fields if not payload.get(name)]
    if missing:
        logger.error("[CELERY] payload is missing required fields: %s", ", ".join(missing))
        raise Reject(f"missing payload fields: {', '.join(missing)}", requeue=False)


def _invoke_reply(prompt, query: str, session: AgentSession):
    def call(messages):
        return get_router().invoke(
            "tutor_reply",
            messages,
            query=query,
            context_chars=len(prompt.text),
            subject=session.acting_user_id,
        )

    images = prompt.images.images
    if images:
        try:
            return call([image_prompt(prompt.text, images)])
        except Exception:
            logger.warning("[generate_new_content] the model could not use the images, answering without them", exc_info=True)
    return call(text_prompt(prompt.text, unreadable=prompt.images.asked > 0))


def _session_from_payload(payload: dict) -> AgentSession:
    return AgentSession(
        session_id=payload["session_id"],
        acting_user_id=payload["acting_user_id"],
        tenant_id=payload["tenant_id"],
        trace_id=payload["trace_id"],
        idempotency_key=payload["idempotency_key"],
        issued_at_ms=0,
    )


def _session_from_state(state: GenerateContentMaterialPipeline) -> AgentSession:
    return AgentSession(
        session_id=state.session_id,
        acting_user_id=state.acting_user_id,
        tenant_id=state.tenant_id,
        trace_id=state.trace_id,
        idempotency_key=state.idempotency_key,
        issued_at_ms=0,
    )


@celery_app.task(
    name="v1.learning.generate_content_material",
    bind=True,
    autoretry_for=(Exception,),
    dont_autoretry_for=(Reject,),
    retry_backoff=True,
    max_retries=3,
)
def generate_content_material_task(self, payload: dict):
    _reject_if_unsafe(payload)
    try:
        logger.info("Celery Task Triggered: generate_content_material")
        state = GenerateContentMaterialPipeline(**payload)
        session = _session_from_state(state)
        result_state = generate_content_material_pipeline(state)
        content_generate = result_state.get("generate")
        if content_generate is None:
            raise CrossServiceError(
                "tutor pipeline produced no content",
                details={"trace_id": session.trace_id},
            )

        from v1.learning.dto import GenerateContentMaterialResponseDto

        try:
            validated = GenerateContentMaterialResponseDto.model_validate(content_generate)
            content_generate = validated.model_dump(by_alias=True, exclude_none=True)
        except Exception as exc:
            from errors.types import SchemaValidationError

            logger.error(
                "[WORKER] tutor response schema validation failed: %s", exc
            )
            raise SchemaValidationError(
                "worker received tutor response that does not match schema",
                details={"trace_id": session.trace_id, "error": str(exc)},
            ) from exc

        create_content_material(content_generate, session)
        logger.info("Content material generation completed successfully")

        try:
            citations = content_generate.get("citations") or []
            write_episode(
                EpisodeCreate(
                    trace_id=session.trace_id,
                    session_id=session.session_id,
                    acting_user_id=session.acting_user_id,
                    tenant_id=session.tenant_id,
                    idempotency_key=session.idempotency_key,
                    agent="tutor_agent",
                    intent="tutor",
                    lesson_id=state.lesson_id,
                    step_id=state.step_id,
                    topic_id=state.topic_id,
                    user_id=session.acting_user_id,
                    task="generate-material",
                    response_excerpt=(content_generate.get("data") or "")[:512],
                    citations=episode_citations((c for c in citations if isinstance(c, dict)), lesson_id=state.lesson_id),
                    prompt_version=LESSON_PROMPT_VERSION,
                    status="completed",
                    **episode_fields(result_state.get("routed"), result_state.get("snapshot")),
                ),
                session=session,
            )
        except Exception as exc:
            logger.error("[EPISODE] write failed: %s", exc)

        try:
            write_decision_trace(
                DecisionTraceCreate(
                    trace_id=session.trace_id,
                    session_id=session.session_id,
                    acting_user_id=session.acting_user_id,
                    tenant_id=session.tenant_id,
                    idempotency_key=session.idempotency_key,
                    agent_name="tutor_agent",
                    agent_scope="generate-material",
                    prompt_hash=sha256_hex(
                        f"{state.lesson_id}|{state.step_id}|{state.topic_id}"
                    ),
                    response_hash=sha256_hex(content_generate.get("data") or ""),
                    tool_calls=[
                        {"name": "topic_sources", "lesson_id": state.lesson_id},
                        {"name": "rag_retrieve", "lesson_id": state.lesson_id},
                    ],
                    deterministic_outputs={
                        "lesson_id": state.lesson_id,
                        "step_id": state.step_id,
                        "topic_id": state.topic_id,
                        "citation_count": len(content_generate.get("citations") or []),
                        **trace_outputs(result_state.get("snapshot"), state.user_step_id),
                    },
                    prompt_version=LESSON_PROMPT_VERSION,
                    reason_codes=reason_codes_of(result_state.get("snapshot")),
                    selected_action=selected_action_of(result_state.get("snapshot")),
                    **trace_fields(result_state.get("routed")),
                ),
                session=session,
            )
        except Exception as exc:
            logger.error("[DECISION_TRACE] write failed: %s", exc)

        return {"message": "Success", "data": content_generate}
    except CrossServiceError as exc:
        logger.error("CrossServiceError in generate_content_material: %s", exc.message)
        raise exc
    except Exception as exc:
        logger.error("Error generating content material: %s", exc)
        raise exc


@celery_app.task(
    name="v1.learning.generate_new_content",
    bind=True,
    autoretry_for=(Exception,),
    dont_autoretry_for=(Reject,),
    retry_backoff=True,
    max_retries=3,
)
def generating_new_content(self, payload: dict):
    _reject_if_unsafe(payload)
    _require_fields(payload, CHAT_PAYLOAD_FIELDS)
    try:
        logger.info("Celery Task Triggered: generating_new_content")
        session = _session_from_payload(payload)
        query = payload["query"]
        user_step_id = payload["userStepId"]
        message_id = payload["messageId"]

        from v1.learning.service import build_chat_prompt

        pipeline.enable_thinking = False
        prompt = build_chat_prompt(query, message_id, user_step_id, session, chat_id=payload["chatId"])
        try:
            routed = _invoke_reply(prompt, query, session)
        except Exception as exc:
            logger.error("[generate_new_content] LLM call failed: %s", exc)
            update_message_chat(message_id, session, {"text": CHAT_FAILURE_TEXT, "status": "FAILED"})
            raise LLMError(
                "tutor chat generation failed",
                details={"trace_id": session.trace_id},
            ) from exc

        reply = finalize_reply(routed.text, prompt.sources)
        generated_content = reply.text
        store_reply(message_id, session, reply, update_message_chat)
        logger.info("Content material generation completed successfully")

        try:
            write_episode(
                EpisodeCreate(
                    trace_id=session.trace_id,
                    session_id=session.session_id,
                    acting_user_id=session.acting_user_id,
                    tenant_id=session.tenant_id,
                    idempotency_key=session.idempotency_key,
                    agent="tutor_agent",
                    intent="chat",
                    user_id=session.acting_user_id,
                    task="continue-material",
                    response_excerpt=generated_content[:512],
                    citations=episode_citations(prompt.citations)
                    + episode_citations((c for c in reply.citations if c.get("kind") == "TOPIC"), lesson_id=prompt.scope.get("lessonId")),
                    prompt_version=prompt.label,
                    status="completed",
                    **episode_fields(routed, prompt.snapshot, prompt_arm=prompt.arm),
                ),
                session=session,
            )
        except Exception as exc:
            logger.error("[EPISODE] write failed: %s", exc)

        try:
            write_decision_trace(
                DecisionTraceCreate(
                    trace_id=session.trace_id,
                    session_id=session.session_id,
                    acting_user_id=session.acting_user_id,
                    tenant_id=session.tenant_id,
                    idempotency_key=session.idempotency_key,
                    agent_name="tutor_agent",
                    agent_scope="chat-continuation",
                    prompt_hash=sha256_hex(f"chat|{user_step_id}|{session.session_id}"),
                    response_hash=sha256_hex(generated_content),
                    tool_calls=[
                        {"name": "rag_retrieve", "user_step_id": user_step_id},
                        {"name": "web_search", "user_step_id": user_step_id},
                    ],
                    deterministic_outputs=trace_outputs(prompt.snapshot, user_step_id),
                    prompt_version=prompt.label,
                    reason_codes=reason_codes_of(prompt.snapshot),
                    selected_action=selected_action_of(prompt.snapshot),
                    **trace_fields(routed),
                    metadata={
                        "modelMode": routed.mode,
                        "escalated": routed.escalated,
                        "modelAttempts": len(routed.attempts),
                        "complexity": routed.complexity,
                    },
                ),
                session=session,
            )
        except Exception as exc:
            logger.error("[DECISION_TRACE] write failed: %s", exc)

        return {"message": "Success", "data": generated_content}
    except CrossServiceError as exc:
        logger.error("CrossServiceError in generating_new_content: %s", exc.message)
        raise exc
    except Exception as exc:
        logger.error("Error generating new content: %s", exc)
        raise exc


ACTION_PAYLOAD_FIELDS = ("chatId", "userStepId", "messageId", "action")


@celery_app.task(name="v1.learning.run_chat_action", bind=True)
def run_chat_action_task(self, payload: dict):
    _reject_if_unsafe(payload)
    _require_fields(payload, ACTION_PAYLOAD_FIELDS)
    return run_chat_action(payload, update_message_chat)


__all__ = [
    "generate_content_material_task",
    "generating_new_content",
    "run_chat_action_task",
]