from __future__ import annotations

import logging
import re
import time
from dataclasses import dataclass
from typing import Any, Mapping

from config.agent_session import AgentSession
from config.internal_client import InternalApiClient

logger = logging.getLogger(__name__)

RESOLVE_PATH = "/internal/prompts/resolve"
CACHE_TTL_SECONDS = 60.0
FAILURE_TTL_SECONDS = 10.0
CACHE_LIMIT = 2000
MIN_TEMPLATE_LENGTH = 200
MAX_TEMPLATE_LENGTH = 20000

PLACEHOLDER = re.compile(r"\{\{\s*([a-z_]+)\s*\}\}")
REQUEST_DELIMITERS = ("<<<TEMPLATE", "TEMPLATE>>>")

PROMPT_CONTRACTS: Mapping[str, Mapping[str, tuple[str, ...]]] = {
    "tutor-chat": {
        "required": ("user_step_title", "domain_block", "user_input", "rag", "web", "memory", "conversation", "current_material"),
        "optional": ("learner_section", "learner_name"),
    },
}


@dataclass(frozen=True)
class ResolvedTemplate:
    label: str
    body: str
    arm: str


_cache: dict[tuple[str, str], tuple[float, ResolvedTemplate | None]] = {}


def template_problems(name: str, body: str) -> list[str]:
    contract = PROMPT_CONTRACTS.get(name)
    if contract is None:
        return [f"Unknown prompt {name}"]
    problems: list[str] = []
    if len(body) < MIN_TEMPLATE_LENGTH or len(body) > MAX_TEMPLATE_LENGTH:
        problems.append("The template length is outside the allowed range")
    used = {match.group(1) for match in PLACEHOLDER.finditer(body)}
    allowed = set(contract["required"]) | set(contract["optional"])
    problems.extend(f"Unknown placeholder {{{{{item}}}}}" for item in sorted(used - allowed))
    problems.extend(f"Missing required placeholder {{{{{item}}}}}" for item in contract["required"] if item not in used)
    leftover = PLACEHOLDER.sub("", body)
    if "{{" in leftover or "}}" in leftover:
        problems.append("A placeholder is malformed")
    problems.extend(f"The template contains the request delimiter {delimiter}" for delimiter in REQUEST_DELIMITERS if delimiter in body)
    return problems


def render_template(body: str, values: Mapping[str, str]) -> str:
    return PLACEHOLDER.sub(lambda match: values.get(match.group(1), ""), body)


def _accept(name: str, data: Any) -> ResolvedTemplate | None:
    if not isinstance(data, dict):
        return None
    body = data.get("body")
    label = data.get("label")
    arm = data.get("arm")
    if not isinstance(body, str) or not isinstance(label, str) or arm not in ("active", "canary"):
        logger.warning("[PROMPT_REGISTRY] the answer for %s has an unexpected shape, the builtin prompt is used", name)
        return None
    problems = template_problems(name, body)
    if problems:
        logger.warning("[PROMPT_REGISTRY] %s is not a valid template (%s), the builtin prompt is used", label, "; ".join(problems))
        return None
    return ResolvedTemplate(label=label, body=body, arm=arm)


def resolve_template(session: AgentSession, name: str, *, now: float | None = None) -> ResolvedTemplate | None:
    moment = time.monotonic() if now is None else now
    key = (session.acting_user_id, name)
    cached = _cache.get(key)
    if cached is not None and moment - cached[0] < CACHE_TTL_SECONDS:
        return cached[1]

    try:
        data = InternalApiClient(session).get(RESOLVE_PATH, params={"name": name})
    except Exception:
        logger.warning("[PROMPT_REGISTRY] lookup of %s failed, the builtin prompt is used", name, exc_info=True)
        _cache[key] = (moment - (CACHE_TTL_SECONDS - FAILURE_TTL_SECONDS), None)
        return None

    resolved = _accept(name, data)
    if len(_cache) >= CACHE_LIMIT:
        _cache.clear()
    _cache[key] = (moment, resolved)
    return resolved


def clear_cache() -> None:
    _cache.clear()


__all__ = [
    "CACHE_TTL_SECONDS",
    "PROMPT_CONTRACTS",
    "REQUEST_DELIMITERS",
    "ResolvedTemplate",
    "clear_cache",
    "render_template",
    "resolve_template",
    "template_problems",
]
