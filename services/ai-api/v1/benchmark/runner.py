from __future__ import annotations

import hashlib
import logging
from datetime import datetime, timezone
from typing import Any

from config.model_router import get_router
from config.prompt_registry import render_template, template_problems
from config.prompt_segmentation import neutralize_fences, segment_tool_output, segment_user_input
from errors.types import LLMError
from v1.benchmark.checks import case_checks, dimensions
from v1.benchmark.dto import CaseInput, RunCaseRequest
from v1.benchmark.judge import JUDGE_VERSION, judge_reply
from v1.domain.context import render_domain_context
from v1.domain.data.default_taxonomy import load_default_taxonomy
from v1.learning.chat_context import learner_name, render_conversation, render_material
from v1.learning.reply_actions import ACTIONS_TAG, extract_actions
from v1.learning.service import CHAT_PROMPT_NAME, NO_RAG, NO_WEB
from v1.learning.sources import KIND_MATERIAL, KIND_TOPIC, KIND_WEB, Source, apply_citations, render_sources
from v1.tutor.strategy_playbook import render_strategy_lines

logger = logging.getLogger(__name__)

RUNNER_VERSION = "benchmark-runner-v1"
REPLY_TASK = "tutor_reply"


class BenchmarkRejected(ValueError):
    def __init__(self, problems: list[str]):
        super().__init__("; ".join(problems))
        self.problems = problems


def sources_of(case: CaseInput) -> list[Source]:
    return [Source(index=position, kind=item.kind, title=item.title, text=item.text) for position, item in enumerate(case.sources, start=1)]


def chat_context(case: CaseInput) -> dict[str, Any]:
    messages = [{"role": "USER" if turn.role == "learner" else "ASSISTANT", "text": turn.text} for turn in case.conversation]
    materials = [{"text": case.currentMaterial}] if case.currentMaterial.strip() else []
    return {"learnerName": case.learnerName, "messages": messages, "materials": materials}


def learner_section(case: CaseInput) -> str:
    lines = render_strategy_lines(case.strategy)
    if not lines:
        return ""
    return '<learner_state trust="derived">\n' + "\n".join(lines) + "\n</learner_state>\n\n"


def render_prompt(template_body: str, case: CaseInput) -> tuple[str, list[Source]]:
    sources = sources_of(case)
    context = chat_context(case)
    prompt = render_template(
        template_body,
        {
            "user_step_title": neutralize_fences(" ".join(case.stepTitle.split())[:200]),
            "learner_name": learner_name(context),
            "domain_block": render_domain_context(load_default_taxonomy()),
            "learner_section": learner_section(case),
            "conversation": render_conversation(context, case.message),
            "current_material": render_material(context),
            "user_input": segment_user_input(case.message),
            "rag": render_sources(sources, (KIND_TOPIC, KIND_MATERIAL)) or NO_RAG,
            "web": render_sources(sources, KIND_WEB) or NO_WEB,
            "memory": segment_tool_output("learner_memory", "", trust="learner-derived"),
        },
    )
    return prompt, sources


def digest(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def run_case(request: RunCaseRequest, *, subject: str) -> dict[str, Any]:
    problems = template_problems(CHAT_PROMPT_NAME, request.template.body)
    if problems:
        raise BenchmarkRejected(problems)

    case = request.case
    prompt, sources = render_prompt(request.template.body, case)
    started = datetime.now(timezone.utc)
    routed = get_router().invoke(
        REPLY_TASK,
        prompt,
        query=case.message,
        context_chars=len(prompt),
        history_turns=len(case.conversation),
        subject=subject,
    )
    visible, actions = extract_actions(routed.text)
    shown, citations = apply_citations(visible, sources)
    checks = case_checks(case, visible, request.protectedPhrases, actions_malformed=bool(ACTIONS_TAG.search(routed.text)) and not actions)

    judged: dict[str, Any] | None = None
    judge_error: str | None = None
    if request.judge:
        try:
            judged = judge_reply(case, sources, visible, subject=subject)
        except LLMError as exc:
            logger.warning("[BENCHMARK] the judge failed for %s: %s", case.id, exc)
            judge_error = str(exc)

    return {
        "caseId": case.id,
        "category": case.category,
        "risk": case.risk,
        "templateLabel": request.template.label,
        "templateHash": digest(request.template.body),
        "runnerVersion": RUNNER_VERSION,
        "judgeVersion": JUDGE_VERSION if request.judge else None,
        "startedAt": started.isoformat(),
        "model": routed.model,
        "mode": routed.mode,
        "escalated": routed.escalated,
        "policyVersion": routed.policy_version,
        "tokensIn": routed.tokens_in,
        "tokensOut": routed.tokens_out,
        "latencyMs": routed.latency_ms,
        "promptChars": len(prompt),
        "text": visible,
        "textShown": shown,
        "citationsShown": [item["index"] for item in citations],
        "actions": [item["type"] for item in actions],
        "checks": checks,
        "judge": judged,
        "judgeError": judge_error,
        "dimensions": dimensions(case, checks, judged),
    }


__all__ = ["BenchmarkRejected", "RUNNER_VERSION", "render_prompt", "run_case"]
